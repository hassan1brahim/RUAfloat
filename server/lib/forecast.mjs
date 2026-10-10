// Live ML river forecast: runs the gradient-boosted trees trained by scripts/train_forecast.py
// on the latest readings from the same 7 gauges (via NWS NWPS), so no Python is needed at runtime.
import fs from "node:fs";

import { UA } from "./http.mjs";

export function createForecast({ modelFile }) {
  const file = modelFile;
  let model = null, cache = { at: 0, value: null };
  const load = () => { if (!model && fs.existsSync(file)) model = JSON.parse(fs.readFileSync(file, "utf8")); return model; };

  const runTree = (t, x) => { let n = 0; while (t.l[n] !== -1) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n]; return t.v[n]; };
  const predict = (m, x) => m.init + m.lr * m.trees.reduce((s, t) => s + runTree(t, x), 0);

  /** Level at or just before `t` from an NWPS observed series [[iso, ft], ...]. */
  const at = (series, t) => {
    let v = null;
    for (const [iso, ft] of series) { if (Date.parse(iso) <= t) v = ft; else break; }
    return v;
  };

  return async function forecast() {
    const m = load();
    if (!m) return { error: "model not trained yet (run scripts/train_forecast.py)" };
    if (cache.value && Date.now() - cache.at < 10 * 60e3) return cache.value;
    const lids = Object.keys(m.gauges);
    const series = Object.fromEntries(await Promise.all(lids.map(async (lid) => {
      const r = await fetch(`https://api.water.noaa.gov/nwps/v1/gauges/${lid}/stageflow`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      const d = r.ok ? await r.json() : null;
      return [lid, (d?.observed?.data ?? []).filter((p) => p.primary > -999).map((p) => [p.validTime, p.primary])];
    })));
    const latest = Math.min(...lids.map((lid) => Date.parse(series[lid].at(-1)?.[0] ?? 0)));
    const now = Math.floor(latest / 3600e3) * 3600e3;          // last hour every gauge has reported
    const x = [], missing = [];
    for (const lid of lids) {
      const v = at(series[lid], now);
      if (v == null) missing.push(lid);
      x.push(v, ...m.lags.map((l) => v - at(series[lid], now - l * 3600e3)));
    }
    const tgt = series[m.target];
    x.push(at(tgt, now) - at(tgt, now - 12 * 3600e3));
    if (missing.length || x.some((v) => !Number.isFinite(v))) return { error: `missing live readings: ${missing.join(", ") || "lags"}` };
    const base = at(tgt, now);
    const out = {
      issued: new Date(now).toISOString(), now_ft: base,
      predictions: m.horizons.map((h) => ({ h, at: new Date(now + h * 3600e3).toISOString(), ft: Math.round((base + predict(m.models[String(h)], x)) * 100) / 100 })),
      scores: m.scores, trained_on: m.trained_on, inputs: lids,
    };
    cache = { at: Date.now(), value: out };
    return out;
  };
}
