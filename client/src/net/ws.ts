// Tiny typed WebSocket client. Handles auto-reconnect with a join replay.

import { DEFAULTS, type ClientMsg, type ServerMsg } from "@gba/shared";

export interface NetOptions {
  url: string;
  // Called whenever a server message arrives.
  onMessage: (msg: ServerMsg) => void;
  // Called on connection state change. "open" means we just connected (or
  // reconnected). "closed" means we're disconnected; auto-reconnect will fire.
  onState: (state: "connecting" | "open" | "closed") => void;
  // Provide the message used to (re)join — replayed after every reconnect.
  joinMessage: ClientMsg;
}

export interface NetHandle {
  send: (msg: ClientMsg) => void;
  close: () => void;
  isOpen: () => boolean;
}

export function connect(opts: NetOptions): NetHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let heartbeatTimer: number | null = null;
  let reconnectDelay = 500;

  const open = () => {
    if (closed) return;
    opts.onState("connecting");
    const sock = new WebSocket(opts.url);
    ws = sock;
    sock.onopen = () => {
      reconnectDelay = 500;
      opts.onState("open");
      // (Re)send join
      sock.send(JSON.stringify(opts.joinMessage));
      // Heartbeat
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = window.setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ type: "heartbeat" }));
        }
      }, DEFAULTS.HEARTBEAT_INTERVAL_MS);
    };
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMsg;
        opts.onMessage(msg);
      } catch (e) {
        console.warn("ws: bad message", e);
      }
    };
    sock.onclose = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      opts.onState("closed");
      if (closed) return;
      // Exponential backoff to 8s, with jitter.
      const delay = Math.min(reconnectDelay, 8000) + Math.random() * 200;
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
      window.setTimeout(open, delay);
    };
    sock.onerror = () => {
      // onclose will fire next; nothing to do here.
    };
  };

  open();

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close() {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        ws?.send(JSON.stringify({ type: "leave" }));
      } catch { /* ignore */ }
      try { ws?.close(); } catch { /* ignore */ }
    },
    isOpen() {
      return !!ws && ws.readyState === WebSocket.OPEN;
    },
  };
}

export function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}
