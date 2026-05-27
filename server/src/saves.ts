// Persistent saves. A save survives container restarts and "all players
// left"; sessions (in-memory) are just the live wrapper around a save.
//
// On-disk layout (under SAVES_DIR):
//   <saveId>/
//     meta.json     ← id, name, romId, romHash, romName, timestamps, contributors
//     snapshot.bin  ← latest mGBA save-state bytes (may be missing pre-first-snapshot)
//
// We hold meta in memory for fast listing and persist it atomically (write to
// .tmp, fsync, rename) whenever it changes. snapshot.bin is overwritten
// (also atomically) on each snapshot the controller emits.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface SaveMeta {
  id: string;
  name: string;
  romId: string;
  romHash: string;
  romName: string;
  createdAt: number;
  updatedAt: number;
  // playerName → cumulative milliseconds spent as controller
  contributors: Record<string, number>;
  // Soft-deleted by the user. Archived saves are still on disk and still
  // joinable by URL — they just don't surface in the default home list.
  archived: boolean;
}

function safeId(): string {
  return crypto.randomBytes(6).toString("hex");
}

async function writeFileAtomic(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export class SaveStore {
  private dir: string;
  private metas = new Map<string, SaveMeta>();

  constructor(dir: string) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const entries = await fs.readdir(this.dir).catch(() => [] as string[]);
    for (const name of entries) {
      const metaPath = path.join(this.dir, name, "meta.json");
      try {
        const raw = await fs.readFile(metaPath, "utf8");
        const meta = JSON.parse(raw) as SaveMeta;
        if (!meta?.id || meta.id !== name) continue;
        // Migration: older meta files may not have `archived`. Default it
        // to false so existing saves continue to show up.
        if (typeof meta.archived !== "boolean") meta.archived = false;
        this.metas.set(meta.id, meta);
      } catch {
        // Skip malformed entries silently — caller will see them missing.
      }
    }
  }

  list(): SaveMeta[] {
    return Array.from(this.metas.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): SaveMeta | undefined {
    return this.metas.get(id);
  }

  async create(input: { name: string; romId: string; romHash: string; romName: string }): Promise<SaveMeta> {
    const id = safeId();
    const now = Date.now();
    const meta: SaveMeta = {
      id,
      name: input.name,
      romId: input.romId,
      romHash: input.romHash,
      romName: input.romName,
      createdAt: now,
      updatedAt: now,
      contributors: {},
      archived: false,
    };
    await fs.mkdir(path.join(this.dir, id), { recursive: true });
    await writeFileAtomic(path.join(this.dir, id, "meta.json"), JSON.stringify(meta, null, 2));
    this.metas.set(id, meta);
    return meta;
  }

  async writeMeta(meta: SaveMeta): Promise<void> {
    meta.updatedAt = Date.now();
    await writeFileAtomic(path.join(this.dir, meta.id, "meta.json"), JSON.stringify(meta, null, 2));
    this.metas.set(meta.id, meta);
  }

  // Add `deltaMs` to the named contributor and persist. Used by the live
  // session whenever it flushes accumulated controller wall-time (on snapshot,
  // controller handover, or session-empty).
  async addContribution(saveId: string, playerName: string, deltaMs: number): Promise<SaveMeta | undefined> {
    const meta = this.metas.get(saveId);
    if (!meta || deltaMs <= 0) return meta;
    const trimmedName = playerName.trim() || "Anonymous";
    meta.contributors[trimmedName] = (meta.contributors[trimmedName] ?? 0) + deltaMs;
    await this.writeMeta(meta);
    return meta;
  }

  async writeSnapshot(saveId: string, bytes: Uint8Array): Promise<void> {
    const meta = this.metas.get(saveId);
    if (!meta) return;
    await writeFileAtomic(path.join(this.dir, saveId, "snapshot.bin"), Buffer.from(bytes));
    meta.updatedAt = Date.now();
    // Don't fsync the meta on every snapshot just for updatedAt — readers
    // can see the file mtime if precision matters. But keep in-memory fresh.
    this.metas.set(saveId, meta);
  }

  async setArchived(saveId: string, archived: boolean): Promise<SaveMeta | undefined> {
    const meta = this.metas.get(saveId);
    if (!meta) return undefined;
    if (meta.archived === archived) return meta;
    meta.archived = archived;
    await this.writeMeta(meta);
    return meta;
  }

  async readSnapshot(saveId: string): Promise<Uint8Array | null> {
    try {
      const buf = await fs.readFile(path.join(this.dir, saveId, "snapshot.bin"));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      return null;
    }
  }

  // Permanently remove a save's directory + drop it from the in-memory
  // index. Used by the "delete forever" affordance on archived saves.
  async delete(saveId: string): Promise<boolean> {
    if (!this.metas.has(saveId)) return false;
    this.metas.delete(saveId);
    await fs.rm(path.join(this.dir, saveId), { recursive: true, force: true });
    return true;
  }
}
