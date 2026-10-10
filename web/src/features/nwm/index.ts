/** NOAA stream forecast: flash flooding, high-water timing and probability on small streams around campus (live only). */
import type { GeoJSONSource } from "maplibre-gl";
import type { Feature } from "../../core/app";
import { $, esc, et, getJson } from "../../core/util";
import { filterNwm, nwmNear, type Nwm } from "./filter";
import { ic } from "../../core/icons";

let nwm: ReturnType<typeof filterNwm> | null = null;

const feature: Feature = {
  id: "nwm",
  init(app) {
    const empty = { type: "FeatureCollection" as const, features: [] };
    app.map.addSource("nwm-inun", { type: "geojson", data: empty });
    app.map.addLayer({ id: "nwm-inun", type: "fill", source: "nwm-inun", paint: { "fill-color": "#a78bfa", "fill-opacity": 0.35 } }, "buildings");
    app.map.addSource("nwm-reach", { type: "geojson", data: empty });
    app.map.addLayer({ id: "nwm-reach", type: "line", source: "nwm-reach", layout: { "line-cap": "round" },
      paint: { "line-color": ["match", ["get", "kind"], "rapid", "#e879f9", "#a78bfa"], "line-width": ["match", ["get", "kind"], "rapid", 6, 4], "line-opacity": 0.9 } });
    app.toggle("NOAA stream forecast", ["nwm-inun", "nwm-reach"], true, "Flooding", { views: "admin", key: "nwm" });
    app.legend(`<div>${ic("lightning", "#e879f9")}NOAA flash flood</div>`, { views: "admin", key: "nwm" });
    app.card({ col: "left", id: "nwm-card", title: "NOAA stream forecast", order: 30,
      extraTitle: ` <a class="src" href="https://water.noaa.gov/" target="_blank" rel="noopener">NWPS ↗</a>`, html: `<div id="nwm" class="small"><span class="muted">Loading National Water Model…</span></div>` });
    app.provide("nwmNear", (lon, lat) => nwmNear(nwm, lon, lat));

    async function refresh() {
      let raw: Nwm;
      try { raw = await getJson<Nwm>("/api/nwm"); } catch { $("nwm").innerHTML = `<span class="muted">NOAA forecast unavailable.</span>`; return; }
      nwm = filterNwm(raw);
      const reach = [
        ...nwm.rapid.features.map((f) => ({ ...f, properties: { ...f.properties, kind: "rapid" } })),
        ...nwm.arrival.features.map((f) => ({ ...f, properties: { ...f.properties, kind: "high" } })),
      ];
      (app.map.getSource("nwm-reach") as GeoJSONSource).setData({ type: "FeatureCollection", features: reach } as never);
      (app.map.getSource("nwm-inun") as GeoJSONSource).setData(nwm.inundation as never);
      const utcIso = (s: string) => new Date(s.replace(" UTC", "").replace(" ", "T") + "Z").toISOString();
      const item = (label: string, n: number, detail: string) => `<li><b>${label}</b><span class="mono">${n}</span></li>${n ? `<li class="muted small" style="border:0">${detail}</li>` : ""}`;
      const names = (fc: Nwm["arrival"]) => [...new Set(fc.features.map((f) => String(f.properties.name)))].slice(0, 4).map(esc).join(", ");
      const maxP = nwm.probability.features.reduce((m, f) => Math.max(m, Number(f.properties.hw_prob_all)), 0);
      $("nwm").innerHTML = `<ul class="contacts">
          ${item("Flash flooding (next 18 h)", nwm.rapid.features.length, names(nwm.rapid))}
          ${item("High water (next 18 h)", nwm.arrival.features.length, names(nwm.arrival))}
          ${item("Max high-water probability (12 h)", Math.round(maxP), maxP ? names(nwm.probability) : "")}
          ${item("Flood-extent polygons now", nwm.inundation.features.length, "Purple fill on the map")}
        </ul>
        <div class="small muted">${nwm.run ? `Model run ${et(utcIso(nwm.run.reference_time))}` : ""} · ${nwm.reaches_modeled ?? "?"} reaches modeled around campus.
        ${nwm.hidden ? `${nwm.hidden} tiny headwater reach${nwm.hidden > 1 ? "es" : ""} flagged with only a few cfs: hidden as likely noise.` : ""}
        ${Object.keys(nwm.errors).length ? `<br>Unavailable: ${Object.keys(nwm.errors).join(", ")}` : ""} Experimental NOAA products.</div>`;
    }
    void refresh();
    setInterval(refresh, 10 * 60e3);
  },
};
export default feature;
