/** River: live Bound Brook gauge (NWS), alerts, and the scenarios (Live, a replay of a real flood, What-if). */
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
/** A real flood at Bound Brook, hourly (floods.json, from USGS). The replay mode is still called "ida" in code. */
export type Flood = { id: string; short: string; name: string; year: number; what: string; series: [string, number][]; crest: [string, number] };
export type Ida = Flood;
export type River = {
  /** the flood being replayed (a getter: it changes when another flood is picked) */
  ida: Ida;
  floods: Flood[];
  setFlood: (id: string) => void;
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

let ida: Ida, floods: Flood[] = [], live: Live | null = null, idaIdx = 0, playing = 0, app: App;

/** Start a replay ~10 hours before the crest: the rise is the interesting part. */
const startIdx = () => Math.max(0, ida.series.findIndex((p) => p[0] >= ida.crest[0].slice(0, 13)) - 10);

type Tab = "ida" | "manual";
let tab: Tab = "ida";

function setMode(m: Mode) {
  app.state.mode = m;
  if (playing && m !== "ida") togglePlay();
  if (m === "ida") tab = "ida";
  else if (m === "whatif" && tab === "ida") tab = "manual";
  syncUi();
  if (m === "live") applyLive();
  if (m === "ida") { if (!idaIdx) idaIdx = startIdx(); applyIda(); }
  if (m === "whatif") app.setStage(+$<HTMLInputElement>("stage-slider").value);
}

function setTab(t: Tab) {
  tab = t;
  setMode(t === "ida" ? "ida" : "whatif");
}

function syncUi() {
  const m = app.state.mode;
  document.querySelectorAll<HTMLButtonElement>("#mode-seg button").forEach((b) => {
    const on = (b.dataset.m === "live") === (m === "live");
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
  });
  $("whatif-bar").hidden = m === "live";
  const pill = $("mode-pill");
  pill.hidden = m !== "live";   // only the live indicator sits under the title; what-if shows in its own bar
  document.querySelectorAll<HTMLButtonElement>("#wi-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("ida-ctl").hidden = tab !== "ida";
  $("whatif-ctl").hidden = tab !== "manual";
  app.map?.resize();
}

/** The time beside the level: now when live, the replay hour during Ida, none for a made-up level. */
function stampTop() {
  const m = app.state.mode;
  $("top-time").textContent = m === "live" ? `${et(new Date().toISOString())} ET` : "";
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
  const hour = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  $("ida-label").textContent = `${et(t)} · crest ${ida.crest[1]} ft at ${hour(ida.crest[0])} ET`;
  $("g-note").textContent = `${ida.short} replay · ${et(t)} ET · white dot = this hour`;
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

/** NWS flood categories at this gauge, as colors (shared by the chart bands and the level bar). */
const CAT_COLOR: Record<string, string> = { action: "#fde047", minor: "#fb923c", moderate: "#f87171", major: "#f0abfc" };

/** One bar from 15 to 45 ft split into the NWS categories, with a marker at the current level. */
function drawLevelBar(ft: number) {
  const LO = 15, HI = 45, pct = (v: number) => ((Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO)) * 100;
  const segs = [["normal", LO, 26, "#1f6f43"], ["action", 26, 28, CAT_COLOR.action], ["minor", 28, 30, CAT_COLOR.minor], ["moderate", 30, 33, CAT_COLOR.moderate], ["major", 33, HI, CAT_COLOR.major]] as const;
  $("g-bar").innerHTML = `<div class="lvl-track">${segs.map(([, a, b, c]) => `<i style="left:${pct(a)}%;width:${pct(b) - pct(a)}%;background:${c}"></i>`).join("")}
      <b class="lvl-mark" style="left:${pct(ft)}%"></b></div>
    <div class="lvl-labels">${[26, 28, 30, 33].map((v) => `<span style="left:${pct(v)}%">${v}</span>`).join("")}<span style="left:${pct(HI)}%;transform:translateX(-100%)">ft</span></div>`;
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
  const tops = [...CATS].sort((a, b) => a.ft - b.ft);   // action 26, minor 28, moderate 30, major 33
  const cats = tops.map((c, i) => { const top = Y(Math.min(hi, tops[i + 1]?.ft ?? hi)), bot = Y(c.ft);
    return `<rect x="0" width="300" y="${top}" height="${Math.max(0, bot - top)}" fill="${CAT_COLOR[c.k]}" fill-opacity=".24"/>`; }).join("");
  Object.assign(svg.dataset, { t0: String(t0), t1: String(t1), lo: String(lo), hi: String(hi) });
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
    floods = await getJson<Flood[]>("/data/floods.json");
    ida = floods.find((f) => f.id === "ida") ?? floods[0];
    const head = document.createElement("span");
    head.innerHTML = `<span id="top-time" class="muted mono"></span><span id="top-stage" class="mono">--.- ft</span> <span id="top-cat" class="cat">--</span>`;
    head.className = "top-river";
    app.headerNow(head);
    const pill = document.createElement("span");
    pill.id = "mode-pill";
    pill.className = "pill live";
    pill.textContent = "LIVE";
    app.heroStatus(pill);
    setInterval(stampTop, 1000);

    const modeCtl = document.createElement("div");
    modeCtl.className = "mode-float";
    // Admin only for now: students see the live river. A demo link (?scenario=ida) still opens the replay bar, with Back to Live.
    modeCtl.dataset.views = "admin";
    modeCtl.innerHTML = `<div class="seg2" id="mode-seg" role="group" aria-label="River data"><button data-m="live">● LIVE</button><button data-m="whatif">WHAT-IF ▾</button></div>`;
    app.mapOverlay(modeCtl);
    $("whatif-bar").innerHTML = `
      <span class="tag">WHAT-IF</span>
      <div class="seg" id="wi-tabs"><button data-tab="ida">Real floods</button><button data-tab="manual">Manual</button></div>
      <div class="wi-pane" id="ida-ctl" hidden>
        <select id="flood-pick" class="flood-pick" aria-label="Flood to replay">${floods.map((f) => `<option value="${f.id}">${esc(f.short)} · ${f.crest[1]} ft</option>`).join("")}</select>
        <button id="ida-play" class="btn small">▶ Play</button><input id="ida-scrub" type="range" min="0" max="0" value="0" aria-label="Replay hour" />
        <span class="small" id="ida-label"></span>
      </div>
      <div class="wi-pane" id="whatif-ctl" hidden>
        <label class="small muted" for="stage-slider">Bound Brook river stage</label>
        <input id="stage-slider" type="range" min="15" max="45" step="0.1" value="30" /><span id="stage-val" class="mono">30.0 ft</span>
        <div class="chips" id="presets" style="margin:0"></div>
      </div>
      <button id="wi-live" class="btn small" style="margin-left:auto;border-color:#16a34a;color:#86efac">Back to Live</button>`;
    app.card({ col: "left", id: "gauge-card", title: "Raritan River at Bound Brook", order: 20,
      extraTitle: ` <a class="src" href="https://water.noaa.gov/gauges/bdkn4" target="_blank" rel="noopener">NWS ↗</a>`, html: `
      <div class="gauge">
        <div><span id="g-stage" class="big mono">--.-</span><span class="unit"> ft</span></div>
        <div class="g-side"><div id="g-cat" class="cat">--</div><div class="small muted" id="g-rise">rise --</div></div>
      </div>
      <div class="lvl" id="g-bar" aria-hidden="true"></div>
      <svg id="spark" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="River stage over time"></svg>
      <div class="small muted" id="g-note"></div>
      <details class="impacts-box"><summary>What this level means in Bound Brook (NWS)</summary><ul class="impacts" id="g-impacts"></ul></details>` });
    app.card({ col: "left", id: "alerts-card", title: "NWS alerts · New Brunswick", order: 70,
      extraTitle: ` <a class="src" href="https://www.weather.gov/phi/" target="_blank" rel="noopener">Mt Holly ↗</a>`, html: `<ul class="alerts" id="alerts"><li class="muted">Loading…</li></ul>` });

    document.querySelectorAll<HTMLButtonElement>("#mode-seg button").forEach((b) => (b.onclick = () => (b.dataset.m === "live" ? setMode("live") : setTab(tab))));
    document.querySelectorAll<HTMLButtonElement>("#wi-tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab as Tab)));
    $("wi-live").onclick = () => setMode("live");
    const scrub = $<HTMLInputElement>("ida-scrub");
    scrub.max = String(ida.series.length - 1);
    const pick = $<HTMLSelectElement>("flood-pick");
    pick.value = ida.id;
    /** Another real flood: same controls, its own hours, starting ~10 h before its crest. */
    const setFlood = (id: string) => {
      const f = floods.find((x) => x.id === id);
      if (!f) return;
      if (playing) togglePlay();
      ida = f; pick.value = f.id;
      scrub.max = String(ida.series.length - 1);
      idaIdx = startIdx();
      if (app.state.mode === "ida") applyIda(); else setTab("ida");
    };
    pick.onchange = () => setFlood(pick.value);
    scrub.oninput = () => { idaIdx = +scrub.value; applyIda(); };
    $("ida-play").onclick = togglePlay;
    const slider = $<HTMLInputElement>("stage-slider");
    slider.oninput = () => { tab = "manual"; app.setStage(+slider.value); };
    for (const p of PRESETS) {
      const c = document.createElement("button");
      c.className = "chip"; c.textContent = p.label;
      c.onclick = () => { slider.value = String(p.ft); tab = "manual"; app.setStage(p.ft); };
      $("presets").append(c);
    }
    app.provide("river", {
      get ida() { return ida; }, floods, setFlood, live: () => live, idaIndex: () => idaIdx,
      setIdaIndex: (i) => { idaIdx = i; if (app.state.mode === "ida") applyIda(); },
      setMode, setWhatIf: (ft) => { slider.value = String(ft); tab = "manual"; if (app.state.mode === "whatif") app.setStage(ft); },
    });
    syncUi();
    await refreshLive();
    setInterval(() => app.state.mode === "live" && refreshLive(), 60_000);
  },
  update(a) {
    stampTop();
    // screen readers read these instead of "34 of 63"
    const c = catOf(a.state.stageFt), catText = c === "normal" ? "no flooding" : `${c} flooding`;
    $("ida-scrub").setAttribute("aria-valuetext", `${et(ida.series[idaIdx][0])} ET, river ${ida.series[idaIdx][1].toFixed(1)} feet, ${catText}`);
    $("stage-slider").setAttribute("aria-valuetext", `${a.state.stageFt.toFixed(1)} feet at Bound Brook, ${catText}`);
    const ft = a.state.stageFt, rise = a.rise(), cat = catOf(ft);
    for (const id of ["top-cat", "g-cat"]) { const el = $(id); el.className = `cat ${cat}`; el.textContent = cat === "normal" ? "no flooding" : `${cat} flood`; }
    $("top-stage").textContent = fmtFt(ft);
    $("g-stage").textContent = ft.toFixed(1);
    $("stage-val").textContent = fmtFt(ft);
    $("g-rise").textContent = `${(rise / 3.048).toFixed(1)} ft above normal`;
    drawLevelBar(ft);
    const impacts = live?.gauge?.impacts ?? [];
    $("g-impacts").innerHTML = impacts.filter((i) => ft >= i.stage).map((i) => `<li><b>${i.stage} ft</b> ${esc(i.statement)}</li>`).join("")
      || `<li class="muted">Below NWS impact stages (first impact at 28 ft).</li>`;
  },
  facts(a) {
    const g = live?.gauge;
    const peak = g?.forecastSeries.reduce((m, p) => (p[1] > m[1] ? p : m), ["", -1] as [string, number]);
    return {
      scenario: a.state.mode === "live" ? "live" : a.state.mode === "ida" ? `${ida.what} replay` : "what-if",
      river_level_ft: +a.state.stageFt.toFixed(1), flood_category: catOf(a.state.stageFt), flood_stage_ft: 28,
      forecast_peak: a.state.mode === "live" && peak?.[0] ? { ft: +peak[1].toFixed(1), at: et(peak[0]) } : null,
      nws_alerts: a.state.mode === "live" ? (live?.alerts ?? []).map((x) => x.event) : [],
    };
  },
};
export default feature;
