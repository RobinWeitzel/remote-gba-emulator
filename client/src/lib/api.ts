// Tiny client for /api/roms and /api/saves.

import type { SaveSummary, CreateSaveResponse } from "@gba/shared";

export interface RomMeta {
  id: string;
  name: string;
  hash: string;
  size: number;
}

export async function listRoms(): Promise<RomMeta[]> {
  const res = await fetch("/api/roms");
  if (!res.ok) throw new Error(`listRoms: ${res.status}`);
  const j = await res.json();
  return j.roms;
}

export async function fetchRom(id: string): Promise<Uint8Array> {
  const res = await fetch(`/api/roms/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`fetchRom(${id}): ${res.status}`);
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab as ArrayBuffer);
}

export async function listSaves(): Promise<SaveSummary[]> {
  const res = await fetch("/api/saves");
  if (!res.ok) throw new Error(`listSaves: ${res.status}`);
  const j = await res.json();
  return j.saves;
}

export async function createSave(input: { name: string; romId: string }): Promise<SaveSummary> {
  const res = await fetch("/api/saves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error ?? ""; } catch { /* ignore */ }
    throw new Error(`createSave: ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const j: CreateSaveResponse = await res.json();
  return j.save;
}

async function setArchived(id: string, archived: boolean): Promise<SaveSummary> {
  const path = archived ? "archive" : "unarchive";
  const res = await fetch(`/api/saves/${encodeURIComponent(id)}/${path}`, { method: "POST" });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error ?? ""; } catch { /* ignore */ }
    throw new Error(`${path}: ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return (await res.json()).save;
}

export const archiveSave = (id: string) => setArchived(id, true);
export const unarchiveSave = (id: string) => setArchived(id, false);

export async function deleteSave(id: string): Promise<void> {
  const res = await fetch(`/api/saves/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error ?? ""; } catch { /* ignore */ }
    throw new Error(`deleteSave: ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
}
