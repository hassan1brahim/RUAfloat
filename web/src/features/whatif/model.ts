/**
 * Forecast timelines and "what closes when", shared by the What-if views.
 * Stage in feet; the flood model's closing levels are in decimetres of rise above BASE_FT (see riseDmOf).
 */
import { BASE_FT } from "../../core/util";

export type Source = "now" | "our model" | "NWS";
export type Point = { t: number; ft: number; err: number; source: Source; actual?: number | null };
export type Item = { name: string; kind: "road" | "building"; closeFt: number; lon: number; lat: number };
export type Closure = Item & { at: number; ftAt: number; confidence: "likely" | "uncertain"; actualAt?: number | null };

export const dmToFt = (dm: number) => BASE_FT + dm / 3.048;
const HOUR = 3600e3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Value at time t from (time, value) pairs sorted by time; null outside their range. */
function interp(pairs: [number, number][], t: number): number | null {
  if (!pairs.length || t < pairs[0][0] || t > pairs[pairs.length - 1][0]) return null;
  for (let i = 1; i < pairs.length; i++) {
    const [t0, v0] = pairs[i - 1], [t1, v1] = pairs[i];
    if (t <= t1) return lerp(v0, v1, t1 === t0 ? 1 : (t - t0) / (t1 - t0));
  }
  return pairs[pairs.length - 1][1];
}

/**
 * Hourly timeline: our ML model for 0–18 h (it beats "the level stays the same" there, and we measured its error),
 * then the official NWS forecast out to `hours`. Errors are the model's held-out high-water errors; past 18 h the
 * NWS publishes no error, so the 18 h error is carried forward and labelled as an assumption in the UI.
 */
export function buildTimeline(o: {
  start: number; nowFt: number; ml: { h: number; ft: number }[]; err: Record<number, number>;
  nws?: [string, number][]; hours?: number; actual?: (t: number) => number | null;
}): Point[] {
  const hours = o.hours ?? 48;
  const ml: [number, number][] = ([[0, o.nowFt], ...o.ml.map((p) => [p.h, p.ft])] as [number, number][]).sort((a, b) => a[0] - b[0]);
  const errs: [number, number][] = ([[0, 0], ...Object.entries(o.err).map(([h, e]) => [+h, e])] as [number, number][]).sort((a, b) => a[0] - b[0]);
  const lastMlH = ml[ml.length - 1][0], lastErr = errs[errs.length - 1][1];
  const nws = (o.nws ?? []).map(([t, v]) => [Date.parse(t), v] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: Point[] = [];
  for (let h = 0; h <= hours; h++) {
    const t = o.start + h * HOUR;
    let ft: number | null, source: Source;
    if (h <= lastMlH) { ft = interp(ml, h); source = h === 0 ? "now" : "our model"; }
    else {
      ft = interp(nws, t);
      if (ft == null) break;   // nothing honest to show past the last forecast point
      source = "NWS";
    }
    out.push({ t, ft: +ft!.toFixed(2), err: +(interp(errs, Math.min(h, errs[errs.length - 1][0])) ?? lastErr).toFixed(2), source, actual: o.actual?.(t) ?? undefined });
  }
  return out;
}

/** Everything that floods inside the timeline (and wasn't flooded at hour 0), in time order. */
export function closures(points: Point[], items: Item[], actualClose?: (closeFt: number) => number | null): { upcoming: Closure[]; already: Item[] } {
  const now = points[0]?.ft ?? 0;
  const already = items.filter((i) => i.closeFt <= now);
  const upcoming: Closure[] = [];
  for (const it of items) {
    if (it.closeFt <= now) continue;
    const central = points.find((p) => p.ft >= it.closeFt);
    const upper = points.find((p) => p.ft + p.err >= it.closeFt);
    if (!upper) continue;
    const likely = points.some((p) => p.ft - p.err >= it.closeFt);
    const at = central ?? upper;
    upcoming.push({ ...it, at: at.t, ftAt: at.ft, confidence: likely ? "likely" : "uncertain", actualAt: actualClose?.(it.closeFt) });
  }
  upcoming.sort((a, b) => a.at - b.at || a.closeFt - b.closeFt);
  return { upcoming, already };
}

/** First time a real stage series reaches `ft`, or null. */
export function firstReach(series: [string, number][], ft: number): number | null {
  const p = series.find(([, v]) => v >= ft);
  return p ? Date.parse(p[0]) : null;
}

export type IdaHour = { t: string; now: number; pred: Record<string, number>; actual: Record<string, number | null> };

/**
 * How early our model would have warned during Ida: the first hour at which any of its forecasts (3/6/12/18 h)
 * reached the item's closing level, before the river actually got there. Lead time = actual closing - warning.
 */
export function idaWarning(hours: IdaHour[], series: [string, number][], closeFt: number) {
  const actual = firstReach(series, closeFt);
  // Never reached, or "flooded" before the storm started (bridges over the river read as river level): not a warning case.
  if (actual == null || actual <= Date.parse(series[0][0])) return null;
  const warn = hours.find((x) => Date.parse(x.t) < actual && Object.values(x.pred).some((v) => v >= closeFt));
  return { actual, warnedAt: warn ? Date.parse(warn.t) : null, leadH: warn ? Math.round((actual - Date.parse(warn.t)) / HOUR) : 0 };
}
