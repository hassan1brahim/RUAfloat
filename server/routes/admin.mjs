// Admin view: ranked buildings, road timeline, what changed, and reports waiting for a decision.
// GET /api/admin?mode=live | ida&t=<iso hour> | whatif&stage=<ft>. Buildings and roads follow the scenario;
// the feed and review queue are always real time, because those are what an admin acts on.
import fs from "node:fs";
import path from "node:path";
import { send } from "../lib/http.mjs";
import { feed, rankBuildings, reviewQueue, roadTimeline } from "../lib/admin.mjs";
import { live } from "./live.mjs";

export default function register(api, ctx) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ctx.webData, f), "utf8"));
  const buildings = read("rutgers_buildings.json"), roads = read("roads.json"), ida = read("ida.json");

  api.get("/api/admin", async (req, res, m, url) => {
    const q = url.searchParams, mode = q.get("mode") || "live";
    const now = await live();
    const g = now.gauge;
    let stageFt, outlook = null, outlookFrom = null;
    if (mode === "ida") {
      const t = q.get("t") || ida.crest[0].slice(0, 13);
      const i = Math.max(0, ida.series.findIndex((p) => p[0] >= t));
      stageFt = ida.series[i][1];
      outlook = ida.series.slice(i + 1);
      outlookFrom = "Ida 2021 record (what actually happened next)";
    } else if (mode === "whatif") {
      stageFt = Number(q.get("stage"));
      if (!(stageFt >= 10 && stageFt <= 50)) return send(res, 400, { error: "stage 10-50 ft required" });
    } else {
      if (!g) return send(res, 502, { error: `live gauge unavailable: ${now.gauge_error ?? "unknown"}` });
      stageFt = g.observed.primary;
      outlook = g.forecastSeries;
      outlookFrom = g.forecastIssued ? `NWS forecast issued ${g.forecastIssued}` : "NWS forecast";
    }
    const peak = outlook?.length ? outlook.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
    const sensors = ctx.sensors?.list() ?? [], reports = ctx.detect?.listReports() ?? [];
    send(res, 200, {
      scenario: { mode, stage_ft: stageFt, outlook_from: outlookFrom, outlook_until: outlook?.at(-1)?.[0] ?? null, peak: peak && { ft: peak[1], at: peak[0] } },
      buildings: rankBuildings(buildings, stageFt, outlook),
      roads: roadTimeline(roads, stageFt, outlook, mode === "live" ? sensors : []),
      feed: feed({ alerts: now.alerts, sensors, reports,
        forecastPeak: g?.forecastSeries?.length ? { ft: Math.max(...g.forecastSeries.map((p) => p[1])), issued: g.forecastIssued } : null }),
      review: reviewQueue(reports),
      sensors: sensors.map((s) => ({ id: s.id, name: s.name, road: s.road, status: s.status, stale: s.stale, depth_cm: s.reading?.depth_cm ?? null, time: s.reading?.time ?? null })),
    });
  });
}
