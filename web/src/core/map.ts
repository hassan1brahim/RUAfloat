/** Base map: dark vector style, 3D buildings, centred on Rutgers New Brunswick. */
import maplibregl, { type Map as MLMap } from "maplibre-gl";

export const CAMPUS_CENTER: [number, number] = [-74.452, 40.508];

export function createMap(): Promise<MLMap> {
  const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/dark",
    center: CAMPUS_CENTER, zoom: 13.4, pitch: 45, bearing: -20,
    maxBounds: [[-74.59, 40.39], [-74.32, 40.61]],
    // phones: one finger scrolls the page, two fingers move the map
    cooperativeGestures: matchMedia("(pointer: coarse)").matches,
    attributionControl: { compact: true, customAttribution: "Elevation: USGS 3DEP via AWS Terrain Tiles · River data: NWS/USGS" },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  return new Promise((resolve) => map.on("load", () => {
    map.addLayer({
      id: "buildings", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
      paint: {
        "fill-extrusion-color": "#1b2633",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    });
    // Start the credits collapsed to the ⓘ button (MapLibre otherwise opens them until the first drag).
    // They must stay reachable: OpenStreetMap and OpenMapTiles require attribution.
    map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    resolve(map);
  }));
}
