/** Rutgers buildings on the map (Facilities records on OSM outlines), coloured by flood status, and air quality during the Ida replay.
 * The ranked "highest risk" list is the admin feature, computed on the server. */
import type { GeoJSONSource } from "maplibre-gl";
import type { Feature } from "../../core/app";
import { $, BASE_FT, getJson } from "../../core/util";
import { ic } from "../../core/icons";
import "./style.css";

type RuBuilding = { id: string; name: string; use: string; site: string; lon: number; lat: number; ring: [number, number][] | null;
  touch: number; deep: number; kwh?: number; kgal?: number; gsf: number; nsf: number; built?: string; located: string };
type Air = { station: string; series: [string, number | null, number | null, number | null][] };

const USE: Record<string, string> = { RES: "housing", ACAD: "academic", ADM: "admin", RSCH: "research", SUPT: "support", MED: "clinic", STLIF: "student life", ATH: "athletics", AGRSCH: "agriculture" };
const useLabel = (u: string) => (u === "RES-Dorm" ? "dorm" : u === "SUPT-Util" ? "utility plant" : USE[u.split("-")[0]] ?? u);
const NEAR_DM = 9; // "within ~3 ft of the water"
const statusOf = (b: RuBuilding, rise: number) => (b.deep <= rise ? "deep" : b.touch <= rise ? "touch" : b.touch <= rise + NEAR_DM ? "near" : "dry");
let buildings: RuBuilding[] = [], air: Air;

const geojson = (rise: number) => ({ type: "FeatureCollection" as const, features: buildings.map((b) => ({ type: "Feature" as const,
  properties: { id: b.id, status: statusOf(b, rise) },
  geometry: b.ring ? { type: "Polygon" as const, coordinates: [[...b.ring, b.ring[0]]] } : { type: "Point" as const, coordinates: [b.lon, b.lat] } })) });

function popup(b: RuBuilding) {
  const ft = (dm: number) => (dm >= 65535 ? "not in model range" : `+${(dm / 3.048).toFixed(1)} ft rise (${(BASE_FT + dm / 3.048).toFixed(1)} ft at Bound Brook)`);
  const fmt = (n?: number, u = "") => (n ? `${Math.round(n).toLocaleString()}${u}` : "n/a");
  return `<b>${b.name}</b><br>${useLabel(b.use)} · ${b.site}${b.built ? ` · built ${b.built}` : ""}<br>
    Water reaches walls: ${ft(b.touch)}<br>≥ 30 cm: ${ft(b.deep)}<br>FY25 purchased: ${fmt(b.kwh, " kWh")} · ${fmt(b.kgal, " kgal water")}<br>
    <span style="color:#7d8c9c">Rutgers Facilities data · located by ${b.located}</span>`;
}

const feature: Feature = {
  id: "buildings",
  clickPriority: 5,
  async init(app) {
    [buildings, air] = await Promise.all([getJson<RuBuilding[]>("/data/rutgers_buildings.json"), getJson<Air>("/data/air_ida.json")]);
    const m = app.map, color = ["match", ["get", "status"], "deep", "#ef4444", "touch", "#f59e0b", "near", "#fde047", "#cc0033"] as unknown as string;
    m.addSource("rutgers", { type: "geojson", data: geojson(0) });
    m.addLayer({ id: "rutgers", type: "fill", source: "rutgers", filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": color, "fill-opacity": ["match", ["get", "status"], "dry", 0.18, 0.75] } });
    m.addLayer({ id: "rutgers-line", type: "line", source: "rutgers", filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": ["match", ["get", "status"], "dry", "#ff4d6d", "#fff"], "line-width": 1, "line-opacity": 0.6 } });
    m.addLayer({ id: "rutgers-pt", type: "circle", source: "rutgers", filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 4, "circle-color": color, "circle-stroke-color": "#081018", "circle-stroke-width": 1 } });
    m.on("mouseenter", "rutgers", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "rutgers", () => (m.getCanvas().style.cursor = ""));
    app.toggle("Rutgers buildings", ["rutgers", "rutgers-line", "rutgers-pt"], true, "Facilities", { key: "rutgers" });
    app.legend(`<div>${ic("building", "#f59e0b")}RU bldg: water at walls</div><div>${ic("building", "#ef4444")}RU bldg: ≥ 30 cm</div>`, { views: "admin", key: "rutgers" });
    app.legend(`<div>${ic("building", "#cc0033", 0.6)}Rutgers building</div><div>${ic("building", "#f59e0b")}Rutgers bldg: water at walls</div>`, { views: "student", key: "rutgers" });
    app.card({ col: "left", id: "air-card", title: "Air quality · Rutgers PAMS station", order: 60, hidden: true, html: `
      <div class="stats air"><div><b id="a-pm" class="mono">--</b><span>PM2.5 µg/m³</span></div><div><b id="a-o3" class="mono">--</b><span>Ozone ppm</span></div><div><b id="a-no2" class="mono">--</b><span>NO₂ ppm</span></div></div>
      <div class="small muted" id="a-note"></div>` });
  },
  update(app) {
    const rise = app.rise();
    (app.map.getSource("rutgers") as GeoJSONSource).setData(geojson(rise));
    // air quality: replay only, station local time
    const card = $("air-card"), river = app.maybe("river");
    card.hidden = app.state.mode !== "ida" || !river || river.ida.id !== "ida";   // the PAMS air record is for Ida only
    if (card.hidden || !river) return;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(river.ida.series[river.idaIndex()][0])).map((x) => [x.type, x.value]));
    const key = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
    const row = air.series.find((r) => r[0] === key);
    const v = (x: number | null | undefined, d: number) => (x == null ? "--" : x.toFixed(d));
    $("a-pm").textContent = v(row?.[2], 1); $("a-o3").textContent = v(row?.[1], 3); $("a-no2").textContent = v(row?.[3], 4);
    $("a-note").textContent = row ? `${air.station}, ${key.replace("T", " ")} station time. Context only; not part of routing.` : "No station reading for this hour.";
  },
  click(app, pt, ev) {
    const f = app.map.queryRenderedFeatures(ev.point, { layers: ["rutgers", "rutgers-pt"] })[0];
    if (!f) return false;
    app.popup(pt, popup(buildings.find((b) => b.id === f.properties!.id)!));
    return true;
  },
};
export default feature;
