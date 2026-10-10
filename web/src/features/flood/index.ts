/** Flood extent: paints the precomputed height-above-river grid for the current river rise. */
import type { CanvasSource } from "maplibre-gl";
import type { Feature } from "../../core/app";
import { FloodGrid } from "../../lib/flood";
import { ic, waterGradientIcon } from "../../core/icons";

declare module "../../core/app" { interface Services { grid: FloodGrid; floodedKm2: () => number } }

let km2 = 0;

const feature: Feature = {
  id: "flood",
  async init(app) {
    const grid = await FloodGrid.load();
    const [w, s, e, n] = grid.meta.bounds;
    app.map.addSource("flood", { type: "canvas", canvas: grid.canvas, animate: false, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
    app.map.addLayer({ id: "flood", type: "raster", source: "flood", paint: { "raster-opacity": 0.92, "raster-fade-duration": 0 } }, "buildings");
    app.toggle("Flood zone (predicted water)", ["flood"], true, "Flooding", { key: "flood" });
    app.toggle("3D buildings", ["buildings"], true, "Base map", { views: "admin" });
    app.legend(`<div>${ic("water", "#7dd3fc")}&lt; 30 cm</div><div>${ic("water", "#3898ec")}30 cm–1 m</div>
      <div>${ic("water", "#1d63d6")}1–2.5 m</div><div>${ic("water", "#17379f")}&gt; 2.5 m</div>`, { views: "admin", key: "flood" });
    app.legend(`<div>${waterGradientIcon("lg-water-grad", "#7dd3fc", "#17379f")}Flood water (darker = deeper)</div>`, { views: "student", key: "flood" });
    app.provide("grid", grid);
    app.provide("floodedKm2", () => km2);
  },
  update(app) {
    km2 = app.get("grid").render(app.rise());
    const src = app.map.getSource("flood") as CanvasSource;
    src.play(); app.map.triggerRepaint(); app.map.once("render", () => src.pause());
  },
};
export default feature;
