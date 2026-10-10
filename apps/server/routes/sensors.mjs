import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readStore, writeStore } from "../lib/jsonStore.mjs";

const SENSOR_TOKEN = process.env.SENSOR_TOKEN || "demo-sensor-token";
const CONFIG = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../sensors.config.json"), "utf8"));

const router = Router();

router.get("/sensors", (req, res) => {
  const readings = readStore("sensor-readings", {});
  res.json(CONFIG.map((s) => {
    const history = readings[s.id] || [];
    return { ...s, latest: history.at(-1) ?? null, history: history.slice(-60) };
  }));
});

router.post("/sensors/:id", (req, res) => {
  if (req.headers["x-sensor-token"] !== SENSOR_TOKEN) return res.status(401).json({ error: "bad sensor token" });
  const sensor = CONFIG.find((s) => s.id === req.params.id);
  if (!sensor) return res.status(404).json({ error: "unknown sensor" });
  const distanceCm = Number(req.body.distanceCm);
  if (!(distanceCm >= 0 && distanceCm < 1000)) return res.status(400).json({ error: "distanceCm 0-1000 required" });
  const readings = readStore("sensor-readings", {});
  const reading = { at: new Date().toISOString(), distanceCm, depthCm: Math.max(0, Math.round(sensor.mountCm - distanceCm)) };
  readings[sensor.id] = [...(readings[sensor.id] || []), reading].slice(-240);
  writeStore("sensor-readings", readings);
  res.json(reading);
});

export default router;
