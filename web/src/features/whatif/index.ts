/**
 * What-if, extended from "pick a river level" to "what happens next":
 * - Forecast: our ML model, 18 h ahead, with an error band; the map plays through it and
 *   every road and Rutgers building that floods is listed with when, the level, and how sure we are.
 * - Past flood, Ida 2021: what our model forecast at each hour vs what happened, and how many hours of warning
 *   each road would have had.
 * The flood map itself is the existing elevation model: this feature only chooses which river level to show when.
 */
import type { App, Feature } from "../../core/app";
import { $, catOf, et, getJson } from "../../core/util";
import { announce, speak } from "../../lib/speech";
import { GENERIC_ROAD } from "../roads";
import { buildTimeline, closures, dmToFt, firstReach, idaWarning, type Closure, type IdaHour, type Item, type Point } from "./model";
import "./style.css";

type View = "level" | "forecast" | "ida";
type Ml = { issued: string; now_ft: number; predictions: { h: number; ft: number }[]; scores: Record<string, { mae_ft_high_water: number | null }>; error?: string };
type Building = { name: string; touch: number; lon: number; lat: number };

/** The simulated clock while a What-if replay is on screen, so other features (rain) can follow the same moment. */
export type SimClock = { kind: "forecast" | "ida"; t: number };
declare module "../../core/app" { interface Services { simClock: () => SimClock | null } }

const NEVER = 65535;
let view: View = "level", wasWhatIf = false;
let items: Item[] = [];
let ml: Ml | null = null, idaHours: IdaHour[] = [];
let timeline: Point[] = [], idx = 0, playing = 0;
let result: { upcoming: Closure[]; already: Item[] } = { upcoming: [], already: [] };
let liveForecast: { points: Point[]; upcoming: Closure[] } | null = null;
let idaIssue = 0;   // which Ida hour the forecast was issued at

// Simulation: plays the prediction on the map. `pos` is a fractional hour so the water rises smoothly between hours.
type Case = "expected" | "worst" | "best";
let simCase: Case = "expected", speed = 1, pos = 0, prevFt: number | null = null;
const CASE_LABEL: Record<Case, string> = { expected: "Expected", worst: "Worst case (top of error range)", best: "Best case (bottom of error range)" };
const toasts: { text: string; until: number }[] = [];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hoursFrom = (a: number, b: number) => Math.round((b - a) / 3600e3);
// Held-out high-water error per horizon; the fallbacks are the last trained scores, used until the live model answers.
const FALLBACK_ERR: Record<number, number> = { 3: 0.25, 6: 0.63, 12: 1.87, 18: 2.5 };
const errOf = (m: Ml | null) => Object.fromEntries((m?.predictions?.map((p) => p.h) ?? [3, 6, 12, 18]).map((h) => [h, m?.scores?.[`${h}h`]?.mae_ft_high_water ?? FALLBACK_ERR[h] ?? 2.5]));
const catLabel = (ft: number) => { const c = catOf(ft); return c === "normal" ? "no flooding" : c === "action" ? "action stage, just below flooding" : `${c} flooding`; };
const hrs = (n: number) => `${n} hour${n === 1 ? "" : "s"}`;

/** Roads (lowest closing level of each named road) and Rutgers buildings (level where water reaches the walls). */
function buildItems(app: App, buildings: Building[]) {
  const router = app.get("router"), best = new Map<string, number>();
  const count = (router as unknown as { r: { edges: unknown[] } }).r.edges.length;
  for (let i = 0; i < count; i++) {
    const e = router.edge(i), name = router.edgeName(i);
    if (e[3] >= NEVER || GENERIC_ROAD.test(name)) continue;
    const prev = best.get(name);
    if (prev == null || e[3] < router.edge(prev)[3]) best.set(name, i);
  }
  const roads: Item[] = [...best.entries()].map(([name, i]) => {
    const [lon, lat] = router.edgeSamples(i)[0];
    return { name, kind: "road", closeFt: +dmToFt(router.edge(i)[3]).toFixed(1), lon, lat };
  });
  const blds: Item[] = buildings.filter((b) => b.touch < NEVER && b.lon)
    .map((b) => ({ name: b.name, kind: "building", closeFt: +dmToFt(b.touch).toFixed(1), lon: b.lon, lat: b.lat }));
  return [...roads, ...blds];
}

function liveTimeline(app: App): Point[] | null {
  const g = app.get("river").live()?.gauge;
  if (!g || !ml || ml.error) return null;
  return buildTimeline({ start: Date.parse(g.observed.validTime), nowFt: g.observed.primary, ml: ml.predictions, err: errOf(ml), hours: 18 });
}

function idaTimeline(app: App): Point[] {
  const h = idaHours[idaIssue], series = app.get("river").ida.series;
  const actual = (t: number) => { const p = series.find(([s]) => Math.abs(Date.parse(s) - t) < 1800e3); return p ? p[1] : null; };
  return buildTimeline({ start: Date.parse(h.t), nowFt: h.now, ml: Object.keys(h.pred).map((k) => ({ h: parseInt(k), ft: h.pred[k] })), err: errOf(ml), hours: Math.max(...Object.keys(h.pred).map((k) => parseInt(k))), actual });
}

function chart(points: Point[], cursor: number, cursorFt = points[cursor]?.ft) {
  if (!points.length) return "";
  const W = 300, H = 96, all = points.flatMap((p) => [p.ft - p.err, p.ft + p.err, p.actual ?? p.ft]);
  const lo = Math.min(...all, 16) - 0.5, hi = Math.max(...all, 29) + 0.5;
  const X = (i: number) => (i / Math.max(1, points.length - 1)) * W, Y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  const line = (sel: (p: Point) => number | null | undefined, from = 0, to = points.length) =>
    points.slice(from, to).map((p, k) => [k + from, sel(p)] as const).filter(([, v]) => v != null)
      .map(([i, v], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(v!).toFixed(1)}`).join("");
  const band = `${line((p) => p.ft + p.err)} ${points.map((p, i) => [i, p.ft - p.err] as const).reverse().map(([i, v]) => `L${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("")} Z`;
  const split = points.findIndex((p) => p.source === "NWS");
  return `<svg class="wf-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${band}" fill="#38bdf8" fill-opacity=".15"/>
    <line x1="0" x2="${W}" y1="${Y(28)}" y2="${Y(28)}" stroke="#fb923c" stroke-dasharray="3 3" stroke-opacity=".6"/>
    ${split > 0 ? `<line x1="${X(split)}" x2="${X(split)}" y1="0" y2="${H}" stroke="#fff" stroke-opacity=".15"/>` : ""}
    <path d="${line((p) => p.ft, 0, split > 0 ? split + 1 : points.length)}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    ${split > 0 ? `<path d="${line((p) => p.ft, split)}" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="4 3"/>` : ""}
    ${points.some((p) => p.actual != null) ? `<path d="${line((p) => p.actual)}" fill="none" stroke="#f0abfc" stroke-width="1.5"/>` : ""}
    <line x1="${X(cursor)}" x2="${X(cursor)}" y1="0" y2="${H}" stroke="#fff" stroke-opacity=".5"/>
    <circle cx="${X(cursor)}" cy="${Y(cursorFt)}" r="3.5" fill="#fff"/>
  </svg>`;
}

function describe(app: App, p: Point, i: number) {
  const roads = app.get("router").closedSummary(app.rise()).named.length;
  p = { ...p, ft: app.state.stageFt };
  const when = i === 0 ? (view === "ida" ? `At ${et(new Date(p.t).toISOString())}` : "Now") : `In ${i} hour${i === 1 ? "" : "s"}`;
  return `${when}, ${p.ft.toFixed(1)} feet${p.err ? ` ± ${p.err.toFixed(1)}` : ""}, ${catLabel(p.ft)}, ${roads} named road${roads === 1 ? "" : "s"} closed to walking. Source: ${p.source}.`;
}

function render(app: App) {
  const body = $("wf-body");
  $("whatif-ctl").hidden = view !== "level";
  body.hidden = view === "level";
  if (view === "level") return;
  if (!timeline.length) {
    body.innerHTML = `<p class="muted">${view === "forecast" ? `Forecast unavailable${ml?.error ? `: ${esc(ml.error)}` : " (no live river data or ML forecast right now)"}. Try again in a minute, or use Pick a level.` : "Ida forecast data not loaded."}</p>`;
    return;
  }
  const p = timeline[idx];
  const scrub = $<HTMLInputElement>("wf-scrub");
  const done = result.upcoming.filter((c) => c.at <= p.t).length;
  $("wf-chart").innerHTML = chart(timeline, idx, app.state.stageFt);
  hud(app);
  $("wf-now").textContent = describe(app, p, idx);
  scrub.max = String(timeline.length - 1);
  scrub.value = String(idx);
  scrub.setAttribute("aria-valuetext", describe(app, p, idx));
  $("wf-progress").textContent = result.upcoming.length ? `${done} of ${result.upcoming.length} flooded by this time` : "";
}

function renderList(app: App) {
  const list = $("wf-list"), start = timeline[0]?.t ?? 0, span = timeline.length - 1;
  const roads = result.upcoming.filter((c) => c.kind === "road"), blds = result.upcoming.filter((c) => c.kind === "building");
  const li = (c: Closure, i: number) => {
    const actual = view === "ida" ? (c.actualAt ? ` · actually flooded ${et(new Date(c.actualAt).toISOString())}` : " · never reached it in Ida") : "";
    return `<li><button class="wf-item ${c.confidence}" data-i="${i}">
      <b>${esc(c.name)}</b> ${c.confidence === "likely" ? "" : "may "}${c.kind === "road" ? (c.confidence === "likely" ? "closes" : "close") + " to walking" : (c.confidence === "likely" ? "floods" : "flood") + " at the walls"}
around <b>${et(new Date(c.at).toISOString())}</b> (in ~${hoursFrom(start, c.at)} h, river ${c.ftAt.toFixed(1)} ft, closes at ${c.closeFt} ft)
      <span class="tag ${c.confidence}">${c.confidence}</span>${actual}</button></li>`;
  };
  const all = [...roads, ...blds];
  $("wf-head").textContent = `What floods in the next ${span} hours`;
  list.innerHTML = all.length
    ? `${roads.length ? `<li class="wf-sub">Roads and paths (${roads.length})</li>${roads.map((c) => li(c, all.indexOf(c))).join("")}` : ""}
       ${blds.length ? `<li class="wf-sub">Rutgers buildings (${blds.length})</li>${blds.map((c) => li(c, all.indexOf(c))).join("")}` : ""}`
    : `<li class="muted">No roads or Rutgers buildings are forecast to flood in the next ${span} hours.</li>`;
  $("wf-already").textContent = result.already.length ? `${result.already.filter((x) => x.kind === "road").length} roads and ${result.already.filter((x) => x.kind === "building").length} buildings are already flooded at the start.` : "";
  list.querySelectorAll<HTMLButtonElement>(".wf-item").forEach((b) => (b.onclick = () => {
    const c = all[+b.dataset.i!];
    jump(app, timeline.findIndex((p) => p.t >= c.at));
    app.map.flyTo({ center: [c.lon, c.lat], zoom: 16, duration: 900 });
  }));
}

function renderIdaSummary(app: App) {
  const series = app.get("river").ida.series, box = $("wf-ida");
  if (view !== "ida") { box.hidden = true; return; }
  box.hidden = false;
  const warned = items.filter((i) => i.kind === "road").map((i) => ({ i, w: idaWarning(idaHours, series, i.closeFt) }))
    .filter((x) => x.w).sort((a, b) => a.w!.actual - b.w!.actual);
  const leads = warned.map((x) => x.w!.leadH).filter((h) => h > 0).sort((a, b) => a - b);
  const median = leads.length ? leads[Math.floor(leads.length / 2)] : 0;
  const most = leads.length ? leads[leads.length - 1] : 0;
  $("wf-ida-head").innerHTML = `During Hurricane Ida, our model forecast <b>${leads.length} of ${warned.length}</b> road floodings before they happened, with a median of <b>${median} hours</b> of warning (up to ${most} h).`;
  $("wf-ida-sub").textContent = "The model never saw Ida while training. This counts warnings that came true; it does not count false alarms (forecasts of flooding that didn't happen). Bridges that read as flooded before the storm are left out.";
  $("wf-ida-list").innerHTML = warned.slice(0, 12).map(({ i, w }) =>
    `<li><b>${esc(i.name)}</b>: flooded ${et(new Date(w!.actual).toISOString())}, ${w!.leadH ? `warned ${w!.leadH} h earlier` : "no advance warning"}</li>`).join("");
}

function recompute(app: App) {
  stop();
  if (view === "forecast") timeline = liveTimeline(app) ?? [];
  if (view === "ida") timeline = idaHours.length ? idaTimeline(app) : [];
  const series = app.get("river").ida.series;
  result = timeline.length ? closures(timeline, items, view === "ida" ? (ft) => firstReach(series, ft) : undefined) : { upcoming: [], already: [] };
  idx = 0; pos = 0; prevFt = null; toasts.length = 0; hudToastKey = "";
  if (view !== "level" && timeline.length) {
    $("wf-body").innerHTML = BODY;
    wire(app);
    renderList(app);
    jump(app, 0);
  }
  if (view === "ida" && idaHours.length) {
    const sel = $<HTMLSelectElement>("wf-issue");
    sel.innerHTML = idaHours.map((h, k) => `<option value="${k}" ${k === idaIssue ? "selected" : ""}>${et(h.t)} (river ${h.now.toFixed(1)} ft)</option>`).join("");
    sel.onchange = () => { idaIssue = +sel.value; recompute(app); };
  }
  renderIdaSummary(app);
  render(app);
}

/** River level at a fractional hour, for the chosen case (expected, or the top/bottom of the error range). */
function stageAt(p: number) {
  const i = Math.floor(p), j = Math.min(i + 1, timeline.length - 1), k = p - i;
  const at = (q: Point) => q.ft + (simCase === "worst" ? q.err : simCase === "best" ? -q.err : 0);
  return at(timeline[i]) + (at(timeline[j]) - at(timeline[i])) * k;
}

/** Move the simulation to a (fractional) hour and redraw the whole app at that river level. */
function seek(app: App, p: number, announceNew = false) {
  if (!timeline.length) return;
  pos = Math.max(0, Math.min(p, timeline.length - 1));
  idx = Math.round(pos);
  const ft = stageAt(pos);
  if (announceNew && prevFt != null && ft > prevFt) {
    const now = Date.now();
    for (const it of items) if (it.closeFt > prevFt && it.closeFt <= ft) toasts.push({ text: `${it.kind === "road" ? "🚧 Just closed to walking" : "🏢 Water at the walls"}: ${it.name}`, until: now + 4000 });
    const fresh = items.filter((it) => it.kind === "road" && it.closeFt > prevFt! && it.closeFt <= ft).map((it) => it.name);
    if (fresh.length) announce(`Just closed: ${fresh.slice(0, 3).join(", ")}${fresh.length > 3 ? ` and ${fresh.length - 3} more` : ""}.`);
  }
  prevFt = ft;
  app.closePopup();   // a road's popup describes the old level; don't leave stale numbers on screen
  app.setStage(+ft.toFixed(2));
}

function jump(app: App, i: number) {
  if (i < 0) return;
  prevFt = null;
  seek(app, i);
}

/**
 * The on-map simulation display: simulated time, level, what's closed, and what just closed.
 * Built once and updated in place; alerts are only re-created when they change, so they don't flicker.
 */
let hudToastKey = "";
function hud(app: App) {
  const el = $("sim-hud");
  const show = app.state.mode === "whatif" && view !== "level" && timeline.length > 0;
  el.hidden = !show;
  if (!show) return;
  if (!el.firstElementChild) el.innerHTML = `
    <div class="sim-tag" id="sim-tag"></div>
    <div class="sim-time"><span id="sim-time"></span> <span class="muted" id="sim-plus"></span></div>
    <div class="sim-stage"><span class="mono" id="sim-ft"></span> <span class="sim-cat" id="sim-cat"></span></div>
    <div class="small" id="sim-roads"></div>
    <div id="sim-toasts"></div>`;
  const t = timeline[0].t + pos * 3600e3, ft = app.state.stageFt;
  const roads = app.get("router").closedSummary(app.rise()).named.length;
  $("sim-tag").textContent = `SIMULATION · ${view === "ida" ? "Ida 2021 forecast" : "Forecast"} · ${CASE_LABEL[simCase].split(" (")[0]}`;
  $("sim-time").textContent = et(new Date(t).toISOString());
  $("sim-plus").textContent = `+${Math.floor(pos)} h`;
  $("sim-ft").textContent = `${ft.toFixed(1)} ft`;
  const cat = $("sim-cat");
  cat.textContent = catLabel(ft);
  cat.className = `sim-cat ${catOf(ft)}`;
  $("sim-roads").textContent = `${roads} named road${roads === 1 ? "" : "s"} closed to walking`;
  const now = Date.now();
  while (toasts.length && toasts[0].until < now) toasts.shift();
  const shown = toasts.slice(-3), key = shown.map((x) => x.text).join("|");
  if (key !== hudToastKey) {
    hudToastKey = key;
    $("sim-toasts").innerHTML = shown.map((x) => `<div class="sim-toast">${esc(x.text)}</div>`).join("");
  }
}

function stop() {
  if (playing) clearInterval(playing);
  playing = 0;
  const b = document.getElementById("wf-play");
  if (b) b.textContent = "▶ Simulate";
}

function select(app: App, v: View, applySlider = true) {
  view = v;
  document.querySelectorAll<HTMLButtonElement>("#wf-seg button").forEach((x) => {
    x.classList.toggle("on", x.dataset.v === v);
    x.setAttribute("aria-pressed", String(x.dataset.v === v));
  });
  if (v === "level") {
    stop();
    timeline = [];
    $("wf-body").hidden = true;
    $("wf-ida").hidden = true;
    $("whatif-ctl").hidden = app.state.mode !== "whatif";
    if (applySlider && app.state.mode === "whatif") app.get("river").setWhatIf(+$<HTMLInputElement>("stage-slider").value);
    return;
  }
  recompute(app);
}

const BODY = `
  <div id="wf-issue-row" class="wf-issue"><label class="small muted" for="wf-issue">Forecast issued at (Ida, Sept 2021)</label><select id="wf-issue"></select></div>
  <div id="wf-chart"></div>
  <div class="small muted wf-legend"><span class="sw model"></span>our model <span class="sw band"></span>error range <span class="sw actual"></span>what actually happened <span class="sw flood"></span>flood stage 28 ft</div>
  <div class="wf-sim">
    <div class="seg wf-case" id="wf-case" role="group" aria-label="Which case to simulate">
      <button data-c="expected" class="on" aria-pressed="true">Expected</button><button data-c="worst" aria-pressed="false">Worst case</button><button data-c="best" aria-pressed="false">Best case</button>
    </div>
    <div class="row"><button id="wf-play" class="btn primary small">▶ Simulate</button>
      <label class="sr-only" for="wf-speed">Speed</label><select id="wf-speed" class="wf-speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div>
    <input id="wf-scrub" type="range" min="0" max="0" value="0" aria-label="Simulated hour" />
  </div>
  <p id="wf-now" class="wf-now"></p>
  <p id="wf-progress" class="small muted"></p>
  <button id="wf-read" class="btn small">🔊 Read the forecast</button>
  <h3 id="wf-head" class="wf-h3"></h3>
  <p id="wf-already" class="small muted"></p>
  <ol id="wf-list" class="wf-list"></ol>
  <p class="small muted">Forecasts are estimates. Error range = our model's typical error at high water on years it never trained on (2021, 2023, 2024). Flood depths come from an elevation model, not a survey.</p>`;

function wire(app: App) {
  $("wf-issue-row").hidden = view !== "ida";
  const scrub = $<HTMLInputElement>("wf-scrub");
  scrub.oninput = () => { stop(); jump(app, +scrub.value); };
  const speedSel = $<HTMLSelectElement>("wf-speed");
  speedSel.value = String(speed);
  speedSel.onchange = () => (speed = +speedSel.value);
  document.querySelectorAll<HTMLButtonElement>("#wf-case button").forEach((b) => (b.onclick = () => {
    simCase = b.dataset.c as Case;
    document.querySelectorAll<HTMLButtonElement>("#wf-case button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    jump(app, pos);
  }));
  $("wf-play").onclick = () => {
    if (playing) return stop();
    if (pos >= timeline.length - 1) jump(app, 0);
    $("wf-play").textContent = "❚❚ Pause";
    // 1× = one simulated hour per second (18 h); 20 frames a second.
    const hoursPerFrame = 1 / 20;
    playing = window.setInterval(() => {
      if (pos >= timeline.length - 1) return stop();
      seek(app, pos + hoursPerFrame * speed, true);
    }, 50);
  };
  $("wf-read").onclick = () => void speak(spoken(app));
}

function spoken(app: App) {
  if (!timeline.length) return "The forecast is not available right now.";
  const span = timeline.length - 1, top = timeline.reduce((m, p) => (p.ft > m.ft ? p : m));
  const lead = view === "ida" ? `This is the forecast our model made during Hurricane Ida, at ${et(new Date(timeline[0].t).toISOString())}. ` : "";
  const peak = `${lead}Over the next ${span} hours the river is forecast to peak around ${top.ft.toFixed(1)} feet, ${catLabel(top.ft)}, about ${hrs(hoursFrom(timeline[0].t, top.t))} from ${view === "ida" ? "then" : "now"}.`;
  const roads = result.upcoming.filter((c) => c.kind === "road");
  if (!roads.length) return `${peak} No roads are forecast to flood in that time.`;
  const first = roads.slice(0, 4).map((c) => `${c.name} ${c.confidence === "likely" ? "" : "may close "}${c.confidence === "likely" ? "closes" : ""} in about ${hrs(hoursFrom(timeline[0].t, c.at))}`.replace(/\s+/g, " ")).join(", ");
  return `${peak} ${roads.length} road${roads.length === 1 ? "" : "s"} are forecast to flood. First: ${first}.`;
}

const feature: Feature = {
  id: "whatif",
  async init(app) {
    app.provide("simClock", () => (app.state.mode === "whatif" && view !== "level" && timeline.length ? { kind: view, t: timeline[0].t + pos * 3600e3 } : null));
    app.card({ col: "left", id: "wf-card", title: "What happens next?", order: 12, hidden: true, html: `
      <div class="seg" id="wf-seg" role="group" aria-label="What-if view">
        <button data-v="level" class="on" aria-pressed="true">Pick a level</button>
        <button data-v="forecast" aria-pressed="false">Forecast (18 h)</button>
        <button data-v="ida" aria-pressed="false">Past flood: Ida</button>
      </div>
      <div id="wf-ida" class="wf-ida" hidden><p id="wf-ida-head"></p><p id="wf-ida-sub" class="small muted"></p><ul id="wf-ida-list" class="small"></ul></div>
      <div id="wf-body" hidden></div>` });
    document.querySelector(".mapwrap")!.insertAdjacentHTML("beforeend", `<div id="sim-hud" class="sim-hud" hidden></div>`);
    document.querySelectorAll<HTMLButtonElement>("#wf-seg button").forEach((b) => (b.onclick = () => select(app, b.dataset.v as View)));
    // Moving the level slider means "pick a level" again.
    $("stage-slider").addEventListener("input", () => { if (view !== "level") select(app, "level", false); });

    const [blds] = await Promise.all([
      getJson<Building[]>("/data/rutgers_buildings.json").catch(() => []),
      getJson<IdaHour[]>("/data/ida_forecast.json").then((d) => (idaHours = d)).catch(() => []),
    ]);
    items = buildItems(app, blds);
    idaIssue = Math.max(0, idaHours.findIndex((h) => h.t.startsWith("2021-09-02T00")));
    const refresh = async () => {
      try { ml = await getJson<Ml>("/api/forecast"); } catch { ml = null; }
      const pts = liveTimeline(app);
      liveForecast = pts ? { points: pts, upcoming: closures(pts, items).upcoming } : null;
      if (view === "forecast") recompute(app);
    };
    await refresh();
    setInterval(refresh, 10 * 60e3);
  },
  update(app) {
    const on = app.state.mode === "whatif";
    $("wf-card").hidden = !on;
    if (!on && wasWhatIf && view !== "level") select(app, "level", false);
    wasWhatIf = on;
    if (on && view !== "level" && timeline.length) render(app);
    else $("sim-hud").hidden = true;
  },
  facts(app) {
    const f = liveForecast;
    if (!f) return { forecast_closures: null, forecast_note: "Forecast unavailable right now." };
    const start = f.points[0].t, roads = f.upcoming.filter((c) => c.kind === "road");
    return {
      forecast_window_hours: f.points.length - 1,
      forecast_peak_ft: Math.max(...f.points.map((p) => p.ft)),
      forecast_closures: roads.slice(0, 10).map((c) => ({ name: c.name, at: et(new Date(c.at).toISOString()), in_hours: hoursFrom(start, c.at), river_ft: c.ftAt, confidence: c.confidence })),
      forecast_note: roads.length ? "Forecast from our ML model, 18 hours ahead. Estimates, not certainties." : `No roads are forecast to flood in the next ${f.points.length - 1} hours.`,
    };
  },
};
export default feature;
