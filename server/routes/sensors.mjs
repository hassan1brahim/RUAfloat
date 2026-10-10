// Street water sensors: the ESP32 (or hardware/sim_sensor.mjs) posts distances; the map reads depths.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readBody, send } from "../lib/http.mjs";
import { createSensors } from "../sensors.mjs";

/** Constant-time compare; no token configured means every reading is rejected. */
export function tokenOk(header, token = process.env.SENSOR_TOKEN || "") {
  if (!token || typeof header !== "string") return false;
  const a = Buffer.from(header), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default function register(api, ctx) {
  const config = JSON.parse(fs.readFileSync(path.join(ctx.server, "sensors.config.json"), "utf8"));
  const sensors = createSensors(config);
  ctx.health.sensors = config.length;
  ctx.health.sensor_token = !!process.env.SENSOR_TOKEN;
  api.get("/api/sensors", async (req, res) => send(res, 200, sensors.list()));
  api.post(/^\/api\/sensors\/([a-z0-9-]+)$/, async (req, res, m) => {
    if (!tokenOk(req.headers["x-sensor-token"])) return send(res, 401, { error: "bad sensor token" });
    const r = sensors.addReading(m[1], await readBody(req, 10_000));
    console.log(`${r.time} ${r.id} depth ${r.depth_cm} cm -> ${r.status}`);
    send(res, 200, r);
  });
}
