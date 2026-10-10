/** Admin-initiated dispatch signal — the one piece of this app that isn't "processing a feed": a human
 * decision to ping a named unit toward a flagged road or building. Never triggered automatically. */
import { Router } from "express";
import crypto from "node:crypto";
import { readStore, writeStore } from "../lib/jsonStore.mjs";

export const STATUSES = ["pending", "acknowledged", "en-route", "on-scene", "cleared"];
const NEXT = { pending: "acknowledged", acknowledged: "en-route", "en-route": "on-scene", "on-scene": "cleared" };

const router = Router();

router.get("/dispatch", (req, res) => res.json(readStore("dispatch", [])));

router.post("/dispatch", (req, res) => {
  const { target, kind, lat, lon, note, unit } = req.body || {};
  if (!target || !["road", "building"].includes(kind) || !(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
    return res.status(400).json({ error: "target, kind (road|building), lat, lon required" });
  }
  const list = readStore("dispatch", []);
  const createdAt = new Date().toISOString();
  const rec = {
    id: crypto.randomUUID().slice(0, 8), target: String(target).slice(0, 200), kind, lat: +lat, lon: +lon,
    note: String(note || "").slice(0, 280), unit: unit ? String(unit).slice(0, 80) : null,
    createdAt, status: "pending", history: [{ status: "pending", at: createdAt }],
  };
  list.unshift(rec);
  writeStore("dispatch", list);
  res.json(rec);
});

/** Advance (or set) status — pending -> acknowledged -> en-route -> on-scene -> cleared. Accepts an explicit
 * `status`, or omit it to just advance to the next step. */
router.post("/dispatch/:id/status", (req, res) => {
  const list = readStore("dispatch", []);
  const rec = list.find((d) => d.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "no such dispatch" });
  const status = req.body?.status || NEXT[rec.status];
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(", ")}` });
  rec.status = status;
  rec.history = [...(rec.history || []), { status, at: new Date().toISOString() }];
  writeStore("dispatch", list);
  res.json(rec);
});

export default router;
