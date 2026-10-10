/** Admin view: what's at risk, what changed, and what needs a decision. All reasoning is in /api/admin; this only shows it. */
import type { App, Feature } from "../../core/app";
import { $, esc, et } from "../../core/util";
import "./style.css";

type Building = { id: string; name: string; use: string; housing: boolean; lon: number; lat: number; touch_ft: number; deep_ft: number | null;
  margin_ft: number; status: "deep" | "at walls" | "near" | "dry"; reached_at: string | null };
type Road = { name: string; status: "closed" | "closing" | "open"; closes_walking_ft: number; closes_vehicles_ft: number | null;
  margin_ft: number; closes_at: string | null; observed: string | null };
type Event = { time: string; kind: string; level: "ok" | "warn" | "bad"; text: string; report?: string };
type Review = { id: string; time: string; lat: number; lon: number; note: string; photo: string;
  ai: { water: boolean; depth_cm: [number, number] | null; reference: string | null; concerns: string | null } };
type Admin = {
  scenario: { mode: string; stage_ft: number; outlook_from: string | null; peak: { ft: number; at: string } | null };
  buildings: { top: Building[]; summary: { deep: number; at_walls: number; near: number; reached_in_outlook: number; housing_reached: number; mapped: number } };
  roads: { roads: Road[]; summary: { closed: number; closing: number } };
  feed: Event[]; review: Review[];
};

/** Closing levels this close to normal flow would flood every week: almost certainly a model edge, not a real closure. */
const SUSPECT_FT = 19;
const TOKEN_KEY = "admin-token";
const token = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };

let last: Admin | null = null, timer = 0, inflight = false;

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
      <span class="muted">${esc(x.use)} · walls at ${x.touch_ft} ft · ${ftTo(x.margin_ft)}${x.reached_at ? ` · <b class="warn">reached ${when(x.reached_at)}</b>` : ""}</span></span>
      <span class="tag ${x.status === "deep" ? "deep" : x.status === "at walls" ? "touch" : x.status === "near" ? "near" : "dry"}">${x.status === "deep" ? "≥ 30 cm" : x.status}</span></li>`).join("");

  const r = d.roads;
  $("adm-roads-sum").textContent = `${r.summary.closed} closed · ${r.summary.closing} closing${outlook ? ` (${outlook.startsWith("Ida") ? "Ida record" : "NWS forecast"})` : ""}`;
  $("adm-roads").innerHTML = r.roads.slice(0, 8).map((x) => `<li>
      <span><b>${esc(x.name)}</b><br><span class="muted">walking ${x.closes_walking_ft} ft${x.closes_vehicles_ft ? ` · cars ${x.closes_vehicles_ft} ft` : ""}${x.closes_at ? ` · <b class="warn">closes ${when(x.closes_at)}</b>` : x.status === "open" ? ` · ${ftTo(x.margin_ft)}` : ""}</span>
      ${x.observed ? `<br><span class="obs">observed: ${esc(x.observed)}</span>` : ""}
      ${x.closes_walking_ft < SUSPECT_FT && !x.observed ? `<br><span class="suspect" title="Closes near normal river level: the model is least reliable right next to the channel">near normal flow: unverified</span>` : ""}</span>
      <span class="tag ${x.status === "closed" ? "deep" : x.status === "closing" ? "touch" : "dry"}">${x.status}</span></li>`).join("");

  $("adm-feed").innerHTML = d.feed.length
    ? d.feed.map((e) => `<li class="${e.level}"><span class="mono muted">${when(e.time)}</span> ${esc(e.text)}</li>`).join("")
    : `<li class="muted">Nothing new.</li>`;

  const tokenRow = token() ? "" : `<div class="row gap"><input id="adm-token" type="password" placeholder="Admin token" aria-label="Admin token" /><button id="adm-token-save" class="btn small">Save</button></div>`;
  $("adm-review").innerHTML = (d.review.length
    ? d.review.map((x) => `<li data-id="${esc(x.id)}">
        <img src="${esc(x.photo)}" alt="Reported flooding photo" loading="lazy" />
        <div><span class="muted mono">${when(x.time)}</span><br>
        AI: ${x.ai.water ? `water${x.ai.depth_cm ? ` ${x.ai.depth_cm[0]}–${x.ai.depth_cm[1]} cm` : ""}` : "unclear"}${x.ai.reference ? ` (${esc(x.ai.reference)})` : ""}${x.ai.concerns ? `<br><span class="warn">${esc(x.ai.concerns)}</span>` : ""}
        ${x.note ? `<br>“${esc(x.note)}”` : ""}
        <div class="row gap"><button class="btn small" data-verdict="confirmed">Confirm</button><button class="btn small ghost" data-verdict="rejected">Reject</button><button class="link small" data-show>Show</button></div></div></li>`).join("")
    : `<li class="muted">No reports waiting.</li>`) + tokenRow;
  $("adm-review-n").textContent = d.review.length ? String(d.review.length) : "";
}

const feature: Feature = {
  id: "admin",
  init(app) {
    app.card({ col: "right", id: "adm-bldg-card", title: "Highest-risk buildings", order: 5, html: `<div class="small" id="adm-bldg-sum"></div><ul class="alist" id="adm-bldg"><li class="muted">Loading…</li></ul>` });
    app.card({ col: "right", id: "adm-roads-card", title: "Roads: closed and closing", order: 15, html: `<div class="small" id="adm-roads-sum"></div><ul class="alist" id="adm-roads"></ul>` });
    app.card({ col: "right", id: "adm-review-card", title: "Needs a decision", order: 25, extraTitle: ` <span class="count" id="adm-review-n"></span>`, html: `<ul class="alist review" id="adm-review"></ul>` });
    app.card({ col: "left", id: "adm-feed-card", title: "What changed", order: 5, html: `<ul class="feed" id="adm-feed"></ul>` });

    const fly = (lon: number, lat: number) => app.map.flyTo({ center: [lon, lat], zoom: 16.5, duration: 800 });
    $("adm-bldg").addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-lon]");
      if (li) fly(+li.dataset.lon!, +li.dataset.lat!);
    });
    $("adm-review").addEventListener("click", async (e) => {
      const t = e.target as HTMLElement, li = t.closest<HTMLElement>("li[data-id]");
      if (t.id === "adm-token-save") {
        try { sessionStorage.setItem(TOKEN_KEY, $<HTMLInputElement>("adm-token").value.trim()); } catch { /* storage blocked: re-enter next time */ }
        return render();
      }
      if (!li || !last) return;
      const item = last.review.find((x) => x.id === li.dataset.id)!;
      if (t.dataset.show != null) return fly(item.lon, item.lat);
      const verdict = t.dataset.verdict;
      if (!verdict) return;
      const r = await fetch(`/api/reports/${item.id}/review`, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": token() }, body: JSON.stringify({ verdict }) });
      if (r.status === 401) { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } return render(); }
      await load(app);
      app.refresh();   // routing and the map pick up the decision
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
