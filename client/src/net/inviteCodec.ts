// Invite links carry EVERYTHING an invited device needs to join a session on the
// owner's Firebase project: the owner's config + sessionId + inviteId. This is
// what lets the config stay out of the build — a random visitor to the app URL
// has no config and can do nothing; only someone with an invite link can connect
// to that owner's project (and only redeem the single-use invite once).
//
// Encoded as base64url(JSON) in the hash fragment (#/join?d=…), so it isn't sent
// to any server as a query string.

import type { FirebaseConfigLike } from "./adapter";
import { normalizeConfig } from "./configStore";

export interface InvitePayload {
  config: FirebaseConfigLike;
  sessionId: string;
  inviteId: string;
  romName?: string; // shown before connecting, nicety
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeInvite(p: InvitePayload): string {
  const compact = {
    c: normalizeConfig(p.config),
    s: p.sessionId,
    i: p.inviteId,
    n: p.romName,
  };
  return b64urlEncode(JSON.stringify(compact));
}

export function decodeInvite(blob: string): InvitePayload {
  const o = JSON.parse(b64urlDecode(blob));
  if (!o || !o.c || !o.s || !o.i) throw new Error("invalid invite payload");
  return { config: normalizeConfig(o.c), sessionId: String(o.s), inviteId: String(o.i), romName: o.n };
}
