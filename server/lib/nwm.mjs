// NOAA National Water Model forecast layers around campus (free ArcGIS REST, no key).
// These cover what our river model can't: small streams, flash (rapid-onset) flooding, timing and probability.
const BASE = "https://maps.water.noaa.gov/server/rest/services";
import { UA } from "./http.mjs";
const BBOX = "-74.62,40.40,-74.30,40.60"; // campus plus the reaches just upstream

const LAYERS = {
  rapid: { svc: "nwm/srf_18hr_rapid_onset_flooding", fields: "name,strm_order,flood_start_time,flood_end_time,flood_percent_increase,reference_time" },
  arrival: { svc: "nwm/srf_18hr_high_water_arrival_time", fields: "name,strm_order,high_water_arrival_time,below_bank_return_time,max_flow,high_water_threshold,reference_time" },
  probability: { svc: "nwm/srf_12hr_max_high_water_probability", fields: "name,strm_order,hw_prob_all,reference_time" },
  inundation: { svc: "nwm/ana_inundation_extent", fields: "streamflow_cfs,reference_time" },
};

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "arcgis error");
  return d;
}

const query = (svc, fields, extra = "") =>
  `${BASE}/${svc}/MapServer/0/query?where=1%3D1&geometry=${BBOX}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`
  + `&outFields=${fields}&outSR=4326&geometryPrecision=5&f=geojson${extra}`;

export function createNwm() {
  let cache = { at: 0, value: null };
  let reaches = null;

  /** How many NWM reaches the model runs in this box (static, so fetched once). */
  async function reachCount() {
    if (reaches == null) {
      const d = await getJson(`${BASE}/reference/static_nwm_flowlines/MapServer/0/query?where=1%3D1&geometry=${BBOX}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json`);
      reaches = d.count;
    }
    return reaches;
  }

  /** Latest model run time, from any feature nationally (the local layers are empty when nothing floods). */
  async function referenceTime() {
    const d = await getJson(`${BASE}/${LAYERS.arrival.svc}/MapServer/0/query?where=1%3D1&outFields=reference_time,update_time&returnGeometry=false&resultRecordCount=1&f=json`);
    return d.features?.[0]?.attributes ?? null;
  }

  return async function nwm() {
    if (cache.value && Date.now() - cache.at < 10 * 60e3) return cache.value;
    const out = { fetched_at: new Date().toISOString(), errors: {} };
    await Promise.all([
      ...Object.entries(LAYERS).map(async ([k, l]) => {
        try { out[k] = await getJson(query(l.svc, l.fields, k === "inundation" ? "&maxAllowableOffset=0.00005" : "")); }
        catch (e) { out.errors[k] = String(e.message || e); out[k] = { type: "FeatureCollection", features: [] }; }
      }),
      reachCount().then((n) => (out.reaches_modeled = n)).catch((e) => (out.errors.reaches = String(e.message || e))),
      referenceTime().then((t) => (out.run = t)).catch((e) => (out.errors.run = String(e.message || e))),
    ]);
    out.source = "NOAA National Water Model v3 via maps.water.noaa.gov (experimental products)";
    cache = { at: Date.now(), value: out };
    return out;
  };
}
