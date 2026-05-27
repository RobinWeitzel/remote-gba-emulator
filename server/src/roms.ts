// ROM listing + serving. Hashes are computed at startup and cached.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface RomMeta {
  id: string;
  name: string;
  hash: string;
  size: number;
}

const cache = new Map<string, { meta: RomMeta; bytes: Buffer }>();
let dir = "";

export async function initRoms(romsDir: string): Promise<RomMeta[]> {
  dir = romsDir;
  cache.clear();
  let entries: string[];
  try {
    entries = await fs.readdir(romsDir);
  } catch {
    return [];
  }
  for (const f of entries) {
    if (!f.toLowerCase().endsWith(".gba")) continue;
    const full = path.join(romsDir, f);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    const bytes = await fs.readFile(full);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const meta: RomMeta = { id: f, name: f.replace(/\.gba$/i, ""), hash, size: stat.size };
    cache.set(f, { meta, bytes });
  }
  return list();
}

export function list(): RomMeta[] {
  return Array.from(cache.values()).map((v) => v.meta).sort((a, b) => a.name.localeCompare(b.name));
}

export function get(id: string): { meta: RomMeta; bytes: Buffer } | undefined {
  return cache.get(id);
}
