/** Reference layers: FEMA 100/500-year flood zones (long-term risk sanity check) and satellite imagery. */
import type { Feature } from "../../core/app";

const feature: Feature = {
  id: "layers",
  init(app) {
    const m = app.map;
    const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
    m.addSource("sat", { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, attribution: "Imagery © Esri" });
    m.addLayer({ id: "satellite", type: "raster", source: "sat", paint: { "raster-opacity": 0.85 } }, firstSymbol);
    m.addSource("fema", { type: "geojson", data: "/data/fema.json", attribution: "Flood zones: FEMA NFHL" });
    m.addLayer({ id: "fema", type: "fill", source: "fema", paint: { "fill-color": ["match", ["get", "cls"], "100yr", "#f59e0b", "#a78bfa"], "fill-opacity": 0.22 } }, "buildings");
    app.toggle("FEMA flood zones", ["fema"], false);
    app.toggle("Satellite", ["satellite"], false);
  },
};
export default feature;
