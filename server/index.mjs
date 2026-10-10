// RU Afloat API server. Each feature registers its routes from routes/*.mjs; keys stay here, never in the browser.
// Run: npm run dev (with web) or SENSOR_TOKEN=... npm run server
import "./env.mjs";   // first: .env must be loaded before other modules read process.env
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { send } from "./lib/http.mjs";
import { GEMINI_KEY, GEMINI_MODEL } from "./lib/gemini.mjs";
import ROUTES from "./routes/registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = +(process.env.PORT || 8787);
const PROD = process.env.NODE_ENV === "production";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".bin": "application/octet-stream", ".svg": "image/svg+xml", ".mp3": "audio/mpeg" };

/** Shared context for route modules. */
export const ctx = {
  root: ROOT,
  server: HERE,
  webData: path.join(ROOT, "web/public/data"),   // files the pipeline builds
  liveData: path.join(ROOT, "data/live"),        // reports, photos
  health: { ok: true, gemini: !!GEMINI_KEY, elevenlabs: !!process.env.ELEVENLABS_API_KEY, model: GEMINI_MODEL },
};

const table = [];
const api = {
  get: (p, h) => table.push({ method: "GET", p, h }),
  post: (p, h) => table.push({ method: "POST", p, h }),
};
api.get("/api/health", async (req, res) => send(res, 200, ctx.health));
for (const register of ROUTES) await register(api, ctx);

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    for (const r of table) {
      if (r.method !== req.method) continue;
      const m = typeof r.p === "string" ? (r.p === url.pathname ? [url.pathname] : null) : r.p.exec(url.pathname);
      if (m) return await r.h(req, res, m, url);
    }
    if (PROD && !url.pathname.startsWith("/api/")) {
      const dist = path.join(ROOT, "web/dist");
      let file = path.normalize(path.join(dist, url.pathname));
      if (file !== dist && !file.startsWith(dist + path.sep)) return send(res, 403, { error: "forbidden" });
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      return fs.createReadStream(file).pipe(res);
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, e.status || 502, { error: String(e.message || e) });
  }
});

// Compare paths, not URLs: import.meta.url percent-encodes spaces, so the URL check never matched in folders with spaces.
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!process.env.SENSOR_TOKEN) console.warn("SENSOR_TOKEN not set: sensor readings will be rejected");
  server.listen(PORT, () => console.log(`API on :${PORT} · ${table.length} routes`));
}
