/** Observation rules: when a sensor or student report closes a road segment, and with what evidence. */
import { et, metersBetween } from "../../core/util";
import type { FloodGrid } from "../../lib/flood";
import type { Closed, Router } from "../../lib/route";
import type { Evidence } from "../roads";

export type ReportAI = { usable?: boolean; water_on_ground?: boolean; depth_cm?: [number, number] | null; depth_reference?: string;
  looks_like_flood?: boolean; concerns?: string | null; confidence?: number; error?: string };
export type Report = { id: string; time: string; lat: number; lon: number; note: string; hash?: string; ai: ReportAI; model: string;
  review?: { verdict: "confirmed" | "rejected"; at: string } };
export type Sensor = { id: string; name: string; road: string; lat: number; lon: number; mount_cm: number;
  reading: { time: string; depth_cm: number } | null; history: { time: string; depth_cm: number }[]; stale: boolean; status: string };
export type Camera = { id: string; name: string; lid: string; lat: number; lon: number; image: string | null; time: string | null;
  gauge: { stage: number; time: string; category: string; categories: Record<string, { stage: number }> } | null;
  samples: { label: string; image: string; file: string; time: string }[] };
export type CameraCheck = { camera: string; file: string; image: string; time: string; agreement: string; model: string;
  vision: { image_usable: boolean; water_state: string; change_vs_reference: string; confidence: number };
  gauge: { stage: number; time: string } | null; error?: string };

export type ReportStatus = { status: "confirmed" | "unconfirmed" | "rejected"; why: string };

/** Walking closure. NWS: ~15 cm of moving water can knock an adult down; 30 cm can carry a car. */
const CLOSE_CM = 15;
const VEHICLE_CM = 30;
const NEAR_M = 30;            // an observation applies to road segments within 30 m
const SENSOR_FRESH_MS = 15 * 60e3;
const REPORT_FRESH_MS = 3 * 3600e3;
const CORROBORATE_M = 150;


/**
 * One report never closes a road on its own. It is confirmed when the photo shows >= 15 cm of water AND
 * either the model also predicts water there or another recent report within 150 m agrees.
 */
export function reportStatus(r: Report, all: Report[], grid: FloodGrid, riseDm: number): ReportStatus {
  if (r.review) return { status: r.review.verdict, why: `${r.review.verdict} by admin` };   // a person's decision beats the rules
  const ai = r.ai;
  if (ai.error || ai.usable === false) return { status: "rejected", why: ai.error ? "photo check failed" : `photo not usable${ai.concerns ? ` (${ai.concerns})` : ""}` };
  if (!ai.water_on_ground) return { status: "rejected", why: "no water visible in the photo" };
  const deep = (ai.depth_cm?.[1] ?? 0) >= CLOSE_CM;
  const modelWet = grid.depthAt(r.lon, r.lat, riseDm) > 0;
  // distinct photos only: a re-sent photo is not a second witness (reports without a hash, from before this check, never corroborate)
  const neighbors = new Set(all.filter((o) => o.id !== r.id && o.hash && r.hash && o.hash !== r.hash && o.ai.water_on_ground && metersBetween(o, r) <= CORROBORATE_M
    && Math.abs(Date.parse(o.time) - Date.parse(r.time)) < REPORT_FRESH_MS).map((o) => o.hash)).size;
  const support = [modelWet && "model predicts water here", neighbors && `${neighbors} nearby report${neighbors > 1 ? "s" : ""} agree`].filter(Boolean).join(", ");
  if (deep && support) return { status: "confirmed", why: support };
  return { status: "unconfirmed", why: !deep ? "photo shows shallow water" : "deep water: sent to the coordinator to confirm" };
}

/** Road segments closed by observations, plus the evidence attached to each segment. */
export function observe(router: Router, grid: FloodGrid, riseDm: number, reports: Report[], sensors: Sensor[], now = Date.now()) {
  const closed: Closed = new Set();
  const byEdge = new Map<number, Evidence[]>();
  const statuses = new Map<string, ReportStatus>();
  const attach = (lon: number, lat: number, ev: Evidence) => {
    for (const ei of router.edgesNear(lon, lat, NEAR_M)) {
      (byEdge.get(ei) ?? byEdge.set(ei, []).get(ei)!).push(ev);
      if (ev.closes) closed.add(ei);
    }
  };
  for (const s of sensors) {
    if (!s.reading || now - Date.parse(s.reading.time) > SENSOR_FRESH_MS) continue;
    const d = s.reading.depth_cm;
    attach(s.lon, s.lat, { kind: "sensor", closes: d >= CLOSE_CM, time: s.reading.time,
      text: `Sensor "${s.name}": ${d} cm of water at ${et(s.reading.time)}${d >= VEHICLE_CM ? " (≥ 30 cm: closed to walking and vehicles)" : d >= CLOSE_CM ? " (≥ 15 cm: closed to walking)" : d > 0 ? " (shallow: caution)" : " (dry)"}` });
  }
  const fresh = reports.filter((r) => now - Date.parse(r.time) < REPORT_FRESH_MS);
  for (const r of reports) {
    const st = reportStatus(r, fresh, grid, riseDm);
    statuses.set(r.id, st);
    if (now - Date.parse(r.time) >= REPORT_FRESH_MS || st.status === "rejected") continue;
    const dc = r.ai.depth_cm;
    attach(r.lon, r.lat, { kind: "report", closes: st.status === "confirmed", time: r.time,
      text: `Student photo ${et(r.time)}: AI sees ${dc ? `${dc[0]}–${dc[1]} cm` : "water"} · ${st.status} (${st.why})` });
  }
  return { closed, byEdge, statuses };
}

/** Shrink a phone photo before upload (max 1280 px, JPEG). */
export async function shrinkPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}
