/**
 * Phone layout (≤ 1000 px): compact header with a status line, a full-screen map, a bottom panel with tabs,
 * and a fixed Student | Admin bar. Panels are the same cards as on desktop, moved into the bottom panel and
 * grouped by tab; on a wide screen everything goes back where it was.
 */
import type { App, Feature, View } from "../../core/app";
import { $ } from "../../core/util";
import "./style.css";

type Tab = { id: string; label: string; cards: string[] };
const TABS: Record<View, Tab[]> = {
  student: [
    { id: "route", label: "Route", cards: ["guide-card", "words-card", "voice-card"] },
    { id: "report", label: "Report", cards: ["report-card"] },
    { id: "emergency", label: "Emergency", cards: ["contacts-card"] },
  ],
  admin: [
    { id: "overview", label: "Overview", cards: ["adm-feed-card", "adm-review-card", "adm-disp-card", "wf-card", "impact-card", "gauge-card", "alerts-card", "nwm-card", "cams-card", "sensors-card", "air-card"] },
    { id: "roads", label: "Roads", cards: ["adm-roads-card"] },
    { id: "buildings", label: "Buildings", cards: ["adm-bldg-card"] },
  ],
};
const ICON: Record<View, string> = {
  student: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/></svg>`,
};
type State = "peek" | "half" | "full";

const phone = matchMedia("(max-width: 1000px)");
let tab: Record<View, string> = { student: "route", admin: "overview" };
let state: State = "peek", hasDetails = false;

const feature: Feature = {
  id: "mobile",
  init(app) {
    document.body.insertAdjacentHTML("beforeend", `
      <section class="sheet" id="sheet" data-state="peek" aria-label="Details panel">
        <button class="sheet-handle" id="sheet-handle" aria-label="Expand panel" aria-expanded="false"><i></i></button>
        <div class="sheet-tabs" id="sheet-tabs" role="tablist"></div>
        <div class="sheet-body" id="sheet-body">
          <section class="card" id="details-card" hidden><h2>Details <button class="link small" id="details-close">Close</button></h2><div id="details-body"></div></section>
        </div>
      </section>
      <nav class="bottom-nav" id="bottom-nav" aria-label="View">
        ${(["student", "admin"] as View[]).map((v) => `<button data-view="${v}">${ICON[v]}<span>${v === "student" ? "Student" : "Admin"}</span></button>`).join("")}
      </nav>`);
    $("bottom-nav").querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => app.setView(b.dataset.view as View)));
    $("sheet-handle").onclick = () => setState(app, state === "peek" ? "half" : state === "half" ? "full" : "peek");
    $("details-close").onclick = () => { hasDetails = false; $("details-card").hidden = true; tab[app.state.view] = TABS[app.state.view][0].id; render(app); };

    // Map taps (a road, a building, a sensor) open in the panel instead of a popup over the map.
    const popup = app.popup.bind(app);
    app.popup = (pt, html) => {
      if (!phone.matches) return popup(pt, html);
      $("details-body").innerHTML = html;
      $("details-card").hidden = false;
      hasDetails = true;
      tab[app.state.view] = "details";
      if (state === "peek") state = "half";
      render(app);
      $("details-card").scrollIntoView({ block: "start" });
    };
    phone.addEventListener("change", () => layout(app));
  },
  ready(app) {
    // the "Route me to safety" button also opens the Route tab
    document.querySelector<HTMLButtonElement>(".go-fab")?.addEventListener("click", () => { tab.student = "route"; setState(app, "half"); });
    layout(app);
  },
  update(app) {
    if (phone.matches && document.body.dataset.mtab !== `${app.state.view}:${tab[app.state.view]}`) render(app);
  },
};

/** Move the columns into the panel on a phone, back beside the map on a wide screen. */
function layout(app: App) {
  const left = $("col-left"), right = $("col-right"), map = $("mapwrap");
  document.body.classList.toggle("m", phone.matches);
  if (phone.matches) { $("sheet-body").append(left, right); render(app); }
  else { map.before(left); map.after(right); }
  app.map?.resize();
}

function setState(app: App, s: State) { state = s; render(app); }

function render(app: App) {
  if (!phone.matches) return;
  const v = app.state.view, tabs = [...TABS[v], ...(hasDetails ? [{ id: "details", label: "Details", cards: ["details-card"] }] : [])];
  if (!tabs.some((t) => t.id === tab[v])) tab[v] = tabs[0].id;
  const current = tabs.find((t) => t.id === tab[v])!;
  document.body.dataset.mtab = `${v}:${current.id}`;
  $("sheet-tabs").innerHTML = tabs.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === current.id}">${t.label}</button>`).join("");
  $("sheet-tabs").querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => {
    const same = b.dataset.tab === tab[v];
    tab[v] = b.dataset.tab!;
    state = same && state !== "peek" ? "peek" : state === "peek" ? "half" : state;   // tap the open tab again to fold the panel
    render(app);
  }));
  // only this tab's cards; the rest stay in the page (features keep updating them) but are hidden
  document.querySelectorAll<HTMLElement>("#sheet-body .card").forEach((c) => c.classList.toggle("tab-off", !current.cards.includes(c.id)));
  $("sheet").dataset.state = state;
  document.body.dataset.sheet = state;
  $("sheet-handle").setAttribute("aria-expanded", String(state !== "peek"));
  $("sheet-handle").setAttribute("aria-label", state === "full" ? "Collapse panel" : "Expand panel");
  $("bottom-nav").querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    const on = b.dataset.view === v;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}

export default feature;
