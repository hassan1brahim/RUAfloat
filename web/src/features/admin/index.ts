/** Admin view: what's at risk, what changed, and what needs a decision. All reasoning is in /api/admin; this only shows it. */
import type { App, Feature } from "../../core/app";
import { $, esc, et } from "../../core/util";
import "./style.css";
import { adminPost } from "../../lib/admin-token";

type Building = { id: string; name: string; use: string; housing: boolean; lon: number; lat: number; touch_ft: number; deep_ft: number | null;
  margin_ft: number; status: "deep" | "at walls" | "near" | "dry"; reached_at: string | null };
type Road = { name: string; lon: number | null; lat: number | null; status: "closed" | "closing" | "open"; closes_walking_ft: number; closes_vehicles_ft: number | null;
  margin_ft: number; closes_at: string | null; observed: string | null };
type Event = { time: string; kind: string; level: "ok" | "warn" | "bad"; text: string; report?: string };
type Review = { id: string; time: string; lat: number; lon: number; note: string; photo: string;
  ai: { water: boolean; depth_cm: [number, number] | null; reference: string | null; concerns: string | null } };
type DispatchStatus = "pending" | "acknowledged" | "en-route" | "on-scene" | "cleared";
type Dispatch = { id: string; target: string; kind: "road" | "building"; unit: string; status: DispatchStatus; history: { status: DispatchStatus; at: string }[] };
type Unit = { name: string; kind: "police" | "fire" | "hospital"; meters: number };
type Admin = {
  scenario: { mode: string; stage_ft: number; outlook_from: string | null; peak: { ft: number; at: string } | null };
  buildings: { top: Building[]; summary: { deep: number; at_walls: number; near: number; reached_in_outlook: number; housing_reached: number; mapped: number } };
  roads: { roads: Road[]; summary: { closed: number; closing: number } };
  feed: Event[]; review: Review[]; dispatch: Dispatch[];
};

/** Closing levels this close to normal flow would flood every week: almost certainly a model edge, not a real closure. */
const SUSPECT_FT = 19;

let last: Admin | null = null, timer = 0, inflight = false;
let picking: { kind: "road" | "building"; target: string; lon: number; lat: number } | null = null;

const NEXT_LABEL: Partial<Record<DispatchStatus, string>> = { pending: "Acknowledge", acknowledged: "Mark en route", "en-route": "Mark on scene", "on-scene": "Clear" };
const UNIT_KIND = { police: "Police", fire: "Fire", hospital: "Hospital" };

/** Dispatch button for a row, or the open dispatch's unit and status. */
function dispatchCell(kind: "road" | "building", name: string, lon: number | null, lat: number | null) {
  const open = last?.dispatch.find((x) => x.target === name && x.status !== "cleared");
  if (open) return `<br><span class="disp-on">${esc(open.unit)} · ${open.status.replace("-", " ")}</span>`;
  if (lon == null || lat == null) return "";
  return `<br><button class="link small" data-dispatch="${kind}" data-target="${esc(name)}" data-lon="${lon}" data-lat="${lat}">Dispatch</button>`;
}

function query(app: App) {
  const q = new URLSearchParams({ mode: app.state.mode });
  const river = app.maybe("river");
  if (app.state.mode === "ida" && river) q.set("t", river.ida.series[river.idaIndex()][0].slice(0, 13));
  if (app.state.mode === "whatif") q.set("stage", app.state.stageFt.toFixed(1));
  return q;
}

async function load(app: App) {
  if (app.state.view !== "admin" || inflight) return;
  inflight = true;
  try {
    const r = await fetch(`/api/admin?${query(app)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    last = d; render();
  } catch (e) {
    $("adm-bldg").innerHTML = `<div class="muted small">Admin data unavailable (${esc((e as Error).message)}).</div>`;
  } finally { inflight = false; }
}

const when = (iso: string | null) => (iso ? `${et(iso)} ET` : "");
const ftTo = (n: number) => (n > 0 ? `${n.toFixed(1)} ft to go` : "reached");

function render() {
  const d = last!;
  const b = d.buildings, s = b.summary, outlook = d.scenario.outlook_from;
  const reached = s.deep + s.at_walls;
  $("adm-bldg-sum").innerHTML = reached
    ? `<b>${reached}</b> reached by water${s.housing_reached ? ` · <b class="bad">${s.housing_reached} housing</b>` : ""}${s.near ? ` · ${s.near} within 3 ft` : ""}`
    : s.reached_in_outlook ? `<b class="warn">${s.reached_in_outlook}</b> reached ${outlook?.startsWith("Ida") ? "later in the Ida record" : "within the NWS forecast"}`
    : `None of ${s.mapped} buildings reached${d.scenario.peak ? `, even at the ${d.scenario.peak.ft} ft peak` : ""}. Closest:`;
  $("adm-bldg").innerHTML = b.top.slice(0, 6).map((x) => `<li data-lon="${x.lon}" data-lat="${x.lat}" tabindex="0">
      <span><b>${esc(x.name)}</b>${x.housing ? ` <span class="tag deep">housing</span>` : ""}<br>
      <span class="muted">${esc(x.use)} · walls at ${x.touch_ft} ft · ${ftTo(x.margin_ft)}${x.reached_at ? ` · <b class="warn">reached ${when(x.reached_at)}</b>` : ""}</span>${dispatchCell("building", x.name, x.lon, x.lat)}</span>
      <span class="tag ${x.status === "deep" ? "deep" : x.status === "at walls" ? "touch" : x.status === "near" ? "near" : "dry"}">${x.status === "deep" ? "≥ 30 cm" : x.status}</span></li>`).join("");

  const r = d.roads;
  $("adm-roads-sum").textContent = `${r.summary.closed} closed · ${r.summary.closing} closing${outlook ? ` (${outlook.startsWith("Ida") ? "Ida record" : "NWS forecast"})` : ""}`;
  $("adm-roads").innerHTML = r.roads.slice(0, 8).map((x) => `<li>
      <span><b>${esc(x.name)}</b><br><span class="muted">walking ${x.closes_walking_ft} ft${x.closes_vehicles_ft ? ` · cars ${x.closes_vehicles_ft} ft` : ""}${x.closes_at ? ` · <b class="warn">closes ${when(x.closes_at)}</b>` : x.status === "open" ? ` · ${ftTo(x.margin_ft)}` : ""}</span>
      ${x.observed ? `<br><span class="obs">observed: ${esc(x.observed)}</span>` : ""}
      ${x.closes_walking_ft < SUSPECT_FT && !x.observed ? `<br><span class="suspect" title="Closes near normal river level: the model is least reliable right next to the channel">near normal flow: unverified</span>` : ""}${dispatchCell("road", x.name, x.lon, x.lat)}</span>
      <span class="tag ${x.status === "closed" ? "deep" : x.status === "closing" ? "touch" : "dry"}">${x.status}</span></li>`).join("");

  $("adm-feed").innerHTML = d.feed.length
    ? d.feed.map((e) => `<li class="${e.level}"><span class="mono muted">${when(e.time)}</span> ${esc(e.text)}</li>`).join("")
    : `<li class="muted">Nothing new.</li>`;

  $("adm-review").innerHTML = (d.review.length
    ? d.review.map((x) => `<li data-id="${esc(x.id)}">
        <img src="${esc(x.photo)}" alt="Reported flooding photo" loading="lazy" />
        <div><span class="muted mono">${when(x.time)}</span><br>
        AI: ${x.ai.water ? `water${x.ai.depth_cm ? ` ${x.ai.depth_cm[0]}–${x.ai.depth_cm[1]} cm` : ""}` : "unclear"}${x.ai.reference ? ` (${esc(x.ai.reference)})` : ""}${x.ai.concerns ? `<br><span class="warn">${esc(x.ai.concerns)}</span>` : ""}
        ${x.note ? `<br>“${esc(x.note)}”` : ""}
        <div class="row gap"><button class="btn small" data-verdict="confirmed">Confirm</button><button class="btn small ghost" data-verdict="rejected">Reject</button><button class="link small" data-show>Show</button></div></div></li>`).join("")
    : `<li class="muted">No reports waiting.</li>`);
  $("adm-review-n").textContent = d.review.length ? String(d.review.length) : "";

  $("adm-disp").innerHTML = d.dispatch.length
    ? d.dispatch.map((x) => `<li data-id="${esc(x.id)}" class="${x.status === "pending" ? "pending" : ""}">
        <span><b>${esc(x.unit)}</b> → ${esc(x.target)}<br><span class="muted">${x.status.replace("-", " ")} · ${when(x.history.at(-1)!.at)}</span></span>
        ${NEXT_LABEL[x.status] ? `<button class="btn small" data-from="${x.status}">${NEXT_LABEL[x.status]}</button>` : `<span class="tag dry">cleared</span>`}</li>`).join("")
    : `<li class="muted">No units sent. Use Dispatch on a building or road.</li>`;
  $("adm-disp-n").textContent = String(d.dispatch.filter((x) => x.status !== "cleared").length || "");
}

/** The unit picker: nearest police, fire and hospital to the target, or a typed name. */
async function openPicker(p: NonNullable<typeof picking>) {
  picking = p;
  const form = $("adm-disp-form");
  form.hidden = false;
  form.innerHTML = `<div class="small">Send to <b>${esc(p.target)}</b></div><div class="muted small">Loading nearest units…</div>`;
  let units: Unit[] = [];
  try { units = await (await fetch(`/api/dispatch/units?lon=${p.lon}&lat=${p.lat}`)).json(); } catch { /* typed name still works */ }
  if (picking !== p) return;
  form.innerHTML = `<div class="small">Send to <b>${esc(p.target)}</b></div>
    <select id="adm-disp-unit" aria-label="Unit">${units.map((u) => `<option value="${esc(u.name)}">${UNIT_KIND[u.kind]} · ${esc(u.name)} (${(u.meters / 1000).toFixed(1)} km)</option>`).join("")}<option value="">Other (type a name)</option></select>
    <input id="adm-disp-other" class="adm-token" placeholder="Unit name, e.g. RUPD-3" aria-label="Unit name" ${units.length ? "hidden" : ""} />
    <div class="row gap"><button class="btn small" data-confirm>Send</button><button class="btn small ghost" data-cancel>Cancel</button></div>
    <div class="small warn" id="adm-disp-err"></div>
    <div class="muted small">Records the decision here. It does not contact the station: call them as usual.</div>`;
  $<HTMLSelectElement>("adm-disp-unit").onchange = (e) => ($("adm-disp-other").hidden = (e.target as HTMLSelectElement).value !== "");
}

function closePicker() {
  picking = null;
  $("adm-disp-form").hidden = true;
}

const feature: Feature = {
  id: "admin",
  init(app) {
    app.card({ col: "right", id: "adm-bldg-card", title: "Highest-risk buildings", order: 5, html: `<div class="small" id="adm-bldg-sum"></div><ul class="alist" id="adm-bldg"><li class="muted">Loading…</li></ul>` });
    app.card({ col: "right", id: "adm-roads-card", title: "Roads: closed and closing", order: 15, html: `<div class="small" id="adm-roads-sum"></div><ul class="alist" id="adm-roads"></ul>` });
    app.card({ col: "right", id: "adm-review-card", title: "Needs a decision", order: 25, extraTitle: ` <span class="count" id="adm-review-n"></span>`,
      html: `<ul class="alist review" id="adm-review"></ul><div class="small warn" id="adm-review-err"></div>`,
    });
    app.card({ col: "right", id: "adm-disp-card", title: "Dispatch", order: 20, extraTitle: ` <span class="count" id="adm-disp-n"></span>`,
      html: `<div id="adm-disp-form" class="disp-form" hidden></div><ul class="alist disp" id="adm-disp"></ul><div class="muted small">Unit screen: <a href="/unit.html" target="_blank">/unit.html</a></div>` });
    app.card({ col: "left", id: "adm-feed-card", title: "What changed", order: 5, html: `<ul class="feed" id="adm-feed"></ul>` });

    const fly = (lon: number, lat: number) => app.map.flyTo({ center: [lon, lat], zoom: 16.5, duration: 800 });
    const onDispatch = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-dispatch]");
      if (!b) return false;
      void openPicker({ kind: b.dataset.dispatch as "road" | "building", target: b.dataset.target!, lon: +b.dataset.lon!, lat: +b.dataset.lat! });
      $("adm-disp-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
      return true;
    };
    $("adm-roads").addEventListener("click", onDispatch);
    $("adm-bldg").addEventListener("click", (e) => {
      if (onDispatch(e)) return;
      const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-lon]");
      if (li) fly(+li.dataset.lon!, +li.dataset.lat!);
    });
    $("adm-review").addEventListener("click", async (e) => {
      const t = e.target as HTMLElement, li = t.closest<HTMLElement>("li[data-id]");
      if (!li || !last) return;
      const item = last.review.find((x) => x.id === li.dataset.id)!;
      if (t.dataset.show != null) return fly(item.lon, item.lat);
      const verdict = t.dataset.verdict;
      if (!verdict) return;
      const err = $("adm-review-err");
      const r = await adminPost(`/api/reports/${item.id}/review`, { verdict }, err);
      if (!r.ok) { err.textContent = (await r.json().catch(() => null))?.error || `Request failed (${r.status}).`; return; }
      err.textContent = "";
      await load(app);
      app.refresh();   // routing and the map pick up the decision
    });
    $("adm-disp-form").addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.cancel != null) return closePicker();
      if (t.dataset.confirm == null || !picking) return;
      const sel = $<HTMLSelectElement>("adm-disp-unit").value, unit = sel || $<HTMLInputElement>("adm-disp-other").value.trim();
      const err = $("adm-disp-err");
      if (!unit) return void (err.textContent = "Pick or type a unit.");
      const r = await adminPost("/api/dispatch", { ...picking, unit }, err);
      if (!r.ok) return void (err.textContent = (await r.json()).error);
      closePicker();
      await load(app);
    });
    $("adm-disp").addEventListener("click", async (e) => {
      const t = e.target as HTMLElement, li = t.closest<HTMLElement>("li[data-id]");
      if (!li || !t.dataset.from) return;
      await adminPost(`/api/dispatch/${li.dataset.id}/advance`, { from: t.dataset.from }, li);
      await load(app);   // a 409 means the other screen moved it first; reload shows where it is
    });
    setInterval(() => app.state.mode === "live" && load(app), 30_000);
  },
  update(app) {
    // the Ida replay redraws every 220 ms: ask the server at most every 400 ms
    clearTimeout(timer);
    timer = window.setTimeout(() => void load(app), 400);
  },
};
export default feature;
