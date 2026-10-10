/** Public NOAA/NWS feeds for the Raritan River at Bound Brook (gauge BDKN4 / USGS 01403060), Rutgers New Brunswick. */
const UA = "hackru26-admin/0.1 (contact: team)";
const GAUGE = "BDKN4";
const ALERT_POINT = "40.4990,-74.4500";

async function getJson(url, timeoutMs = 15000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url.split("?")[0]} -> ${r.status}`);
  return r.json();
}

/** Current gauge reading + 48h history + NWS forecast curve + active flood alerts near campus. */
export async function fetchLive() {
  const out = { fetchedAt: new Date().toISOString() };
  try {
    const [meta, stageflow] = await Promise.all([
      getJson(`https://api.water.noaa.gov/nwps/v1/gauges/${GAUGE}`),
      getJson(`https://api.water.noaa.gov/nwps/v1/gauges/${GAUGE}/stageflow`),
    ]);
    const cutoff = Date.now() - 48 * 3600e3;
    out.gauge = {
      name: meta.name,
      observedFt: meta.status.observed.primary,
      observedAt: meta.status.observed.validTime,
      floodCategory: meta.status.observed.floodCategory,
      forecastFt: meta.status.forecast?.primary ?? null,
      forecastAt: meta.status.forecast?.validTime ?? null,
      categories: meta.flood.categories,
      impacts: (meta.flood.impacts || []).map((i) => ({ stageFt: i.stage, statement: i.statement.trim() })),
      history: (stageflow.observed?.data || []).filter((d) => Date.parse(d.validTime) >= cutoff).map((d) => [d.validTime, d.primary]),
      forecastSeries: (stageflow.forecast?.data || []).map((d) => [d.validTime, d.primary]),
    };
  } catch (e) {
    out.gaugeError = String(e.message || e);
  }
  try {
    const alerts = await getJson(`https://api.weather.gov/alerts/active?point=${ALERT_POINT}`);
    out.alerts = alerts.features.map((f) => ({
      event: f.properties.event, headline: f.properties.headline, severity: f.properties.severity, instruction: f.properties.instruction,
    }));
  } catch (e) {
    out.alertsError = String(e.message || e);
  }
  return out;
}

const NWM_BASE = "https://maps.water.noaa.gov/server/rest/services";
const CAMPUS_BBOX = "-74.62,40.40,-74.30,40.60";
const NWM_LAYERS = {
  rapidOnset: "nwm/srf_18hr_rapid_onset_flooding",
  highWaterArrival: "nwm/srf_18hr_high_water_arrival_time",
  highWaterProbability: "nwm/srf_12hr_max_high_water_probability",
  inundationExtent: "nwm/ana_inundation_extent",
};

function nwmQueryUrl(service, extra = "") {
  return `${NWM_BASE}/${service}/MapServer/0/query?where=1%3D1&geometry=${CAMPUS_BBOX}&geometryType=esriGeometryEnvelope`
    + `&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=4326&f=geojson${extra}`;
}

/** NOAA National Water Model: flash-flood timing/probability and the live flood-extent polygon for the campus area. */
export async function fetchNwm() {
  const out = { fetchedAt: new Date().toISOString(), errors: {} };
  await Promise.all(Object.entries(NWM_LAYERS).map(async ([key, service]) => {
    try {
      out[key] = await getJson(nwmQueryUrl(service, key === "inundationExtent" ? "&maxAllowableOffset=0.00005" : ""), 25000);
    } catch (e) {
      out.errors[key] = String(e.message || e);
      out[key] = { type: "FeatureCollection", features: [] };
    }
  }));
  return out;
}
