/** Ground truth: USGS river cameras + AI check, student photo reports, street water sensors. Live mode only. */
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import type { Feature, Pt } from "../../core/app";
import { $, esc, et, getJson, postJson } from "../../core/util";
import { observe, shrinkPhoto, type Camera, type CameraCheck, type Report, type ReportStatus, type Sensor } from "./observe";
import "./style.css";

let reports: Report[] = [], sensors: Sensor[] = [], cameras: Camera[] = [];
let statuses = new Map<string, ReportStatus>();
let reportLoc: Pt | null = null, reportMarker: maplibregl.Marker | null = null;

const feature: Feature = {
  id: "detection",
  clickPriority: 20,
  async init(app) {
    const m = app.map;
    m.addSource("obs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: "obs", type: "circle", source: "obs", paint: {
      "circle-radius": ["match", ["get", "kind"], "camera", 7, 8],
      "circle-color": ["match", ["get", "state"], "confirmed", "#ff2d95", "closed", "#ff2d95", "unconfirmed", "#f59e0b", "wet", "#38bdf8", "rejected", "#64748b", "#22d3ee"],
      "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    m.addLayer({ id: "obs-label", type: "symbol", source: "obs",
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#e2e8f0", "text-halo-color": "#081018", "text-halo-width": 1.5 } });
    m.on("mouseenter", "obs", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "obs", () => (m.getCanvas().style.cursor = ""));

    app.card({ col: "left", id: "cams-card", title: "River cameras · AI check", order: 40,
      extraTitle: ` <a class="src" href="https://apps.usgs.gov/hivis/" target="_blank" rel="noopener">USGS HIVIS ↗</a>`, html: `<div id="cams" class="cams"><div class="muted small">Loading cameras…</div></div>` });
    app.card({ col: "left", id: "sensors-card", title: "Street sensors", order: 50, html: `<div id="sensors" class="small"><div class="muted">Loading…</div></div>` });
    app.card({ student: "left", studentOrder: 20, id: "report-card", title: "Report flooding", order: 30, html: `
      <div class="small muted" id="r-loc">Location: use “📍 Pick on map” below or your GPS.</div>
      <div class="row gap"><button id="r-pick" class="btn ghost small"><span aria-hidden="true">📍</span> Pick on map</button><button id="r-gps" class="btn ghost small"><span aria-hidden="true">◎</span> GPS</button></div>
      <input id="r-photo" type="file" accept="image/*" capture="environment" aria-label="Photo of the flooding" />
      <textarea id="r-note" rows="2" maxlength="280" placeholder="What do you see? (optional)" aria-label="Note"></textarea>
      <button id="r-send" class="btn primary" disabled>Send report</button><div id="r-out" class="small"></div>` });

    // The observations contract from the roads feature: closures that routing and the road panel use.
    app.provide("observations", () => {
      if (app.state.mode !== "live") return { closed: new Set(), evidence: () => [] };   // tonight's data never alters a replay
      const o = observe(app.get("router"), app.get("grid"), app.rise(), reports, sensors);
      statuses = o.statuses;
      return { closed: o.closed, evidence: (ei) => o.byEdge.get(ei) ?? [] };
    });

    const send = $<HTMLButtonElement>("r-send"), photo = $<HTMLInputElement>("r-photo");
    const ready = () => (send.disabled = !(reportLoc && photo.files?.length));
    const setLoc = (name: string, pt: Pt) => {
      reportLoc = pt;
      $("r-loc").textContent = `Location: ${name} (${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)})`;
      reportMarker?.remove();
      reportMarker = new maplibregl.Marker({ color: "#f59e0b" }).setLngLat([pt.lon, pt.lat]).addTo(app.map);
      ready();
    };
    photo.onchange = ready;
    $("r-pick").onclick = () => app.pick("Click the map where the flooding is", (pt) => setLoc("Pinned on map", pt));
    $("r-gps").onclick = () => navigator.geolocation?.getCurrentPosition((p) => setLoc("GPS", { lon: p.coords.longitude, lat: p.coords.latitude }));
    send.onclick = async () => {
      send.disabled = true; send.textContent = "Checking photo…";
      try {
        const r = await postJson<Report & { error?: string }>("/api/reports", { lat: reportLoc!.lat, lon: reportLoc!.lon, note: $<HTMLTextAreaElement>("r-note").value, photo: await shrinkPhoto(photo.files![0]) });
        if (r.error) throw new Error(r.error);
        await refresh(true);
        $("r-out").innerHTML = popupHtml({ kind: "report", id: r.id });
        photo.value = ""; $<HTMLTextAreaElement>("r-note").value = "";
      } catch (e) { $("r-out").innerHTML = `<span class="badge warn">${esc((e as Error).message)}</span>`; }
      send.textContent = "Send report"; ready();
    };

    async function refresh(force = false) {
      try {
        const [r, s] = await Promise.all([getJson<Report[]>("/api/reports"), getJson<Sensor[]>("/api/sensors")]);
        const changed = JSON.stringify([r.length, r.at(-1)?.id, s.map((x) => x.reading?.time)]) !== JSON.stringify([reports.length, reports.at(-1)?.id, sensors.map((x) => x.reading?.time)]);
        reports = r; sensors = s;
        renderSensors();
        if (changed || force) app.refresh();
      } catch { /* API offline: keep last observations */ }
    }
    async function refreshCameras() {
      try {
        const r = await getJson<Camera[] | { error: string }>("/api/cameras");
        if (!Array.isArray(r)) throw new Error(r.error ?? "bad response");  // USGS errors come back as {error}
        cameras = r;
      } catch (e) {
        if (!cameras.length) $("cams").innerHTML = `<div class="muted small">Cameras unavailable right now (${esc(String((e as Error).message).slice(0, 80))}).</div>`;
        return;
      }
      $("cams").innerHTML = cameras.map((c, i) => `<div class="cam" data-i="${i}">
          <img src="${c.image ?? ""}" alt="${c.name} camera" loading="lazy" />
          <div class="meta"><b>${c.name}</b><span class="muted">${c.time ? et(c.time) : ""}</span></div>
          <div class="meta"><span>${c.gauge ? `Gauge ${c.lid}: <b class="mono">${c.gauge.stage} ft</b> · ${c.gauge.category.replace(/_/g, " ")}` : "gauge n/a"}</span></div>
          <div class="row"><button class="btn small ghost" data-check="">🤖 AI check (latest)</button>${c.samples.map((s) => `<button class="btn small ghost" data-check="${s.file}">${s.label}</button>`).join("")}</div>
          <div class="res"></div></div>`).join("");
      $("cams").querySelectorAll<HTMLButtonElement>("button[data-check]").forEach((b) => (b.onclick = () => checkCamera(b)));
      app.refresh();
    }
    await refresh();
    setInterval(refresh, 5000);
    void refreshCameras();
    setInterval(refreshCameras, 5 * 60e3);
  },
  update(app) {
    if (app.state.mode === "live") app.get("observations")();   // refresh report statuses for the markers
    const f = (kind: string, id: string, lon: number, lat: number, st: string, label: string) =>
      ({ type: "Feature" as const, properties: { kind, id, state: st, label }, geometry: { type: "Point" as const, coordinates: [lon, lat] } });
    (app.map.getSource("obs") as GeoJSONSource).setData({ type: "FeatureCollection", features: [
      ...cameras.filter((c) => c.lat).map((c) => f("camera", c.id, c.lon, c.lat, "camera", `📷 ${c.name}`)),
      ...sensors.map((s) => { const d = (!s.stale && s.reading?.depth_cm) || 0; return f("sensor", s.id, s.lon, s.lat, d >= 15 ? "closed" : d > 0 ? "wet" : "dry", `📡 ${d} cm`); }),
      ...reports.filter((r) => app.state.mode === "live" && Date.now() - Date.parse(r.time) < 3 * 3600e3).map((r) => f("report", r.id, r.lon, r.lat, statuses.get(r.id)?.status ?? "unconfirmed", "")),
    ] });
  },
  click(app, pt, ev) {
    const o = app.map.queryRenderedFeatures(ev.point, { layers: ["obs"] })[0];
    if (!o) return false;
    app.popup(pt, popupHtml(o.properties as { kind: string; id: string }));
    return true;
  },
};

function popupHtml(p: { kind: string; id: string }) {
  if (p.kind === "camera") {
    const c = cameras.find((x) => x.id === p.id)!;
    return `<b>📷 ${c.name}</b><br>USGS camera on gauge ${c.lid}${c.gauge ? ` · ${c.gauge.stage} ft (${c.gauge.category.replace(/_/g, " ")})` : ""}<br>${c.image ? `<img src="${c.image}" style="width:100%;border-radius:6px;margin-top:6px">` : ""}<span class="muted">Use “AI check” in the River cameras panel.</span>`;
  }
  if (p.kind === "sensor") {
    const s = sensors.find((x) => x.id === p.id)!;
    return `<b>📡 ${s.name}</b><br>${s.reading ? `${s.reading.depth_cm} cm of water · ${et(s.reading.time)}${s.stale ? " (stale)" : ""}` : "No readings yet"}<br><span class="muted">${esc(s.road)}</span>`;
  }
  const r = reports.find((x) => x.id === p.id)!, st = statuses.get(r.id), dc = r.ai.depth_cm;
  return `<b>Student report · ${et(r.time)}</b><br><img src="/api/reports/${esc(r.id)}/photo" alt="Reported flooding photo" style="width:100%;border-radius:6px;margin:6px 0">
    ${r.note ? `“${esc(r.note)}”<br>` : ""}AI (${esc(r.model)}): ${r.ai.water_on_ground ? `water, ${dc ? `${dc[0]}–${dc[1]} cm` : "depth unclear"}` : "no water seen"}${r.ai.depth_reference ? ` · ref: ${esc(r.ai.depth_reference)}` : ""}<br>
    <b>${st?.status ?? "?"}</b>: ${esc(st?.why)}`;
}

/** One health line per sensor; the depth sparkline only once there is something to draw. */
function renderSensors() {
  const el = $("sensors");
  if (!sensors.length) { el.innerHTML = `<div class="muted">No sensors configured.</div>`; return; }
  el.innerHTML = sensors.map((s) => {
    const d = s.reading?.depth_cm, fresh = !!s.reading && !s.stale;
    const [state, cls] = !s.reading ? ["offline: never reported", "muted"] : !fresh ? [`offline since ${et(s.reading.time)}`, "warn"]
      : d! >= 30 ? [`${d} cm · closed to walking and cars`, "bad"] : d! >= 15 ? [`${d} cm · closed to walking`, "bad"] : d! > 0 ? [`${d} cm · caution`, "warn"] : ["dry", "ok"];
    const h = s.history.slice(-40), max = Math.max(40, ...h.map((x) => x.depth_cm));
    const pts = h.map((x, i) => `${((i / Math.max(1, h.length - 1)) * 120).toFixed(1)},${(30 - (x.depth_cm / max) * 28).toFixed(1)}`).join(" ");
    return `<div class="sensor-row"><div><b>${esc(s.name)}</b><br><span class="${cls}">${state}</span></div>
      ${h.length > 1 ? `<svg width="120" height="32" viewBox="0 0 120 32" aria-hidden="true"><line x1="0" x2="120" y1="${30 - (15 / max) * 28}" y2="${30 - (15 / max) * 28}" stroke="#ef4444" stroke-dasharray="3 3" stroke-opacity=".6"/><polyline points="${pts}" fill="none" stroke="#38bdf8" stroke-width="2"/></svg>` : ""}</div>`;
  }).join("");
}

async function checkCamera(btn: HTMLButtonElement) {
  const card = btn.closest<HTMLElement>(".cam")!, c = cameras[+card.dataset.i!], out = card.querySelector<HTMLElement>(".res")!;
  out.innerHTML = `<span class="muted">Comparing with a normal-level reference image…</span>`;
  const r = await postJson<CameraCheck>("/api/cameras/check", { id: c.id, file: btn.dataset.check || undefined });
  if (r.error) { out.innerHTML = `<span class="badge warn">${esc(r.error)}</span>`; return; }
  card.querySelector("img")!.src = r.image;
  const metas = card.querySelectorAll<HTMLElement>(".meta");
  metas[0].lastElementChild!.textContent = et(r.time);  // header follows the image being judged
  if (r.gauge) metas[1].innerHTML = `Gauge ${c.lid} at that time: <b class="mono">${r.gauge.stage} ft</b>`;
  const cls = r.agreement.startsWith("agrees") ? "ok" : r.agreement.startsWith("DISAGREES") ? "bad" : "";
  out.innerHTML = `<div class="badge-row"><span class="badge">${et(r.time)}</span><span class="badge">AI: ${esc(r.vision.water_state.replace(/_/g, " "))} (${Math.round(r.vision.confidence * 100)}%)</span>
    <span class="badge ${cls}">${esc(r.agreement)}${r.gauge ? ` · ${r.gauge.stage} ft` : ""}</span></div><div class="muted">${esc(r.vision.change_vs_reference)}</div>`;
}
export default feature;
