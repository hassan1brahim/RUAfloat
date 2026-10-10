// Rain flooding: how much rain has fallen at each known rain-flood spot (NOAA MRMS radar estimates, 1 km),
// and how much is forecast on campus (NWS gridpoint QPF). River flooding is handled elsewhere; this is street flooding.
import fs from "node:fs";
import path from "node:path";
import { UA, cached, getJson, send } from "../lib/http.mjs";

const MRMS = "https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer/identify";
const NWS_GRID = "https://api.weather.gov/gridpoints/PHI/71,107";   // the NWS grid cell over College Avenue
const MM_PER_IN = 25.4;

/** Radar rain totals (inches) for the last 1, 3, 6 and 12 hours at one point. */
async function radarAt(lon, lat) {
  const geometry = encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  const url = `${MRMS}?geometry=${geometry}&geometryType=esriGeometryPoint&returnCatalogItems=true&returnGeometry=false&f=json`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`MRMS ${r.status}`);
  const j = await r.json();
  const names = (j.catalogItems?.features ?? []).map((f) => f.attributes.name);
  const valid = Math.max(...(j.catalogItems?.features ?? []).map((f) => f.attributes.idp_validendtime ?? 0));
  const val = (period) => { const i = names.indexOf(`conus_QPE_${period}`); const v = i >= 0 ? Number(j.properties?.Values?.[i]) : NaN; return Number.isFinite(v) && v >= 0 ? +v.toFixed(2) : null; };
  return { rain_1h_in: val("01H"), rain_3h_in: val("03H"), rain_6h_in: val("06H"), rain_12h_in: val("12H"), valid_until: valid ? new Date(valid).toISOString() : null };
}

/** NWS rain forecast on campus, summed over the next 6, 12 and 24 hours (inches). */
async function forecast() {
  const p = (await getJson(NWS_GRID, 12000)).properties;
  const now = Date.now();
  const sum = (hours) => {
    let mm = 0;
    for (const v of p.quantitativePrecipitation?.values ?? []) {
      const [start, dur] = v.validTime.split("/");
      const t0 = Date.parse(start), h = Number(/PT?(\d+)H/.exec(dur)?.[1] ?? 1), t1 = t0 + h * 3600e3;
      const from = Math.max(t0, now), to = Math.min(t1, now + hours * 3600e3);
      if (to > from) mm += (v.value ?? 0) * ((to - from) / (t1 - t0));   // share of the interval inside the window
    }
    return +(mm / MM_PER_IN).toFixed(2);
  };
  return { next_6h_in: sum(6), next_12h_in: sum(12), next_24h_in: sum(24), issued: p.updateTime };
}

export default function register(api, ctx) {
  const spots = JSON.parse(fs.readFileSync(path.join(ctx.webData, "rain_hotspots.json"), "utf8")).spots;

  api.get("/api/rain", async (req, res) => {
    const data = await cached("rain", 5 * 60e3, async () => {
      const [radar, fc] = await Promise.all([
        Promise.all(spots.map((s) => radarAt(s.lon, s.lat).then((r) => ({ id: s.id, ...r })).catch((e) => ({ id: s.id, error: String(e.message || e) })))),
        forecast().catch((e) => ({ error: String(e.message || e) })),
      ]);
      return { fetched_at: new Date().toISOString(), radar, forecast: fc,
        sources: [{ name: "NOAA MRMS radar rainfall (1 km)", url: "https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer" },
                  { name: "NWS forecast grid PHI 71,107", url: NWS_GRID }] };
    });
    send(res, 200, data);
  });
}
