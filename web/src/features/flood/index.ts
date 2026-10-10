/** Flood extent: paints the precomputed height-above-river grid for the current river rise. */
import type { CanvasSource } from "maplibre-gl";
import type { Feature } from "../../core/app";
import { FloodGrid } from "../../lib/flood";

declare module "../../core/app" { interface Services { grid: FloodGrid; floodedKm2: () => number } }

let km2 = 0;

const feature: Feature = {
  id: "flood",
  async init(app) {
    const grid = await FloodGrid.load();
    const [w, s, e, n] = grid.meta.bounds;
    app.map.addSource("flood", { type: "canvas", canvas: grid.canvas, animate: false, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
    app.map.addLayer({ id: "flood", type: "raster", source: "flood", paint: { "raster-opacity": 0.92, "raster-fade-duration": 0 } }, "buildings");
    app.toggle("Flood extent", ["flood"]);
    app.toggle("3D buildings", ["buildings"]);
    app.legend(`<div><i class="sw" style="background:#7dd3fc"></i>&lt; 30 cm</div><div><i class="sw" style="background:#3898ec"></i>30 cm–1 m</div>
      <div><i class="sw" style="background:#1d63d6"></i>1–2.5 m</div><div><i class="sw" style="background:#17379f"></i>&gt; 2.5 m</div>`);
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
