// Live ML river forecast: runs the gradient-boosted trees trained by train_forecast.py on the latest readings
// from the same 7 gauges (via NWS NWPS) and, when the model uses it, the rain that has fallen at Somerset Airport
// (the same IEM ASOS feed it was trained on). No Python is needed at runtime.
import fs from "node:fs";

import { UA } from "./http.mjs";
import { cleanObserved } from "./gauge.mjs";

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

  /** Hourly rain (inches) at an ASOS station for the last 2 days, keyed by UTC hour, from the routine :5x reports. */
  async function rainByHour(station) {
    const d0 = new Date(Date.now() - 2 * 86400e3), d1 = new Date(Date.now() + 86400e3);
    const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${station}&data=p01i&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&report_type=3&report_type=4`
      + `&year1=${d0.getUTCFullYear()}&month1=${d0.getUTCMonth() + 1}&day1=${d0.getUTCDate()}&year2=${d1.getUTCFullYear()}&month2=${d1.getUTCMonth() + 1}&day2=${d1.getUTCDate()}`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`rain gauge ${r.status}`);
    const out = new Map();
    for (const line of (await r.text()).trim().split("\n").slice(1)) {
      const [, valid, v] = line.split(",");
      if (+valid.slice(14, 16) < 50 || v === "M") continue;
      out.set(`${valid.slice(0, 10)}T${valid.slice(11, 13)}`, +v < 0.001 ? 0 : +v);
    }
    return out;
  }

  return async function forecast() {
    const m = load();
    if (!m) return { error: "model not trained yet (run scripts/train_forecast.py)" };
    if (cache.value && Date.now() - cache.at < 10 * 60e3) return cache.value;
    const lids = Object.keys(m.gauges);
    const series = Object.fromEntries(await Promise.all(lids.map(async (lid) => {
      const r = await fetch(`https://api.water.noaa.gov/nwps/v1/gauges/${lid}/stageflow`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      const d = r.ok ? await r.json() : null;
      return [lid, cleanObserved(d?.observed?.data ?? []).map((p) => [p.validTime, p.primary])];
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
    let rain = null;
    if (m.rain) {
      let byHour;
      try { byHour = await rainByHour(m.rain.station); } catch (e) { return { error: `no live rain readings (${e.message})` }; }
      const sum = (w) => { let v = 0; for (let k = 0; k < w; k++) v += byHour.get(new Date(now - k * 3600e3).toISOString().slice(0, 13)) ?? 0; return +v.toFixed(2); };
      rain = Object.fromEntries(m.rain.windows_h.map((w) => [`last_${w}h_in`, sum(w)]));
      x.push(...m.rain.windows_h.map(sum));
    }
    if (missing.length || x.some((v) => !Number.isFinite(v))) return { error: `missing live readings: ${missing.join(", ") || "lags"}` };
    const base = at(tgt, now);
    const out = {
      issued: new Date(now).toISOString(), now_ft: base,
      predictions: m.horizons.map((h) => ({ h, at: new Date(now + h * 3600e3).toISOString(), ft: Math.round((base + predict(m.models[String(h)], x)) * 100) / 100 })),
      scores: m.scores, trained_on: m.trained_on, inputs: lids, rain: rain && { station: m.rain.station, ...rain },
    };
    cache = { at: Date.now(), value: out };
    return out;
  };
}
