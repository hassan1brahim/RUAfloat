/** River: live Bound Brook gauge (NWS), alerts, and the three scenarios (Live, Ida 2021 replay, What-if). */
import type { App, Feature, Mode } from "../../core/app";
import { $, CATS, catOf, esc, et, fmtFt, getJson } from "../../core/util";
import "./style.css";

export type Live = {
  fetched_at: string;
  gauge?: { observed: { primary: number; validTime: string; floodCategory: string }; forecast: { primary: number; validTime: string };
    impacts: { stage: number; statement: string }[]; crests: { time: string; stage: number }[]; series: [string, number][]; forecastSeries: [string, number][]; forecastIssued: string | null };
  gauge_error?: string;
  alerts?: { event: string; headline: string; severity: string; instruction?: string }[];
  alerts_error?: string;
  sources: { name: string; url: string }[];
};
export type Ida = { series: [string, number][]; crest: [string, number]; baseline_ft: number };
export type River = {
  ida: Ida;
  live: () => Live | null;
  idaIndex: () => number;
  setIdaIndex: (i: number) => void;
  setMode: (m: Mode) => void;
  setWhatIf: (ft: number) => void;
};
declare module "../../core/app" { interface Services { river: River } }

const PRESETS = [
  { label: "Minor 28 ft", ft: 28 }, { label: "Major 33 ft", ft: 33 },
  { label: "Irene 2011 · 41.9", ft: 41.9 }, { label: "Ida 2021 / Floyd 1999 · 42.13", ft: 42.13 },
];

let ida: Ida, live: Live | null = null, idaIdx = 0, playing = 0, app: App;

function setMode(m: Mode) {
  app.state.mode = m;
  if (playing) togglePlay();
  document.querySelectorAll<HTMLButtonElement>("#mode-seg button").forEach((b) => { b.classList.toggle("on", b.dataset.mode === m); b.setAttribute("aria-pressed", String(b.dataset.mode === m)); });
  $("ida-ctl").hidden = m !== "ida";
  $("whatif-ctl").hidden = m !== "whatif";
  const pill = $("mode-pill");
  pill.className = `pill ${m === "live" ? "live" : m === "ida" ? "replay" : "whatif"}`;
  pill.textContent = m === "live" ? "LIVE" : m === "ida" ? "REPLAY · IDA 2021" : "WHAT-IF";
  if (m === "live") applyLive();
  if (m === "ida") { if (!idaIdx) idaIdx = ida.series.findIndex((p) => p[0] >= "2021-09-02T06"); applyIda(); }
  if (m === "whatif") app.setStage(+$<HTMLInputElement>("stage-slider").value);
}

function togglePlay() {
  if (playing) { clearInterval(playing); playing = 0; $("ida-play").innerHTML = `<span aria-hidden="true">▶</span> Play`; return; }
  if (idaIdx >= ida.series.length - 1) idaIdx = 0;
  $("ida-play").innerHTML = `<span aria-hidden="true">❚❚</span> Pause`;
  playing = window.setInterval(() => {
    if (idaIdx >= ida.series.length - 1) return togglePlay();
    idaIdx++; applyIda();
  }, 220);
}

function applyIda() {
  const [t, ft] = ida.series[idaIdx];
  $<HTMLInputElement>("ida-scrub").value = String(idaIdx);
  $("ida-label").textContent = `${et(t)} ET · crest 42.13 ft at ${et(ida.crest[0])} ET (USGS record)`;
  $("g-note").textContent = "Hurricane Ida remnants, Sept 1–3, 2021. USGS 01403060 readings, hourly.";
  drawSpark(ida.series, idaIdx, []);
  app.setStage(ft);
}

function applyLive() {
  const g = live?.gauge;
  if (!g) { $("g-note").textContent = `Live gauge unavailable${live?.gauge_error ? `: ${live.gauge_error}` : ""}.`; return; }
  $("g-note").textContent = `Observed ${et(g.observed.validTime)} ET · NWS forecast ${fmtFt(g.forecast.primary)} by ${et(g.forecast.validTime)} ET`;
  drawSpark(g.series, g.series.length - 1, g.forecastSeries);
  app.setStage(g.observed.primary);
}

async function refreshLive() {
  try { live = await getJson<Live>("/api/live"); }
  catch { live = { fetched_at: new Date().toISOString(), sources: [], gauge_error: "API offline", alerts_error: "API offline" }; }
  const ul = $("alerts");
  if (live.alerts_error) ul.innerHTML = `<li class="muted">Alerts unavailable (${esc(live.alerts_error)}).</li>`;
  else if (!live.alerts?.length) ul.innerHTML = `<li class="muted">No active NWS alerts for New Brunswick as of ${et(live.fetched_at)} ET.</li>`;
  else ul.innerHTML = live.alerts.map((a) => `<li class="alert ${esc(a.severity)}"><b>${esc(a.event)}</b><br><span class="small muted">${esc(a.headline)}</span></li>`).join("");
  if (app.state.mode === "live") applyLive();
}

function drawSpark(series: [string, number][], idx: number, forecast: [string, number][]) {
  const svg = $("spark") as unknown as SVGSVGElement;
  const all = [...series, ...forecast];
  if (!all.length) { svg.innerHTML = ""; return; }
  const vals = all.map((p) => p[1]);
  const lo = Math.min(15, ...vals), hi = Math.max(34, ...vals) + 1;
  const t0 = Date.parse(all[0][0]), t1 = Date.parse(all[all.length - 1][0]) || t0 + 1;
  const X = (t: string) => ((Date.parse(t) - t0) / (t1 - t0 || 1)) * 300;
  const Y = (v: number) => 78 - ((v - lo) / (hi - lo)) * 74;
  const path = (pts: [string, number][]) => pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const color: Record<string, string> = { major: "#f0abfc", moderate: "#f87171", minor: "#fb923c", action: "#fde047" };
  const cats = CATS.map((c) => `<line x1="0" x2="300" y1="${Y(c.ft)}" y2="${Y(c.ft)}" stroke="${color[c.k]}" stroke-opacity=".35" stroke-dasharray="3 3"/>`).join("");
  const cur = series[idx];
  svg.innerHTML = `${cats}
    <path d="${path(series)}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    ${forecast.length ? `<path d="${path([series[series.length - 1], ...forecast])}" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="4 3" opacity=".7"/>` : ""}
    ${cur ? `<line x1="${X(cur[0])}" x2="${X(cur[0])}" y1="0" y2="80" stroke="#fff" stroke-opacity=".35"/><circle cx="${X(cur[0])}" cy="${Y(cur[1])}" r="3.5" fill="#fff"/>` : ""}`;
}

const feature: Feature = {
  id: "river",
  async init(a) {
    app = a;
    ida = await getJson<Ida>("/data/ida.json");
    const head = document.createElement("span");
    head.innerHTML = `<span id="mode-pill" class="pill live">LIVE</span> <span id="top-stage" class="mono">--.- ft</span> <span id="top-cat" class="cat">--</span> <span id="top-time" class="muted mono"></span>`;
    head.className = "top-river";
    app.headerItem(head);
    setInterval(() => ($("top-time").textContent = et(new Date().toISOString()) + " ET"), 1000);

    app.card({ col: "left", id: "scenario-card", title: "Scenario", order: 10, html: `
      <div class="seg" id="mode-seg" role="group" aria-label="Scenario">
        <button data-mode="live" class="on" aria-pressed="true">Live</button><button data-mode="ida" aria-pressed="false">Ida 2021 replay</button><button data-mode="whatif" aria-pressed="false">What-if</button>
      </div>
      <div id="ida-ctl" class="ctl" hidden>
        <div class="row"><button id="ida-play" class="btn small"><span aria-hidden="true">▶</span> Play</button><input id="ida-scrub" type="range" min="0" max="0" value="0" aria-label="Ida replay hour" /></div>
        <div class="muted small" id="ida-label"></div>
      </div>
      <div id="whatif-ctl" class="ctl" hidden>
        <label class="small muted" for="stage-slider">Bound Brook river stage</label>
        <div class="row"><input id="stage-slider" type="range" min="15" max="45" step="0.1" value="30" /><span id="stage-val" class="mono">30.0 ft</span></div>
        <div class="chips" id="presets"></div>
      </div>` });
    app.card({ col: "left", id: "gauge-card", title: "Raritan River at Bound Brook", order: 20,
      extraTitle: ` <a class="src" href="https://water.noaa.gov/gauges/bdkn4" target="_blank" rel="noopener">NWS ↗</a>`, html: `
      <div class="gauge">
        <div><span id="g-stage" class="big mono">--.-</span><span class="unit"> ft</span></div>
        <div class="g-side"><div id="g-cat" class="cat">--</div><div class="small muted" id="g-rise">rise --</div></div>
      </div>
      <svg id="spark" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="River stage over time"></svg>
      <div class="small muted" id="g-note"></div>
      <ul class="impacts" id="g-impacts"></ul>` });
    app.card({ col: "left", id: "alerts-card", title: "NWS alerts · New Brunswick", order: 70,
      extraTitle: ` <a class="src" href="https://www.weather.gov/phi/" target="_blank" rel="noopener">Mt Holly ↗</a>`, html: `<ul class="alerts" id="alerts"><li class="muted">Loading…</li></ul>` });

    document.querySelectorAll<HTMLButtonElement>("#mode-seg button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode as Mode)));
    const scrub = $<HTMLInputElement>("ida-scrub");
    scrub.max = String(ida.series.length - 1);
    scrub.oninput = () => { idaIdx = +scrub.value; applyIda(); };
    $("ida-play").onclick = togglePlay;
    const slider = $<HTMLInputElement>("stage-slider");
    slider.oninput = () => app.setStage(+slider.value);
    for (const p of PRESETS) {
      const c = document.createElement("button");
      c.className = "chip"; c.textContent = p.label;
      c.onclick = () => { slider.value = String(p.ft); app.setStage(p.ft); };
      $("presets").append(c);
    }
    app.provide("river", {
      ida, live: () => live, idaIndex: () => idaIdx,
      setIdaIndex: (i) => { idaIdx = i; if (app.state.mode === "ida") applyIda(); },
      setMode, setWhatIf: (ft) => { slider.value = String(ft); if (app.state.mode === "whatif") app.setStage(ft); },
    });
    await refreshLive();
    setInterval(() => app.state.mode === "live" && refreshLive(), 60_000);
  },
  update(a) {
    const ft = a.state.stageFt, rise = a.rise(), cat = catOf(ft);
    for (const id of ["top-cat", "g-cat"]) { const el = $(id); el.className = `cat ${cat}`; el.textContent = cat === "normal" ? "no flooding" : `${cat} flood`; }
    $("top-stage").textContent = fmtFt(ft);
    $("g-stage").textContent = ft.toFixed(1);
    $("stage-val").textContent = fmtFt(ft);
    $("g-rise").textContent = `river rise +${(rise / 3.048).toFixed(1)} ft over baseflow`;
    const impacts = live?.gauge?.impacts ?? [];
    $("g-impacts").innerHTML = impacts.filter((i) => ft >= i.stage).map((i) => `<li><b>${i.stage} ft</b> ${esc(i.statement)}</li>`).join("")
      || `<li class="muted">Below NWS impact stages (first impact at 28 ft).</li>`;
  },
  facts(a) {
    const g = live?.gauge;
    const peak = g?.forecastSeries.reduce((m, p) => (p[1] > m[1] ? p : m), ["", -1] as [string, number]);
    return {
      scenario: a.state.mode === "live" ? "live" : a.state.mode === "ida" ? "Hurricane Ida 2021 replay" : "what-if",
      river_level_ft: +a.state.stageFt.toFixed(1), flood_category: catOf(a.state.stageFt), flood_stage_ft: 28,
      forecast_peak: a.state.mode === "live" && peak?.[0] ? { ft: +peak[1].toFixed(1), at: et(peak[0]) } : null,
      nws_alerts: a.state.mode === "live" ? (live?.alerts ?? []).map((x) => x.event) : [],
    };
  },
};
export default feature;
