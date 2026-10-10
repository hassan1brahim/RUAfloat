// HackRU API server. Run: SENSOR_TOKEN=... npm run server
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { createSensors } from "./sensors.mjs";

const PORT = +(process.env.PORT || 8787);
const SENSOR_TOKEN = process.env.SENSOR_TOKEN || "";
const config = JSON.parse(fs.readFileSync(new URL("./sensors.config.json", import.meta.url), "utf8"));
const sensors = createSensors(config);

const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

function tokenOk(header) {
  if (!SENSOR_TOKEN || typeof header !== "string") return false;
  const a = Buffer.from(header), b = Buffer.from(SENSOR_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(req, max = 10_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > max) throw Object.assign(new Error("body too large"), { status: 413 });
  }
  try { return JSON.parse(raw || "{}"); } catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, sensors: config.length, sensor_token: !!SENSOR_TOKEN });
    if (req.method === "GET" && url.pathname === "/api/sensors") return send(res, 200, sensors.list());
    const m = /^\/api\/sensors\/([a-z0-9-]+)$/.exec(url.pathname);
    if (req.method === "POST" && m) {
      if (!tokenOk(req.headers["x-sensor-token"])) return send(res, 401, { error: "bad sensor token" });
      const r = sensors.addReading(m[1], await readJson(req));
      console.log(`${r.time} ${r.id} depth ${r.depth_cm} cm -> ${r.status}`);
      return send(res, 200, r);
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!SENSOR_TOKEN) console.warn("SENSOR_TOKEN not set: sensor readings will be rejected");
  server.listen(PORT, () => console.log(`API on :${PORT}`));
}
