// HTTP + WebSocket bootstrap for the watch-together GBA emulator.
//
// In dev, the Vite dev server (port 5173) serves the client and proxies
// /api/* + /ws here on port 8080. In prod, this server serves the built
// client from /client/dist plus the same /api and /ws endpoints.

import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { initRoms, list as listRomsImpl, get as getRomImpl } from "./roms.js";
import { SessionStore } from "./sessions.js";
import {
  DEFAULTS,
  type ClientMsg,
  type ServerMsg,
  type WelcomeMsg,
  type RosterMsg,
  type ControllerChangedMsg,
  type BecomeControllerMsg,
  type ErrorMsg,
} from "@gba/shared";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// /server/dist/index.js  → ../../client/dist  (prod)
// /server/src/index.ts   → ../../client/dist  (dev, but Vite serves the client)
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");
const ROMS_DIR = path.resolve(__dirname, "../roms");

const COOP_COEP_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "x-robots-tag": "noindex",
};

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
const store = new SessionStore();

await app.register(fastifyWebsocket);

// COOP/COEP/CORP + noindex on every response (SPEC C3, C6).
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

// ---- WebSocket hub ----
const sockets = new Map<string, any>(); // connId → ws

function send(connId: string, msg: ServerMsg) {
  const ws = sockets.get(connId);
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(msg));
}

function broadcast(sessionId: string, msg: ServerMsg, exceptConnId?: string) {
  const s = store.get(sessionId);
  if (!s) return;
  for (const p of s.participants.values()) {
    if (p.connId === exceptConnId) continue;
    send(p.connId, msg);
  }
}

function sendError(connId: string, code: string, message: string) {
  const e: ErrorMsg = { type: "error", code, message };
  send(connId, e);
}

function rosterMsg(sessionId: string): RosterMsg {
  const s = store.get(sessionId)!;
  return {
    type: "roster",
    roster: store.roster(s),
    controllerId: store.controllerId(s),
  };
}

interface SocketAux {
  connId: string;
  sessionId?: string;
}

app.get("/ws", { websocket: true }, (socket, _req) => {
  const ws = socket as any; // ws WebSocket instance
  const aux: SocketAux = { connId: cryptoRandom() };
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
    app.log.info({ connId: aux.connId, sessionId: aux.sessionId }, "ws closed");
    sockets.delete(aux.connId);
    if (aux.sessionId) handleLeave(aux);
  });

  ws.on("error", (e: any) => {
    app.log.warn({ err: e?.message }, "ws error");
  });
});

async function handleMessage(aux: SocketAux, msg: ClientMsg) {
  switch (msg.type) {
    case "join": {
      if (aux.sessionId) {
        sendError(aux.connId, "already_joined", "already joined a session");
        return;
      }
      // ROM hash check — first joiner sets it, later joiners must match.
      const existing = store.get(msg.sessionId);
      if (existing && existing.romHash !== msg.romHash) {
        sendError(aux.connId, "rom_mismatch", `session uses a different ROM (expected ${existing.romId}/${existing.romHash.slice(0, 8)}…)`);
        return;
      }
      const session = store.getOrCreate(msg.sessionId, msg.romId, msg.romHash);
      const { isController } = store.addParticipant(session, aux.connId, msg.name);
      aux.sessionId = msg.sessionId;
      const welcome: WelcomeMsg = {
        type: "welcome",
        selfId: aux.connId,
        role: isController ? "controller" : "follower",
        controllerId: store.controllerId(session),
        roster: store.roster(session),
        latestSnapshot: session.latestSnapshot ?? null,
        romId: session.romId,
        romHash: session.romHash,
      };
      send(aux.connId, welcome);
      broadcast(msg.sessionId, rosterMsg(msg.sessionId), aux.connId);
      app.log.info({ sessionId: msg.sessionId, connId: aux.connId, role: welcome.role, size: session.participants.size }, "joined");
      return;
    }
    case "heartbeat": {
      const s = aux.sessionId ? store.get(aux.sessionId) : null;
      if (s) store.touchHeartbeat(s, aux.connId);
      return;
    }
    case "input": {
      const s = aux.sessionId ? store.get(aux.sessionId) : null;
      if (!s) return;
      if (!store.isController(s, aux.connId)) return; // silently drop
      // Relay to followers only.
      const out: ServerMsg = { type: "input", frame: msg.frame, button: msg.button, pressed: msg.pressed };
      broadcast(aux.sessionId!, out, aux.connId);
      return;
    }
    case "snapshot": {
      const s = aux.sessionId ? store.get(aux.sessionId) : null;
      if (!s) return;
      if (!store.isController(s, aux.connId)) return; // silently drop
      store.setSnapshot(s, {
        frame: msg.frame,
        data: msg.data,
        compressed: msg.compressed,
        rawSize: msg.rawSize,
      });
      const out: ServerMsg = {
        type: "snapshot",
        frame: msg.frame,
        data: msg.data,
        compressed: msg.compressed,
        rawSize: msg.rawSize,
      };
      broadcast(aux.sessionId!, out, aux.connId);
      return;
    }
    case "leave": {
      handleLeave(aux);
      return;
    }
  }
}

function handleLeave(aux: SocketAux) {
  if (!aux.sessionId) return;
  const session = store.get(aux.sessionId);
  if (!session) {
    aux.sessionId = undefined;
    return;
  }
  const { wasController, newControllerId, sessionNowEmpty } = store.removeParticipant(session, aux.connId);
  const sid = aux.sessionId;
  aux.sessionId = undefined;
  if (sessionNowEmpty) {
    app.log.info({ sessionId: sid }, "session emptied & deleted");
    return;
  }
  if (wasController && newControllerId) {
    const snap = session.latestSnapshot;
    if (snap) {
      const msg: BecomeControllerMsg = {
        type: "becomeController",
        frame: snap.frame,
        data: snap.data,
        compressed: snap.compressed,
        rawSize: snap.rawSize,
      };
      send(newControllerId, msg);
    } else {
      // No snapshot yet — new controller boots fresh. SPEC §11 edge case.
      const msg: BecomeControllerMsg = {
        type: "becomeController",
        frame: 0,
        data: "",
        compressed: false,
        rawSize: 0,
      };
      send(newControllerId, msg);
    }
    const cc: ControllerChangedMsg = { type: "controllerChanged", controllerId: newControllerId };
    broadcast(sid, cc);
  }
  broadcast(sid, rosterMsg(sid));
}

// Heartbeat sweep
setInterval(() => {
  const stale = store.sweepStale();
  for (const { session, staleIds } of stale) {
    for (const connId of staleIds) {
      app.log.info({ connId, sessionId: session.id }, "heartbeat timeout, removing");
      const aux: SocketAux = { connId, sessionId: session.id };
      sockets.delete(connId);
      handleLeave(aux);
    }
  }
}, Math.min(DEFAULTS.HEARTBEAT_TIMEOUT_MS / 2, 2000));

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Static client serving (only useful in prod after `npm run build`).
try {
  // Will throw if /client/dist doesn't exist (dev), which is fine.
  await app.register(fastifyStatic, {
    root: CLIENT_DIST,
    decorateReply: false,
  });
  // SPA fallback — any unknown route serves index.html, EXCEPT /api/* and /ws.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
      reply.code(404).send("not found");
      return;
    }
    reply.type("text/html").sendFile("index.html");
  });
} catch (e: any) {
  app.log.warn({ err: e?.message }, "static client not available (dev mode is fine)");
}

await initRoms(ROMS_DIR);
app.log.info({ roms: listRomsImpl().map((r) => r.id) }, "ROMs loaded");

await app.listen({ port: PORT, host: HOST });
app.log.info(`listening on http://${HOST}:${PORT}`);
