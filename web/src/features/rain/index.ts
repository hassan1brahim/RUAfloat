/**
 * Rain flooding: streets that have flooded in heavy rain before (news and Rutgers reports), watched with live
 * NOAA radar rainfall. The river model can't see these: they flood from storm drains, far from the Raritan.
 * In heavy rain a spot's streets are treated like an observed closure, so routing goes around them.
 * Thresholds are estimates (NWS flash-flood guidance for urban NJ), stated as such in the UI.
 * During the Ida replays (river replay, or the What-if Ida forecast) the spots follow Ida's real hourly rain instead.
 */
import type { GeoJSONSource } from "maplibre-gl";
import type { App, Feature } from "../../core/app";
import { esc, getJson } from "../../core/util";
import { NO_OBSERVATIONS, type Evidence, type Observations } from "../roads";
import { ic } from "../../core/icons";
import "./style.css";

type Event = { date: string; what: string; source: string; url: string };
type Spot = { id: string; name: string; area: string; lon: number; lat: number; radius_m: number; roads: string[]; why: string; events: Event[] };
type Thresholds = { watch: { rain_1h_in: number; forecast_6h_in: number }; warning: { rain_1h_in: number; rain_3h_in: number; rain_12h_in: number }; note: string };
type Radar = { id: string; rain_1h_in: number | null; rain_3h_in: number | null; rain_6h_in: number | null; rain_12h_in?: number | null; valid_until: string | null; error?: string };
type Rain = { fetched_at: string; radar: Radar[]; forecast: { next_6h_in: number; next_12h_in: number; next_24h_in: number; issued: string; error?: string } };
type Status = "dry" | "watch" | "warning";

let spots: Spot[] = [], th: Thresholds, rain: Rain | null = null;
let idaRain: [string, number][] = [];
let idaT: number | null = null;   // the replayed Ida moment, when an Ida replay is on screen
const closedBySpot = new Map<string, number[]>();
let closedKey = "", shownKey = "";

/** Which Ida moment is on screen: the river's Ida replay, or the What-if Ida forecast simulation. */
function syncIda(app: App) {
  const river = app.maybe("river"), clock = app.maybe("simClock")?.();
  idaT = app.state.mode === "ida" && river ? Date.parse(river.ida.series[river.idaIndex()][0])
    : clock?.kind === "ida" ? clock.t : null;
}

/** Rain at the Somerset gauge in the `hours` before the replayed Ida moment. */
function idaSum(hours: number) {
  let v = 0;
  for (const [t, inch] of idaRain) { const end = Date.parse(t); if (end <= idaT! && end > idaT! - hours * 3600e3) v += inch; }
  return +v.toFixed(2);
}

function radarOf(s: Spot): Radar | null {
  if (idaT != null) return { id: s.id, rain_1h_in: idaSum(1), rain_3h_in: idaSum(3), rain_6h_in: idaSum(6), rain_12h_in: idaSum(12), valid_until: new Date(idaT).toISOString() };
  return rain?.radar.find((r) => r.id === s.id) ?? null;
}
const fc6 = () => (idaT != null ? 0 : rain?.forecast && !rain.forecast.error ? rain.forecast.next_6h_in : 0);
const rainLabel = () => (idaT != null ? "(Ida 2021, Somerset rain gauge)" : "(NOAA radar)");
const active = (app: App) => app.state.mode === "live" || idaT != null;

function statusOf(s: Spot): Status {
  const r = radarOf(s);
  const h1 = r?.rain_1h_in ?? 0, h3 = r?.rain_3h_in ?? 0, h12 = r?.rain_12h_in ?? 0;
  if (h1 >= th.warning.rain_1h_in || h3 >= th.warning.rain_3h_in || h12 >= th.warning.rain_12h_in) return "warning";
  if (h1 >= th.watch.rain_1h_in || fc6() >= th.watch.forecast_6h_in) return "watch";
  return "dry";
}

const LABEL: Record<Status, string> = { dry: "No heavy rain", watch: "Heavy rain: watch", warning: "Likely flooding: avoid" };
const inches = (v: number | null | undefined) => (v == null ? "?" : `${v.toFixed(2)} in`);
const year = (d: string) => d.slice(0, 4);

function geojson() {
  return { type: "FeatureCollection" as const, features: spots.map((s) => ({ type: "Feature" as const,
    properties: { id: s.id, name: s.name, status: statusOf(s), times: s.events.length },
    geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } })) };
}

function popupHtml(s: Spot) {
  const r = radarOf(s), st = statusOf(s);
  return `<div class="rain-pop"><b>${esc(s.name)}</b><div class="small muted">${esc(s.area)} · flooded in heavy rain ${s.events.length} time${s.events.length === 1 ? "" : "s"}</div>
    <div class="rain-chip ${st}">${LABEL[st]}</div>
    <div class="small">Rain ${rainLabel()}: last hour ${inches(r?.rain_1h_in)}, last 3 h ${inches(r?.rain_3h_in)}, last 12 h ${inches(r?.rain_12h_in)}</div>
    <div class="small muted">${esc(s.why)}</div>
    <ul class="rain-events">${s.events.map((e) => `<li><b>${esc(e.date)}</b>: ${esc(e.what)}</li>`).join("")}</ul></div>`;
}

function closedEdges(app: App) {
  const key = spots.map((s) => statusOf(s)).join();
  if (key === closedKey) return;
  closedKey = key;
  const router = app.get("router");
  closedBySpot.clear();
  for (const s of spots) {
    if (!s.roads.length || statusOf(s) !== "warning") continue;
    const names = new Set(s.roads.map((r) => r.toLowerCase()));
    closedBySpot.set(s.id, router.edgesNear(s.lon, s.lat, s.radius_m).filter((i) => names.has(router.edgeName(i).toLowerCase())));
  }
}

const feature: Feature = {
  id: "rain",
  async init(app) {
    const data = await getJson<{ thresholds: Thresholds; spots: Spot[]; ida_2021?: { hourly_in: [string, number][] } }>("/data/rain_hotspots.json").catch(() => null);
    spots = data?.spots ?? [];
    idaRain = data?.ida_2021?.hourly_in ?? [];
    th = data?.thresholds ?? { watch: { rain_1h_in: 0.5, forecast_6h_in: 1 }, warning: { rain_1h_in: 1, rain_3h_in: 1.5, rain_12h_in: 3 }, note: "" };

    const m = app.map;
    m.addSource("rain-spots", { type: "geojson", data: geojson() });
    m.addLayer({ id: "rain-spots", type: "circle", source: "rain-spots", paint: {
      "circle-radius": ["match", ["get", "status"], "warning", 13, "watch", 11, 9],
      "circle-color": ["match", ["get", "status"], "warning", "#ef4444", "watch", "#f59e0b", "#94a3b8"],
      "circle-opacity": 0.85, "circle-stroke-color": "#0b1220", "circle-stroke-width": 2 } });
    m.addLayer({ id: "rain-spots-label", type: "symbol", source: "rain-spots",
      layout: { "text-field": ["concat", "🌧 ", ["get", "times"], "×"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#e2e8f0", "text-halo-color": "#081018", "text-halo-width": 1.5 } });
    m.on("mouseenter", "rain-spots", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "rain-spots", () => (m.getCanvas().style.cursor = ""));
    app.toggle("Rain flood spots (past floods)", ["rain-spots", "rain-spots-label"], true, "Flooding", { key: "rain" });
    app.legend(`<div>${ic("rain", "#94a3b8")}Flooded in past heavy rain (🌧 n× = times)</div>`, { key: "rain" });

    // Heavy rain over a known spot closes its streets for routing, alongside sensors and photo reports.
    const base = app.maybe("observations");
    app.provide("observations", (): Observations => {
      const o = base ? base() : NO_OBSERVATIONS;
      syncIda(app);
      if (!active(app)) return o;
      closedEdges(app);
      if (!closedBySpot.size) return o;
      const closed = new Set(o.closed), extra = new Map<number, Evidence[]>();
      for (const [id, edges] of closedBySpot) {
        const s = spots.find((x) => x.id === id)!, r = radarOf(s);
        for (const ei of edges) {
          closed.add(ei);
          extra.set(ei, [{ kind: "rain", closes: true, time: r?.valid_until ?? new Date().toISOString(),
            text: `${idaT != null ? "Ida 2021: " : ""}heavy rain (${inches(r?.rain_1h_in)} in the last hour) at a spot that flooded ${s.events.length}× before (last ${year(s.events[s.events.length - 1].date)})` }]);
        }
      }
      return { closed, evidence: (ei) => [...o.evidence(ei), ...(extra.get(ei) ?? [])] };
    });

    const load = async () => { try { rain = await getJson<Rain>("/api/rain"); } catch { rain = null; } refreshAll(app); };
    await load();
    setInterval(load, 5 * 60e3);
  },
  // The Ida replays move time: keep the dots and the card in step (only redrawn when something visible changed).
  update(app) {
    syncIda(app);
    const key = `${idaT ?? ""}|${rain?.fetched_at}|${spots.map((s) => statusOf(s)).join()}`;
    if (key === shownKey) return;
    shownKey = key;
    (app.map.getSource("rain-spots") as GeoJSONSource | undefined)?.setData(geojson());
  },
  click(app, pt) {
    const hit = app.map.queryRenderedFeatures(app.map.project([pt.lon, pt.lat]), { layers: ["rain-spots"] })[0];
    if (!hit) return false;
    const s = spots.find((x) => x.id === hit.properties?.id);
    if (s) app.popup({ lon: s.lon, lat: s.lat }, popupHtml(s));
    return !!s;
  },
  clickPriority: 30,
  facts() {
    if (!spots.length) return {};
    return {
      rain_last_hour_in: radarOf(spots[0])?.rain_1h_in ?? null,
      rain_forecast_next_6h_in: fc6(),
      rain_ida_replay: idaT != null,
      rain_flood_spots: spots.map((s) => ({ name: s.name, status: LABEL[statusOf(s)], times_flooded_before: s.events.length, rain_last_hour_in: radarOf(s)?.rain_1h_in ?? null })),
      rain_note: "Known spots that flooded in past heavy rain, with live NOAA radar rainfall. Thresholds are estimates.",
    };
  },
};

function refreshAll(app: App) {
  closedKey = shownKey = "";
  app.refresh();   // re-run routing, road layers and this card with the new rain
}

export default feature;
