import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const COOP_COEP_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex",
};

const ROMS_DIR = path.resolve(__dirname, "../server/roms");

interface RomMeta {
  id: string;
  name: string;
  hash: string;
  size: number;
}

async function listRoms(): Promise<RomMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(ROMS_DIR);
  } catch {
    return [];
  }
  const out: RomMeta[] = [];
  for (const f of entries) {
    if (!f.toLowerCase().endsWith(".gba")) continue;
    const full = path.join(ROMS_DIR, f);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    const bytes = await fs.readFile(full);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    out.push({
      id: f,
      name: f.replace(/\.gba$/i, ""),
      hash,
      size: stat.size,
    });
  }
  return out;
}

// Dev-only middleware: mirror the production /api/roms endpoint by reading
// /server/roms directly. Lets the spike (M0) and M1 use the real API shape
// before the Node server exists in M2.
function devRomApi() {
  return {
    name: "dev-rom-api",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        try {
          for (const [k, v] of Object.entries(COOP_COEP_HEADERS)) res.setHeader(k, v);
          if (req.url === "/api/roms") {
            const roms = await listRoms();
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ roms }));
            return;
          }
          const m = req.url?.match(/^\/api\/roms\/([^?#]+)$/);
          if (m) {
            const id = decodeURIComponent(m[1]);
            // safety: reject path traversal
            if (id.includes("/") || id.includes("\\") || id.startsWith(".")) {
              res.statusCode = 400;
              res.end("bad id");
              return;
            }
            const full = path.join(ROMS_DIR, id);
            try {
              const bytes = await fs.readFile(full);
              res.setHeader("Content-Type", "application/octet-stream");
              res.setHeader("Content-Length", String(bytes.length));
              res.end(bytes);
            } catch {
              res.statusCode = 404;
              res.end("not found");
            }
            return;
          }
        } catch (e) {
          // fall through to next
        }
        next();
      });
    },
  };
}

// If the Node server is running on $SERVER_URL (default localhost:8080), we
// proxy /api and /ws to it so the WebSocket session hub works during dev.
// If the proxy fails (server not running), the in-process devRomApi() plugin
// still serves /api/roms so the M0 spike and M1 solo flow work standalone.
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), devRomApi()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    headers: COOP_COEP_HEADERS,
    proxy: {
      "/ws": {
        target: SERVER_URL.replace(/^http/, "ws"),
        ws: true,
      },
      // Note: devRomApi() plugin handles /api/roms in-process when the Node
      // server isn't running. When it IS running, the Vite proxy takes over
      // because middlewares set headers but don't shadow proxies. We still
      // keep devRomApi() as a fallback for the spike.
    },
  },
  preview: {
    headers: COOP_COEP_HEADERS,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
