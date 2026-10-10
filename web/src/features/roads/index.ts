/** Roads: walking router + closures (caution / no walking / observed), highways cut, and the "Impact now" panel. */
import type { GeoJSONSource } from "maplibre-gl";
import type { Feature } from "../../core/app";
import { $, getJson } from "../../core/util";
import { ic } from "../../core/icons";
import { Router } from "../../lib/route";
import "./style.css";

/** Contract for later detection features: road segments closed by real observations, with their evidence. */
export type Evidence = { kind: "sensor" | "report" | "rain"; closes: boolean; text: string; time: string };
export type Observations = { closed: Set<number>; evidence: (ei: number) => Evidence[] };
export const NO_OBSERVATIONS: Observations = { closed: new Set(), evidence: () => [] };
export const GENERIC_ROAD = /^(footpath|path|service road|bike path|steps|unnamed road|walkway|access road)$/;

declare module "../../core/app" { interface Services { router: Router; observations: () => Observations } }

let major: { name: string; block: number }[] = [];

const feature: Feature = {
  id: "roads",
  async init(app) {
    const [router, mj] = await Promise.all([Router.load(), getJson<{ features: { properties: { name: string; block: number } }[] }>("/data/major.json")]);
    major = mj.features.map((f) => f.properties);
    app.provide("router", router);
    const m = app.map;
    m.addSource("closed", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: "closed-obs", type: "line", source: "closed", filter: ["==", ["get", "observed"], true],
      paint: { "line-color": "#ff2d95", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 8] } });
    m.addLayer({ id: "caution", type: "line", source: "closed", filter: ["==", ["get", "tier"], "caution"],
      paint: { "line-color": "#f59e0b", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 3], "line-opacity": 0.85 } });
    m.addLayer({ id: "closed", type: "line", source: "closed", filter: ["==", ["get", "tier"], "closed"],
      paint: { "line-color": "#ef4444", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 4], "line-dasharray": [2, 1] } });
    m.addSource("major", { type: "geojson", data: "/data/major.json" });
    m.addLayer({ id: "major-closed", type: "line", source: "major", filter: ["<=", ["get", "block"], -1],
      paint: { "line-color": "#ff2d55", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7], "line-opacity": 0.9 } });
    m.addLayer({ id: "closed-label", type: "symbol", source: "closed", minzoom: 14.5,
      layout: { "symbol-placement": "line", "text-field": ["concat", ["get", "name"], " · CLOSED"], "text-font": ["Noto Sans Regular"], "text-size": 10 },
      filter: ["all", ["!=", ["get", "tier"], "caution"], ["!", ["in", ["get", "name"], ["literal", ["footpath", "path", "service road", "bike path", "steps", "unnamed road"]]]]],
      paint: { "text-color": "#fca5a5", "text-halo-color": "#140608", "text-halo-width": 1.5 } });
    app.toggle("Closed roads", ["closed", "caution", "closed-obs", "closed-label", "major-closed"], true, "Flooding", { key: "closed" });
    app.legend(`<div>${ic("barrier", "#f59e0b")}Caution: shallow</div><div>${ic("barrier", "#ef4444")}No walking: predicted</div>
      <div>${ic("eye", "#ff2d95")}Closed: observed</div>`, { views: "admin", key: "closed" });
    app.legend(`<div>${ic("barrier", "#ef4444")}Closed to walking</div>`, { views: "student", key: "closed" });
    app.card({ col: "right", id: "impact-card", title: "Impact now", order: 40, html: `
      <div class="stats" id="impact-stats">
        <div><b id="s-area" class="mono">--</b><span>km² under water</span></div>
        <div><b id="s-roads" class="mono">--</b><span>km paths/roads closed</span></div>
        <div><b id="s-hwy" class="mono">--</b><span>highways cut</span></div>
      </div>
      <div class="small muted">Closed named roads</div><div class="chips" id="s-named"></div>` });
  },
  update(app) {
    const router = app.get("router"), rise = app.rise();
    const obs = app.maybe("observations")?.() ?? NO_OBSERVATIONS;
    (app.map.getSource("closed") as GeoJSONSource).setData(router.closedGeoJSON(rise, obs.closed));
    app.map.setFilter("major-closed", ["<=", ["get", "block"], rise]);
    const sum = router.closedSummary(rise);
    const hw = new Set<string>();
    major.forEach((x) => x.block <= rise && x.name !== "highway" && hw.add(x.name.split(";")[0]));
    $("s-area").textContent = (app.maybe("floodedKm2")?.() ?? 0).toFixed(2);
    $("s-roads").textContent = sum.km.toFixed(1);
    $("s-hwy").textContent = hw.size ? [...hw].join(", ") : "0";
    const observedNames = [...new Set([...obs.closed].map((i) => router.edgeName(i)))].filter((n) => !GENERIC_ROAD.test(n));
    $("s-named").innerHTML = [...observedNames.map((n) => `<span class="chip obs" title="closed by a sensor or confirmed report">${n} · observed</span>`),
      ...sum.named.slice(0, 10).map(([n]) => `<span class="chip red">${n}</span>`)].join("") || `<span class="muted small">None</span>`;
  },
  facts(app) {
    const router = app.get("router"), obs = app.maybe("observations")?.() ?? NO_OBSERVATIONS;
    return {
      roads_closed_to_walking: router.closedSummary(app.rise()).named.slice(0, 8).map(([n]) => n),
      roads_closed_by_observation: [...new Set([...obs.closed].map((i) => router.edgeName(i)))].filter((n) => !GENERIC_ROAD.test(n)),
    };
  },
};
export default feature;
