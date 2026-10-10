/**
 * Drills: the admin runs the What-if bar (Ida replay, a chosen level, the simulation) and every student screen follows it.
 * Admin view sends its scenario to /api/scenario; Student view has no controls, only a DRILL tag, and mirrors the stream.
 */
import type { App, Feature } from "../../core/app";
import { $, et } from "../../core/util";
import "./style.css";

type Scenario = { mode: "live" } | { mode: "ida"; t: string } | { mode: "whatif"; stage: number };
declare module "../../core/app" { interface Services { drill: { follow: () => void } } }

const token = () => { try { return sessionStorage.getItem("admin-token") ?? ""; } catch { return ""; } };   // same key as the admin feature
let latest: Scenario = { mode: "live" }, sentKey = "", pending = 0;

function current(app: App): Scenario {
  const river = app.get("river");
  if (app.state.mode === "ida") return { mode: "ida", t: river.ida.series[river.idaIndex()][0].slice(0, 13) };
  if (app.state.mode === "whatif") return { mode: "whatif", stage: +app.state.stageFt.toFixed(1) };
  return { mode: "live" };
}

/** No token yet: ask for it right here, instead of sending the admin to another panel. */
function askToken(app: App, why: string) {
  const note = $("drill-note");
  if (note.querySelector("input")) return;
  note.className = "drill-note warn";
  note.innerHTML = `${why} <input id="drill-token" type="password" placeholder="Admin token" aria-label="Admin token" /> <button id="drill-share" class="btn small">Share with students</button>`;
  const go = () => {
    try { sessionStorage.setItem("admin-token", $<HTMLInputElement>("drill-token").value.trim()); } catch { /* storage blocked */ }
    note.innerHTML = ""; sentKey = ""; share(app);
  };
  $("drill-share").onclick = go;
  $("drill-token").onkeydown = (e) => { if (e.key === "Enter") go(); };
}

/** Admin: send the scenario at most twice a second (the replay steps 4 times a second). */
function share(app: App) {
  const s = current(app), key = JSON.stringify(s);
  if (key === sentKey || pending) return;
  if (!token()) { if (s.mode !== "live") askToken(app, "Students don't see this yet:"); return; }
  pending = window.setTimeout(async () => {
    pending = 0;
    const now = current(app), nowKey = JSON.stringify(now);
    const r = await fetch("/api/scenario", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": token() }, body: JSON.stringify(now) }).catch(() => null);
    const ok = !!r?.ok;
    if (ok) sentKey = nowKey;
    if (r?.status === 401) {
      try { sessionStorage.removeItem("admin-token"); } catch { /* ignore */ }
      return askToken(app, "Wrong admin token:");
    }
    $("drill-note").textContent = ok ? (now.mode === "live" ? "" : "Students see this drill") : "Couldn't reach the server";
    $("drill-note").className = `drill-note ${ok ? "ok" : "warn"}`;
  }, 500);
}

/** Student: show whatever the admin is running. */
function follow(app: App) {
  const river = app.maybe("river");
  if (!river) return;
  const s = latest;
  if (s.mode === "ida") {
    const i = river.ida.series.findIndex((p) => p[0] >= s.t);
    river.setIdaIndex(i < 0 ? river.ida.series.length - 1 : i);
    if (app.state.mode !== "ida") river.setMode("ida");
  } else if (s.mode === "whatif") {
    river.setWhatIf(s.stage);
    if (app.state.mode !== "whatif") river.setMode("whatif");
  } else if (app.state.mode !== "live") river.setMode("live");
  const tag = $("drill-tag");
  tag.hidden = s.mode === "live";
  tag.textContent = s.mode === "ida" ? `DRILL · Ida 2021 · ${et(river.ida.series[river.idaIndex()][0])}` : s.mode === "whatif" ? `DRILL · ${s.stage} ft what-if` : "";
}

const feature: Feature = {
  id: "drill",
  init(app) {
    const tag = document.createElement("span");
    tag.id = "drill-tag";
    tag.className = "pill drill";
    tag.dataset.views = "student";
    tag.setAttribute("role", "status");   // a drill starting or ending is worth announcing
    tag.hidden = true;
    app.heroStatus(tag);
    $("whatif-bar").dataset.views = "admin";   // students have no scenario controls
    $("whatif-bar").insertAdjacentHTML("beforeend", `<span id="drill-note" class="drill-note"></span>`);
    app.provide("drill", { follow: () => follow(app) });

    const listen = () => {
      const es = new EventSource("/api/scenario/stream");
      es.onmessage = (e) => { latest = JSON.parse(e.data); if (app.state.view === "student") follow(app); };
      es.onerror = () => { es.close(); setTimeout(listen, 3000); };   // server restarting: reconnect
    };
    listen();
  },
  update(app) {
    if (app.state.view === "admin") share(app);
  },
};
export default feature;
