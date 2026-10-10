// Dispatch: an admin decision to send a named unit to a flagged road or building, tracked to "cleared".
// This records the decision on our own server. It does not contact any real station.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const STATUSES = ["pending", "acknowledged", "en-route", "on-scene", "cleared"];
export const NEXT = { pending: "acknowledged", acknowledged: "en-route", "en-route": "on-scene", "on-scene": "cleared" };
const UNIT_KINDS = new Set(["police", "fire", "hospital"]);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Meters between two points (equirectangular; fine at campus scale). */
export function metersBetween(aLon, aLat, bLon, bLat) {
  const kx = Math.cos((aLat * Math.PI) / 180) * 111_320, ky = 110_540;
  return Math.hypot((aLon - bLon) * kx, (aLat - bLat) * ky);
}

/** Nearest police, fire and hospital places to a point, closest first. */
export function nearestUnits(places, lon, lat, n = 6) {
  return places.filter((p) => UNIT_KINDS.has(p.kind))
    .map((p) => ({ name: p.name, kind: p.kind, lon: p.lon, lat: p.lat, meters: Math.round(metersBetween(lon, lat, p.lon, p.lat)) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, n);
}

export function createDispatch({ liveDir, now = () => new Date() }) {
  fs.mkdirSync(liveDir, { recursive: true });
  const file = path.join(liveDir, "dispatch.json");
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  const save = () => fs.writeFileSync(file, JSON.stringify(list, null, 1));

  function add({ target, kind, lon, lat, unit, note }) {
    if (!target || !["road", "building"].includes(kind)) throw bad("target and kind (road|building) required");
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw bad("lon and lat required");
    if (!String(unit || "").trim()) throw bad("unit required");
    const t = String(target).slice(0, 200);
    if (list.some((d) => d.target === t && d.status !== "cleared")) throw bad("already dispatched to this target", 409);
    const at = now().toISOString();
    const rec = { id: crypto.randomUUID().slice(0, 8), target: t, kind, lon: +lon, lat: +lat, unit: String(unit).trim().slice(0, 80),
      note: String(note || "").slice(0, 280), created: at, status: "pending", history: [{ status: "pending", at }] };
    list.unshift(rec);
    save();
    return rec;
  }

  /** Moves one step forward. `from` must match the current status, so two screens clicking at once can't skip a step. */
  function advance(id, from) {
    const rec = list.find((d) => d.id === id);
    if (!rec) throw bad("no such dispatch", 404);
    if (from !== rec.status) throw Object.assign(bad(`already ${rec.status}`, 409), { current: rec });
    const to = NEXT[rec.status];
    if (!to) throw bad("already cleared", 409);
    rec.status = to;
    rec.history.push({ status: to, at: now().toISOString() });
    save();
    return rec;
  }

  return { list: () => list, add, advance };
}
