/** Click a road: current condition, predicted onset, depth (New Brunswick range), likelihood, evidence, route consequence. */
import type { Feature } from "../../core/app";
import { BASE_FT } from "../../core/util";
import { NO_OBSERVATIONS } from "../roads";
import { roadPanel } from "./panel";
import "./style.css";

/** Contract for the NOAA feature: forecast sentences for streams near a point. */
declare module "../../core/app" { interface Services { nwmNear: (lon: number, lat: number) => string[] } }

const feature: Feature = {
  id: "roadpanel",
  clickPriority: -10,
  init() {},
  click(app, pt) {
    const router = app.get("router");
    const ei = router.nearestEdge(pt.lon, pt.lat, 25);
    if (ei < 0) return false;
    const river = app.maybe("river"), live = river?.live()?.gauge, obs = app.maybe("observations")?.() ?? NO_OBSERVATIONS;
    const nwmNear = app.maybe("nwmNear");
    app.popup(pt, roadPanel({
      ei, router, grid: app.get("grid"), riseDm: app.rise(), stageFt: app.state.stageFt, baseFt: BASE_FT, mode: app.state.mode,
      forecast: live?.forecastSeries ?? [], forecastIssued: live?.forecastIssued ?? null, observedAt: live?.observed.validTime ?? null,
      ida: river?.ida.series ?? [], floodName: river?.ida.short ?? "the flood", evidence: obs.evidence(ei), observedClosed: obs.closed.has(ei),
      onRoute: !!app.maybe("guide")?.plan()?.edges.includes(ei), noaa: nwmNear ? nwmNear(pt.lon, pt.lat) : null,
    }));
    return true;
  },
};
export default feature;
