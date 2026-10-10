/** Fuses live OSM roads/buildings with NOAA's live flood-extent polygon + flagged stream reaches, plus
 * local sensor readings and student reports, into attention tiers for the admin view.
 * Original scheme — not the elevation/HAND grid approach: "closed" = actually inside NOAA's live inundation
 * polygon, confirmed by a fresh sensor, or confirmed by two independent, distinct, photographed student
 * reports; "watch" = near a NOAA-flagged reach or a single unconfirmed signal — worth the admin's attention
 * before it floods, not yet acted on. */
import { lineCrossesAnyPolygon, nearestLineDistanceM, metersBetween } from "./geo.mjs";

const WATCH_DISTANCE_M = 300;
const SENSOR_NEAR_M = 30;
const SENSOR_CLOSE_CM = 15;
const SENSOR_FRESH_MS = 15 * 60e3;
const MAX_SAMPLES_PER_ROAD = 6; // bound per-road geometry checks regardless of how many points OSM gave the way

// Report corroboration: one photo report never closes a road. It needs a second, independent report —
// different reporter, both with photos, agreeing within a tight time/distance window of EACH OTHER
// (not just each near the road) — before it counts the same as a sensor or NOAA's own flood-extent polygon.
const REPORT_SHOW_MS = 3 * 3600e3;      // how long an unconfirmed report still shows as a "watch" signal at all
const CORROBORATE_WINDOW_MS = 30 * 60e3; // two reports must agree within this window of each other
const CORROBORATE_DISTANCE_M = 150;      // ...and this distance of each other
const REPORT_NEAR_M = 150;               // report-to-road/building distance to even consider it

/** Tiny order-1 headwater reaches trip their flood threshold most nights at a few cfs — not worth an admin's
 * attention. Keep only reaches NOAA itself tags as a meaningful stream (order >= 2 or a non-trivial flow). */
const isSignificant = (f) => (f.properties?.strm_order ?? 0) >= 2 || (f.properties?.max_flow ?? 0) >= 10;

function flaggedReaches(nwm) {
  return [...(nwm.rapidOnset?.features ?? []), ...(nwm.highWaterArrival?.features ?? []), ...(nwm.highWaterProbability?.features ?? [])].filter(isSignificant);
}

/** Evenly-spaced subset of a coordinate list, capped at n points, so a 200-vertex road costs the same to check as a 4-vertex one. */
function sampleCoords(coords, n = MAX_SAMPLES_PER_ROAD) {
  if (coords.length <= n) return coords;
  const step = (coords.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => coords[Math.round(i * step)]);
}

function sensorSignal(lat, lon, sensors, now) {
  for (const s of sensors) {
    if (!s.latest || now - Date.parse(s.latest.at) > SENSOR_FRESH_MS) continue;
    if (metersBetween([lon, lat], [s.lon, s.lat]) > SENSOR_NEAR_M) continue;
    if (s.latest.depthCm >= SENSOR_CLOSE_CM) return { source: "sensor", tier: "closed", text: `Sensor "${s.name}": ${s.latest.depthCm} cm — closed to walking` };
  }
  return null;
}

/** A report only corroborates another if it's a distinct reporter, has a photo, and agrees within the window. */
function reportSignal(lat, lon, reports, now) {
  const near = reports.filter((r) => now - Date.parse(r.time) < REPORT_SHOW_MS && metersBetween([lon, lat], [r.lon, r.lat]) <= REPORT_NEAR_M);
  if (near.length === 0) return null;

  const eligible = near.filter((r) => r.ext && (r.depthCm ?? 0) >= SENSOR_CLOSE_CM); // has a photo + reports enough depth

  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i], b = eligible[j];
      if (a.reporterId && b.reporterId && a.reporterId === b.reporterId) continue; // same reporter doesn't corroborate themselves
      if (Math.abs(Date.parse(a.time) - Date.parse(b.time)) > CORROBORATE_WINDOW_MS) continue;
      if (metersBetween([a.lon, a.lat], [b.lon, b.lat]) > CORROBORATE_DISTANCE_M) continue;
      return { source: "report-confirmed", tier: "closed", text: `2 independent student reports with photos agree within 30 min: ≥ 15 cm nearby` };
    }
  }
  if (eligible.length === 1) return { source: "report-unconfirmed", tier: "watch", text: `1 student report with photo: ${eligible[0].depthCm} cm — needs a second independent report to confirm` };
  return { source: "report-unconfirmed", tier: "watch", text: `${near.length} student report(s) nearby, not yet confirmed` };
}

function fuse(signals) {
  const present = signals.filter(Boolean);
  const closed = present.find((s) => s.tier === "closed");
  const tier = closed ? "closed" : present.some((s) => s.tier === "watch") ? "watch" : null;
  return { tier, evidence: present.map(({ source, text }) => ({ source, text })), closedBy: closed?.source ?? null };
}

export function computeRoadRisk(roads, nwm, sensors, reports) {
  const now = Date.now();
  const inundation = nwm.inundationExtent?.features ?? [];
  const reaches = flaggedReaches(nwm);
  return roads.map((road) => {
    const mid = road.coords[Math.floor(road.coords.length / 2)];
    const samples = sampleCoords(road.coords);
    const flooded = inundation.length > 0 && lineCrossesAnyPolygon(samples, inundation);
    const nearReach = reaches.length > 0 && samples.some((c) => nearestLineDistanceM(c, reaches) <= WATCH_DISTANCE_M);
    const { tier, evidence, closedBy } = fuse([
      sensorSignal(mid[1], mid[0], sensors, now),
      reportSignal(mid[1], mid[0], reports, now),
      flooded ? { source: "noaa-extent", tier: "closed", text: "Inside NOAA's live flood-extent polygon" } : null,
      nearReach ? { source: "noaa-reach", tier: "watch", text: "Near a NOAA-flagged stream reach" } : null,
    ]);
    return tier ? { ...road, tier, evidence, closedBy } : null;
  }).filter(Boolean);
}

export function computeBuildingRisk(buildings, nwm, sensors, reports) {
  const now = Date.now();
  const inundation = nwm.inundationExtent?.features ?? [];
  const reaches = flaggedReaches(nwm);
  return buildings.map((b) => {
    const pt = [b.lon, b.lat];
    const flooded = inundation.length > 0 && lineCrossesAnyPolygon([pt], inundation);
    const nearReach = reaches.length > 0 && nearestLineDistanceM(pt, reaches) <= WATCH_DISTANCE_M;
    const { tier, evidence, closedBy } = fuse([
      sensorSignal(b.lat, b.lon, sensors, now),
      reportSignal(b.lat, b.lon, reports, now),
      flooded ? { source: "noaa-extent", tier: "closed", text: "Inside NOAA's live flood-extent polygon" } : null,
      nearReach ? { source: "noaa-reach", tier: "watch", text: "Near a NOAA-flagged stream reach" } : null,
    ]);
    return tier ? { ...b, tier, evidence, closedBy } : null;
  }).filter(Boolean);
}
