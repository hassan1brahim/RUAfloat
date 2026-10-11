// River feature: Raritan gauge at Bound Brook (NWS NWPS) + active NWS alerts for New Brunswick.
import { cached, getJson, send } from "../lib/http.mjs";
import { cleanObserved } from "../lib/gauge.mjs";

export async function live() {
  return cached("live", 60_000, async () => {
    const out = { fetched_at: new Date().toISOString(), sources: [] };
    try {
      const [meta, sf] = await Promise.all([
        getJson("https://api.water.noaa.gov/nwps/v1/gauges/BDKN4"),
        getJson("https://api.water.noaa.gov/nwps/v1/gauges/BDKN4/stageflow"),
      ]);
      const cutoff = Date.now() - 48 * 3600e3;
      const obs = cleanObserved(sf.observed.data);
      // the headline reading comes from the same feed; if it was a glitch, use the last good reading instead
      const last = obs[obs.length - 1], st = meta.status.observed;
      const observed = last && (st.validTime !== last.validTime || st.primary !== last.primary) && !obs.some((d) => d.validTime === st.validTime)
        ? { ...st, primary: last.primary, validTime: last.validTime } : st;
      out.gauge = {
        name: meta.name, lid: meta.lid, usgsId: meta.usgsId,
        observed, forecast: meta.status.forecast, categories: meta.flood.categories,
        impacts: meta.flood.impacts.map((i) => ({ stage: i.stage, statement: i.statement.trim() })),
        crests: meta.flood.crests.historic.slice(0, 5).map((c) => ({ time: c.occurredTime, stage: c.stage })),
        series: obs.filter((d) => Date.parse(d.validTime) >= cutoff).map((d) => [d.validTime, d.primary]),
        forecastSeries: (sf.forecast?.data || []).map((d) => [d.validTime, d.primary]),
        forecastIssued: sf.forecast?.data?.[0]?.generatedTime ?? null,
      };
      out.sources.push({ name: "NWS NWPS gauge BDKN4 (USGS 01403060)", url: "https://water.noaa.gov/gauges/bdkn4" });
    } catch (e) {
      out.gauge_error = String(e.message || e);
    }
    try {
      const url = "https://api.weather.gov/alerts/active?point=40.4990,-74.4500";
      const a = await getJson(url).catch(() => new Promise((r) => setTimeout(r, 800)).then(() => getJson(url))); // api.weather.gov 500s now and then
      out.alerts = a.features.map((f) => ({ event: f.properties.event, headline: f.properties.headline, severity: f.properties.severity,
        onset: f.properties.onset, ends: f.properties.ends, instruction: f.properties.instruction }));
      out.sources.push({ name: "NWS active alerts (api.weather.gov)", url });
    } catch (e) {
      out.alerts_error = String(e.message || e);
    }
    return out;
  });
}

export default function register(api) {
  api.get("/api/live", async (req, res) => send(res, 200, await live()));
}
