// HTTP + WebSocket bootstrap.
//
// New mental model (post-v2): the persistent object is a SAVE, not a session.
//   - GET  /api/saves            → list every save the server knows about,
//                                  including which are currently live.
//   - POST /api/saves            → create a new save (give it a name + ROM).
//   - GET  /api/roms             → list ROMs (unchanged).
//   - GET  /api/roms/:id         → serve ROM bytes (unchanged).
//   - GET  /ws                   → session hub. Clients send `join {saveId,name}`
//                                  and the server tells them which ROM the
//                                  save uses, plus the latest snapshot.

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { initRoms, list as listRomsImpl, get as getRomImpl } from "./roms.js";
import { SessionStore } from "./sessions.js";
import { SaveStore, type SaveMeta } from "./saves.js";
import {
  DEFAULTS,
  SPEED_LADDER,
  type ClientMsg,
  type ServerMsg,
  type WelcomeMsg,
  type RosterMsg,
  type ControllerChangedMsg,
  type BecomeControllerMsg,
  type ErrorMsg,
  type SaveSummary,
  type CreateSaveRequest,
  type ContributorsMsg,
} from "@gba/shared";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

// Bounds on user-supplied strings so a misbehaving client can't pin
// arbitrary bytes into the contributor ledger or save meta.
const MAX_PLAYER_NAME_LEN = 32;
const MAX_SAVE_NAME_LEN = 64;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tsx-served in both dev and prod so __dirname is /server/src/.
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");
const ROMS_DIR = path.resolve(__dirname, "../roms");
const DATA_DIR = path.resolve(__dirname, "../data");
const SAVES_DIR = path.join(DATA_DIR, "saves");

const COOP_COEP_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "x-robots-tag": "noindex",
};

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
const sessions = new SessionStore();
const saves = new SaveStore(SAVES_DIR);

await app.register(fastifyWebsocket);

app.addHook("onSend", async (_req, reply) => {
  for (const [k, v] of Object.entries(COOP_COEP_HEADERS)) reply.header(k, v);
});

// ---- /api/roms ----
app.get("/api/roms", async () => ({ roms: listRomsImpl() }));

app.get<{ Params: { id: string } }>("/api/roms/:id", async (req, reply) => {
  const id = req.params.id;
  if (id.includes("/") || id.includes("\\") || id.startsWith(".")) {
    reply.code(400);
    return "bad id";
  }
  const rom = getRomImpl(id);
  if (!rom) {
    reply.code(404);
    return "not found";
  }
  reply.header("content-type", "application/octet-stream");
  reply.header("content-length", String(rom.bytes.length));
  return rom.bytes;
});

// ---- /api/saves ----
function summarizeSave(meta: SaveMeta): SaveSummary {
  const session = sessions.get(meta.id);
  let live: SaveSummary["live"] = null;
  if (session) {
    live = {
      participantCount: session.participants.size,
      controllerName: sessions.controllerName(session),
    };
  }
  return {
    id: meta.id,
    name: meta.name,
    romId: meta.romId,
    romHash: meta.romHash,
    romName: meta.romName,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    archived: meta.archived,
    contributors: { ...meta.contributors },
    live,
  };
}

app.get("/api/saves", async () => ({ saves: saves.list().map(summarizeSave) }));

app.post<{ Params: { id: string } }>("/api/saves/:id/archive", async (req, reply) => {
  const updated = await saves.setArchived(req.params.id, true);
  if (!updated) { reply.code(404); return { error: "not found" }; }
  return { save: summarizeSave(updated) };
});

app.post<{ Params: { id: string } }>("/api/saves/:id/unarchive", async (req, reply) => {
  const updated = await saves.setArchived(req.params.id, false);
  if (!updated) { reply.code(404); return { error: "not found" }; }
  return { save: summarizeSave(updated) };
});

// Permanently delete a save. Refuses if anyone is currently in the save's
// live session — they'd see their world rug-pulled. The client is expected
// to gate this behind "archived only" anyway.
app.delete<{ Params: { id: string } }>("/api/saves/:id", async (req, reply) => {
  const meta = saves.get(req.params.id);
  if (!meta) { reply.code(404); return { error: "not found" }; }
  if (sessions.get(req.params.id)) {
    reply.code(409);
    return { error: "save has live players; archive and wait for them to leave first" };
  }
  const ok = await saves.delete(req.params.id);
  if (!ok) { reply.code(404); return { error: "not found" }; }
  return { ok: true };
});

app.post<{ Body: CreateSaveRequest }>("/api/saves", async (req, reply) => {
  const body = req.body ?? ({} as CreateSaveRequest);
  const name = (body.name ?? "").trim().slice(0, MAX_SAVE_NAME_LEN);
  const romId = (body.romId ?? "").trim();
  if (!name) {
    reply.code(400);
    return { error: "name required" };
  }
  if (!romId) {
    reply.code(400);
    return { error: "romId required" };
  }
  const rom = getRomImpl(romId);
  if (!rom) {
    reply.code(404);
    return { error: `unknown ROM: ${romId}` };
  }
  const meta = await saves.create({
    name,
    romId,
    romHash: rom.meta.hash,
    romName: rom.meta.name,
  });
  return { save: summarizeSave(meta) };
});

// ---- WebSocket hub ----
const sockets = new Map<string, any>();

function send(connId: string, msg: ServerMsg) {
  const ws = sockets.get(connId);
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(msg));
}

function broadcast(saveId: string, msg: ServerMsg, exceptConnId?: string) {
  const s = sessions.get(saveId);
  if (!s) return;
  for (const p of s.participants.values()) {
    if (p.connId === exceptConnId) continue;
    send(p.connId, msg);
  }
}

function sendError(connId: string, code: string, message: string) {
  send(connId, { type: "error", code, message } satisfies ErrorMsg);
}

function rosterMsg(saveId: string): RosterMsg {
  const s = sessions.get(saveId)!;
  return {
    type: "roster",
    roster: sessions.roster(s),
    controllerId: sessions.controllerId(s),
  };
}

function contributorsMsg(saveMeta: SaveMeta): ContributorsMsg {
  return { type: "contributors", contributors: { ...saveMeta.contributors } };
}

// Flush the current controller's accumulated wall-time into the save's
// contributor ledger AND broadcast the new ledger so all clients update.
async function flushAndBroadcastContribution(saveId: string): Promise<void> {
  const session = sessions.get(saveId);
  if (!session) return;
  const delta = sessions.flushControllerTime(session);
  if (!delta) return;
  const updated = await saves.addContribution(saveId, delta.playerName, delta.deltaMs);
  if (updated) broadcast(saveId, contributorsMsg(updated));
}

interface SocketAux {
  connId: string;
  saveId?: string;
}

app.get("/ws", { websocket: true }, (socket, _req) => {
  const ws = socket as any;
  const aux: SocketAux = { connId: newConnId() };
  sockets.set(aux.connId, ws);
  app.log.info({ connId: aux.connId }, "ws connected");

  ws.on("message", (raw: any) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendError(aux.connId, "bad_json", "malformed JSON");
      return;
    }
    handleMessage(aux, msg).catch((e) => {
      app.log.error({ err: e?.message }, "handleMessage failed");
      sendError(aux.connId, "internal", String(e?.message ?? e));
    });
  });

  ws.on("close", () => {
    app.log.info({ connId: aux.connId, saveId: aux.saveId }, "ws closed");
    sockets.delete(aux.connId);
    if (aux.saveId) handleLeave(aux).catch((e) => app.log.error({ err: e?.message }, "leave failed"));
  });

  ws.on("error", (e: any) => {
    app.log.warn({ err: e?.message }, "ws error");
  });
});

async function handleMessage(aux: SocketAux, msg: ClientMsg) {
  switch (msg.type) {
    case "join": {
      if (aux.saveId) {
        sendError(aux.connId, "already_joined", "already joined a save");
        return;
      }
      const name = (msg.name ?? "").trim().slice(0, MAX_PLAYER_NAME_LEN);
      if (!name) {
        sendError(aux.connId, "name_required", "Player name is required.");
        return;
      }
      const meta = saves.get(msg.saveId);
      if (!meta) {
        sendError(aux.connId, "unknown_save", `save ${msg.saveId} not found`);
        return;
      }
      const session = sessions.getOrCreate(msg.saveId);
      const isFirstParticipant = session.participants.size === 0;
      const { isController } = sessions.addParticipant(session, aux.connId, name);
      aux.saveId = msg.saveId;

      // If the session was just spun up by this joiner, load the persisted
      // snapshot bytes (if any) into session.latestSnapshot so the welcome
      // carries them and the controller can resume from disk.
      if (isFirstParticipant && !session.latestSnapshot) {
        const bytes = await saves.readSnapshot(msg.saveId);
        if (bytes) {
          session.latestSnapshot = {
            frame: 0, // frame number is meaningless across container restarts
            data: Buffer.from(bytes).toString("base64"),
            compressed: false,
            rawSize: bytes.length,
            multiplier: 1, // saves resume at 1× on cold boot
            receivedAt: Date.now(),
          };
        }
      }

      const welcome: WelcomeMsg = {
        type: "welcome",
        selfId: aux.connId,
        role: isController ? "controller" : "follower",
        controllerId: sessions.controllerId(session),
        roster: sessions.roster(session),
        latestSnapshot: session.latestSnapshot ?? null,
        saveId: meta.id,
        saveName: meta.name,
        romId: meta.romId,
        romHash: meta.romHash,
        contributors: { ...meta.contributors },
        currentMultiplier: session.currentMultiplier,
      };
      send(aux.connId, welcome);
      broadcast(msg.saveId, rosterMsg(msg.saveId), aux.connId);
      app.log.info(
        { saveId: msg.saveId, connId: aux.connId, role: welcome.role, size: session.participants.size },
        "joined",
      );
      return;
    }
    case "heartbeat": {
      const s = aux.saveId ? sessions.get(aux.saveId) : null;
      if (s) sessions.touchHeartbeat(s, aux.connId);
      return;
    }
    case "input": {
      const s = aux.saveId ? sessions.get(aux.saveId) : null;
      if (!s) return;
      if (!sessions.isController(s, aux.connId)) return;
      const out: ServerMsg = { type: "input", frame: msg.frame, button: msg.button, pressed: msg.pressed };
      broadcast(aux.saveId!, out, aux.connId);
      return;
    }
    case "snapshot": {
      const s = aux.saveId ? sessions.get(aux.saveId) : null;
      if (!s) return;
      if (!sessions.isController(s, aux.connId)) return;
      // The controller stamps the snapshot with its current multiplier;
      // we trust it. (We could cross-check against session.currentMultiplier
      // but the controller is the source of truth for what it just
      // captured at.)
      const multiplier = msg.multiplier ?? s.currentMultiplier ?? 1;
      sessions.setSnapshot(s, {
        frame: msg.frame,
        data: msg.data,
        compressed: msg.compressed,
        rawSize: msg.rawSize,
        multiplier,
      });
      // Persist bytes to disk + flush controller wall-time into contributors.
      try {
        const bytes = Buffer.from(msg.data, "base64");
        await saves.writeSnapshot(aux.saveId!, bytes);
      } catch (e: any) {
        app.log.warn({ err: e?.message }, "writeSnapshot failed");
      }
      await flushAndBroadcastContribution(aux.saveId!);
      const out: ServerMsg = {
        type: "snapshot",
        frame: msg.frame,
        data: msg.data,
        compressed: msg.compressed,
        rawSize: msg.rawSize,
        multiplier,
      };
      broadcast(aux.saveId!, out, aux.connId);
      return;
    }
    case "speed": {
      const s = aux.saveId ? sessions.get(aux.saveId) : null;
      if (!s) return;
      if (!sessions.isController(s, aux.connId)) return;
      // Validate against the configured ladder so a bad client can't
      // push us to an unsupported core multiplier.
      if (!SPEED_LADDER.includes(msg.multiplier)) {
        sendError(aux.connId, "bad_speed", `multiplier ${msg.multiplier} not in ladder`);
        return;
      }
      s.currentMultiplier = msg.multiplier;
      const out: ServerMsg = { type: "speed", frame: msg.frame, multiplier: msg.multiplier };
      broadcast(aux.saveId!, out, aux.connId);
      return;
    }
    case "leave": {
      await handleLeave(aux);
      return;
    }
    case "handover": {
      const s = aux.saveId ? sessions.get(aux.saveId) : null;
      if (!s) return;
      const result = sessions.handover(s, aux.connId, msg.toConnId);
      if (!result.ok) {
        if (result.reason === "not_controller") {
          // Silently ignore — protects against stale UI sending a handover
          // after the role already flipped elsewhere.
          return;
        }
        sendError(aux.connId, result.reason ?? "handover_failed", "handover failed");
        return;
      }
      const sid = aux.saveId!;
      // Credit the leaving controller for their stint.
      if (result.leavingControllerContribution) {
        const updated = await saves.addContribution(
          sid,
          result.leavingControllerContribution.playerName,
          result.leavingControllerContribution.deltaMs,
        );
        if (updated) broadcast(sid, contributorsMsg(updated));
      }
      // Tell the new controller to take over (snapshot + multiplier).
      const newControllerId = result.newControllerId!;
      const snap = s.latestSnapshot;
      const bcMsg: BecomeControllerMsg = snap
        ? { type: "becomeController", frame: snap.frame, data: snap.data, compressed: snap.compressed, rawSize: snap.rawSize, multiplier: s.currentMultiplier }
        : { type: "becomeController", frame: 0, data: "", compressed: false, rawSize: 0, multiplier: s.currentMultiplier };
      send(newControllerId, bcMsg);
      // Broadcast role flip + updated roster.
      const cc: ControllerChangedMsg = { type: "controllerChanged", controllerId: newControllerId };
      broadcast(sid, cc);
      broadcast(sid, rosterMsg(sid));
      app.log.info({ saveId: sid, from: aux.connId, to: newControllerId }, "handover");
      return;
    }
  }
}

async function handleLeave(aux: SocketAux) {
  if (!aux.saveId) return;
  const session = sessions.get(aux.saveId);
  if (!session) {
    aux.saveId = undefined;
    return;
  }
  const sid = aux.saveId;
  const { wasController, newControllerId, sessionNowEmpty, leavingControllerContribution } =
    sessions.removeParticipant(session, aux.connId);
  aux.saveId = undefined;

  // Credit the leaving controller (if any) for their final stint.
  if (leavingControllerContribution) {
    const updated = await saves.addContribution(
      sid,
      leavingControllerContribution.playerName,
      leavingControllerContribution.deltaMs,
    );
    if (updated) broadcast(sid, contributorsMsg(updated));
  }

  if (sessionNowEmpty) {
    app.log.info({ saveId: sid }, "session emptied — save persists on disk");
    return;
  }
  if (wasController && newControllerId) {
    const snap = session.latestSnapshot;
    const msg: BecomeControllerMsg = snap
      ? { type: "becomeController", frame: snap.frame, data: snap.data, compressed: snap.compressed, rawSize: snap.rawSize, multiplier: session.currentMultiplier }
      : { type: "becomeController", frame: 0, data: "", compressed: false, rawSize: 0, multiplier: session.currentMultiplier };
    send(newControllerId, msg);
    const cc: ControllerChangedMsg = { type: "controllerChanged", controllerId: newControllerId };
    broadcast(sid, cc);
  }
  broadcast(sid, rosterMsg(sid));
}

// Heartbeat sweep — remove participants whose lastHeartbeat is older than
// HEARTBEAT_TIMEOUT_MS, then run them through handleLeave() so they get the
// same contribution-flush + handoff logic as a clean leave.
setInterval(() => {
  const stale = sessions.sweepStale();
  for (const { session, staleIds } of stale) {
    for (const connId of staleIds) {
      app.log.info({ connId, saveId: session.saveId }, "heartbeat timeout, removing");
      const aux: SocketAux = { connId, saveId: session.saveId };
      sockets.delete(connId);
      handleLeave(aux).catch((e) => app.log.error({ err: e?.message }, "sweep handleLeave failed"));
    }
  }
}, Math.min(DEFAULTS.HEARTBEAT_TIMEOUT_MS / 2, 2000));

function newConnId(): string {
  return crypto.randomUUID();
}

// Static client serving.
try {
  await app.register(fastifyStatic, { root: CLIENT_DIST });
  const indexHtml = fs.readFileSync(path.join(CLIENT_DIST, "index.html"), "utf8");
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
      reply.code(404).send("not found");
      return;
    }
    if (/\.(ico|png|jpg|jpeg|gif|svg|webp|map|js|css|wasm)$/i.test(req.url.split("?")[0])) {
      reply.code(404).send("not found");
      return;
    }
    reply.type("text/html").send(indexHtml);
  });
} catch (e: any) {
  app.log.warn({ err: e?.message }, "static client not available (dev mode is fine)");
}

await initRoms(ROMS_DIR);
app.log.info({ roms: listRomsImpl().map((r) => r.id) }, "ROMs loaded");

await saves.init();
app.log.info({ count: saves.list().length, dir: SAVES_DIR }, "saves loaded from disk");

await app.listen({ port: PORT, host: HOST });
app.log.info(`listening on http://${HOST}:${PORT}`);
