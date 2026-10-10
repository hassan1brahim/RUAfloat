/** Student flooding reports — self-reported depth + optional photo, no AI vision step. Corroboration across
 * reports (handled in lib/risk.mjs) is what turns these into a "closed" signal, not a single unverified photo. */
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readStore, writeStore } from "../lib/jsonStore.mjs";

const PHOTO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../data/store/report-photos");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const router = Router();

router.get("/reports", (req, res) => {
  res.json(readStore("reports", []));
});

router.post("/reports", (req, res) => {
  const { lat, lon, note, depthCm, photo } = req.body || {};
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return res.status(400).json({ error: "lat/lon required" });
  const id = crypto.randomUUID().slice(0, 8);
  let ext = null;
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(photo || "");
  if (m) {
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 4_000_000) return res.status(400).json({ error: "photo too large (max 4 MB)" });
    ext = m[1];
    fs.writeFileSync(path.join(PHOTO_DIR, `${id}.${ext}`), buf);
  }
  const reports = readStore("reports", []);
  // No login for students, so IP stands in for "distinct reporter" — good enough to stop one person's
  // phone + laptop (or a resubmitted photo) from corroborating itself into a false "confirmed" closure.
  const rec = { id, time: new Date().toISOString(), lat: +lat, lon: +lon, note: String(note || "").slice(0, 280), depthCm: depthCm != null ? Math.max(0, Math.round(+depthCm)) : null, ext, reporterId: req.ip };
  reports.push(rec);
  writeStore("reports", reports);
  res.json(rec);
});

router.get("/reports/:id/photo", (req, res) => {
  const reports = readStore("reports", []);
  const r = reports.find((x) => x.id === req.params.id);
  if (!r?.ext) return res.status(404).json({ error: "no photo" });
  res.sendFile(path.join(PHOTO_DIR, `${r.id}.${r.ext}`));
});

export default router;
