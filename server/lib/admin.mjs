// Admin view: turns the model, the river outlook and the field signals into the few things an admin acts on.
// Pure functions: every input is passed in, so the same code answers Live, the Ida replay and What-if.
import { statusFor } from "../sensors.mjs";

export const BASE_FT = 17.0;              // Bound Brook stage treated as "no rise" (same as web/src/core/util.ts)
export const NEVER = 65535;               // grid value for "never floods in the modelled range"
const NEAR_FT = 3;                        // "within ~3 ft of the water"
const REVIEW_MS = 3 * 3600e3;             // reports older than this no longer need a decision
const GENERIC = /^(footpath|path|service road|bike path|steps|unnamed road|walkway|access road)$/;
const USE = { RES: "housing", ACAD: "academic", ADM: "admin", RSCH: "research", SUPT: "support", MED: "clinic", STLIF: "student life", ATH: "athletics", AGRSCH: "agriculture" };

/** River rise (dm, the grid's unit) for a Bound Brook stage. */
export const riseDm = (ft) => Math.max(0, Math.round((ft - BASE_FT) * 3.048));
/** Bound Brook stage (ft) at which a grid threshold (dm) is reached, or null if never. */
export const stageAt = (dm) => (dm >= NEVER ? null : +(BASE_FT + dm / 3.048).toFixed(1));
const useLabel = (u) => (u === "RES-Dorm" ? "dorm" : u === "SUPT-Util" ? "utility plant" : USE[u.split("-")[0]] ?? u);

/** First time in the outlook when the river reaches `ft`, or null. */
function firstReach(outlook, ft) {
  if (ft == null) return null;
  return outlook?.find(([, v]) => v >= ft)?.[0] ?? null;
}

/** Buildings ranked by how close the water is: reached first, then by feet to go. */
export function rankBuildings(buildings, stageFt, outlook, top = 8) {
  const rise = riseDm(stageFt);
  const all = buildings.map((b) => {
    const touchFt = stageAt(b.touch), deepFt = stageAt(b.deep);
    const status = b.deep <= rise ? "deep" : b.touch <= rise ? "at walls" : touchFt != null && touchFt - stageFt <= NEAR_FT ? "near" : "dry";
    return {
      id: b.id, name: b.name, use: useLabel(b.use), housing: b.use.startsWith("RES"), site: b.site, lon: b.lon, lat: b.lat,
      touch_ft: touchFt, deep_ft: deepFt, margin_ft: touchFt == null ? null : +(touchFt - stageFt).toFixed(1), status,
      reached_at: status === "deep" || status === "at walls" ? null : firstReach(outlook, touchFt),
    };
  }).filter((b) => b.touch_ft != null);
  const order = { deep: 0, "at walls": 1 };
  all.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.margin_ft - b.margin_ft);
  const n = (s) => all.filter((b) => b.status === s).length;
  return {
    top: all.slice(0, top),
    summary: { deep: n("deep"), at_walls: n("at walls"), near: n("near"), reached_in_outlook: all.filter((b) => b.reached_at).length,
      housing_reached: all.filter((b) => b.housing && (b.status === "deep" || b.status === "at walls")).length, mapped: buildings.length },
  };
}

/** Named roads: closed now, closing within the outlook, then the next ones to go. */
export function roadTimeline(roads, stageFt, outlook, sensors = [], top = 10) {
  const rise = riseDm(stageFt), byName = new Map();
  for (const e of roads.edges) {
    const name = roads.names[e[4]];
    if (!name || GENERIC.test(name)) continue;
    const r = byName.get(name) ?? { name, walk: NEVER, vehicles: NEVER, meters: 0, at: null };
    if (e[3] < r.walk && roads.nodes) r.at = [roads.nodes[2 * e[0]], roads.nodes[2 * e[0] + 1]];   // where the road floods first; nodes are flat lon,lat pairs
    r.walk = Math.min(r.walk, e[3]);
    r.vehicles = Math.min(r.vehicles, e[7]);
    if (e[3] <= rise) r.meters += e[2];
    byName.set(name, r);
  }
  const observed = new Map(sensors.filter((s) => s.status === "closed_walking" || s.status === "closed_vehicles").map((s) => [s.road, s]));
  const out = [...byName.values()].filter((r) => r.walk < NEVER).map((r) => {
    const walkFt = stageAt(r.walk), s = observed.get(r.name);
    const closedNow = r.walk <= rise || !!s;
    return {
      name: r.name, lon: r.at?.[0] ?? null, lat: r.at?.[1] ?? null, closes_walking_ft: walkFt, closes_vehicles_ft: stageAt(r.vehicles), margin_ft: +(walkFt - stageFt).toFixed(1),
      status: closedNow ? "closed" : firstReach(outlook, walkFt) ? "closing" : "open",
      closes_at: closedNow ? null : firstReach(outlook, walkFt),
      closed_m: Math.round(r.meters), observed: s ? `${s.name}: ${s.reading.depth_cm} cm` : null,
    };
  });
  const order = { closed: 0, closing: 1, open: 2 };
  out.sort((a, b) => order[a.status] - order[b.status] || a.margin_ft - b.margin_ft);
  return {
    roads: out.filter((r) => r.status !== "open").concat(out.filter((r) => r.status === "open")).slice(0, Math.max(top, out.filter((r) => r.status !== "open").length)),
    summary: { closed: out.filter((r) => r.status === "closed").length, closing: out.filter((r) => r.status === "closing").length },
  };
}

/** What changed, newest first: alerts, sensor tier changes, reports and their reviews. Always real time, never a scenario. */
export function feed({ alerts = [], sensors = [], reports = [], dispatches = [], forecastPeak = null }, limit = 15) {
  const ev = [];
  for (const a of alerts) ev.push({ time: a.onset ?? null, kind: "alert", level: /Severe|Extreme/.test(a.severity) ? "bad" : "warn", text: `NWS: ${a.event}` });
  for (const s of sensors) {
    let prev = null;
    for (const r of s.history ?? []) {
      const st = statusFor(r.depth_cm);
      if (st !== prev && prev !== null) ev.push({ time: r.time, kind: "sensor", level: st.startsWith("closed") ? "bad" : st === "caution" ? "warn" : "ok",
        text: `${s.name}: ${r.depth_cm} cm, ${st.replace("_", " to ")}` });
      prev = st;
    }
    if (s.stale) ev.push({ time: s.reading?.time ?? null, kind: "sensor", level: "warn", text: `${s.name}: no reading for 15+ min` });
  }
  for (const r of reports) {
    const ai = r.ai ?? {}, dc = ai.depth_cm;
    ev.push({ time: r.time, kind: "report", level: ai.water_on_ground ? "warn" : "ok",
      text: `Photo report: ${ai.error ? "photo check failed" : ai.water_on_ground ? `water${dc ? `, ${dc[0]}–${dc[1]} cm` : ""}` : "no water seen"}`, report: r.id });
    if (r.review) ev.push({ time: r.review.at, kind: "review", level: r.review.verdict === "confirmed" ? "bad" : "ok", text: `Report ${r.review.verdict} by admin`, report: r.id });
  }
  for (const d of dispatches) for (const h of d.history)
    ev.push({ time: h.at, kind: "dispatch", level: h.status === "pending" ? "warn" : "ok",
      text: h.status === "pending" ? `Dispatch: ${d.unit} sent to ${d.target}` : `Dispatch: ${d.unit} ${h.status.replace("-", " ")} at ${d.target}` });
  if (forecastPeak) ev.push({ time: forecastPeak.issued, kind: "forecast", level: forecastPeak.ft >= 28 ? "warn" : "ok", text: `NWS forecast peak ${forecastPeak.ft} ft at Bound Brook` });
  return ev.filter((e) => e.time).sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, limit);
}

/** Reports waiting for an admin decision: recent, not yet reviewed, and showing water or an unclear photo. */
export function reviewQueue(reports, now = Date.now()) {
  return reports
    .filter((r) => !r.review && now - Date.parse(r.time) < REVIEW_MS && !(r.ai?.usable && r.ai.water_on_ground === false))
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .map((r) => ({ id: r.id, time: r.time, lat: r.lat, lon: r.lon, note: r.note, photo: `/api/reports/${r.id}/photo`,
      ai: { water: !!r.ai?.water_on_ground, depth_cm: r.ai?.depth_cm ?? null, reference: r.ai?.depth_reference ?? null, concerns: r.ai?.concerns ?? r.ai?.error ?? null } }));
}
