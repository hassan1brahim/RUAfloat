/** "Get me to safety": start point, nearest dry gathering point, walking route, spoken script (AI + guard), contacts. */
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import type { App, Feature, Pt } from "../../core/app";
import { $, esc, fmtFt, getJson, postJson } from "../../core/util";
import { announce } from "../../lib/speech";
import { DRY_MARGIN_DM, type Place, type Plan } from "../../lib/route";
import { onSpeak, speak, stopSpeaking } from "../../lib/speech";
import { NO_OBSERVATIONS } from "../roads";
import "./style.css";

/** Replays use this start when the user is off campus, so the demo works from anywhere. */
const DEMO_START = "Scott Hall";
/** Destinations further than this are not offered, unless nothing dry is closer. */
const MAX_WALK_MIN = 20;

export type Start = { name: string; lon: number; lat: number };
export type Guide = {
  places: Place[]; starts: Start[];
  start: () => Start | null; setStart: (s: Start) => void;
  plan: () => Plan | null; run: (silent?: boolean) => Promise<{ script: string; plan: Plan | null }>;
  /** Location didn't work: highlight the place chooser with a message and move focus to it. */
  askForPlace: (message: string) => void;
};
declare module "../../core/app" { interface Services { guide: Guide } }

type Res = { script: string; by: string; check: string[]; rejected?: string; fixes?: string[] };
/** A gathering point the student chose instead of the nearest one; null = nearest. */
let chosen: Place | null = null, destShown = "";
let places: Place[] = [], starts: Start[] = [], start: Start | null = null, plan: Plan | null = null, lastScript = "", stepIdx = 0, stepsMode = "", showAll = false;
/** Read aloud toggle: while on, each step is read once when it is shown; nothing advances on its own. */
let readOn = false, lastRead = "";
const KINDS = [["gather", "Help meetup spots", "#22c55e"], ["hospital", "Hospitals", "#f472b6"], ["police", "Police", "#60a5fa"], ["fire", "Fire stations", "#fb923c"]] as const;
let marker: maplibregl.Marker | null = null;

function placesGeoJSON(rise: number) {
  return { type: "FeatureCollection" as const, features: places.map((p) => ({ type: "Feature" as const,
    properties: { name: p.name, kind: p.kind, capacity: p.capacity, wet: p.block <= rise + (p.kind === "gather" ? DRY_MARGIN_DM : 0) },
    geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } })) };
}

const feature: Feature = {
  id: "guide",
  clickPriority: 10,
  async init(app) {
    [places, starts] = await Promise.all([getJson<Place[]>("/data/places.json"), getJson<Start[]>("/data/starts.json")]);
    starts = [...starts, ...places.filter((p) => p.kind === "gather")].sort((a, b) => a.name.localeCompare(b.name));
    const m = app.map;
    m.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#22d3ee", "line-width": 12, "line-opacity": 0.25, "line-blur": 4 } });
    m.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#67e8f9", "line-width": 4 } });
    m.addSource("places", { type: "geojson", data: placesGeoJSON(0) });
    m.addLayer({ id: "places", type: "circle", source: "places", paint: {
      "circle-radius": ["match", ["get", "kind"], "gather", 7, 5],
      "circle-color": ["case", ["get", "wet"], "#ef4444", ["match", ["get", "kind"], "gather", "#22c55e", "hospital", "#f472b6", "police", "#60a5fa", "#fb923c"]],
      "circle-stroke-color": "#081018", "circle-stroke-width": 2 } });
    m.addLayer({ id: "places-label", type: "symbol", source: "places", filter: ["==", ["get", "kind"], "gather"],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#cfe8d6", "text-halo-color": "#081018", "text-halo-width": 1.5 } });
    m.on("mouseenter", "places", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "places", () => (m.getCanvas().style.cursor = ""));
    const shown = new Set<string>(KINDS.map((k) => k[0]));
    for (const [kind, label, color] of KINDS) {
      app.check(`<i class="dot" style="background:${color}"></i>${label}`, true, (on) => {
        if (on) shown.add(kind); else shown.delete(kind);
        m.setFilter("places", ["in", ["get", "kind"], ["literal", [...shown]]]);
        m.setLayoutProperty("places-label", "visibility", shown.has("gather") ? "visible" : "none");
      }, "Facilities", { key: kind });
    }
    app.legend(`<div><i class="dot" style="background:#22c55e"></i>Help meetup spot</div>`, { key: "gather" });
    app.legend(`<div><i class="dot" style="background:#f472b6"></i>Hospital</div>`, { key: "hospital" });
    app.legend(`<div><i class="dot" style="background:#60a5fa"></i>Police</div>`, { key: "police" });
    app.legend(`<div><i class="dot" style="background:#fb923c"></i>Fire station</div>`, { key: "fire" });
    app.setDefaultHint("Click a road for its status · 📍 Pick on map to set your location");

    // One box: where you are (or your location), then Route from this place.
    app.card({ student: "left", studentOrder: 1, id: "guide-card", title: "Get me to safety", order: 20, html: `
      <div id="start-box" class="start-box">
      <div id="start-msg" class="start-msg" role="status" hidden></div>
      <label class="start-label" for="start-select">You are currently at:</label>
      <select id="start-select"><option value="">Choose a place, or pick on the map…</option></select>
      <label class="small muted" for="place-q" style="display:block;margin-top:8px">Or search any building</label>
      <div class="row"><input id="place-q" type="search" placeholder="e.g. LSM, Hill Center, Scott Hall" autocomplete="off" /></div>
      <div id="place-n" class="sr-only" role="status"></div>
      <ul id="place-results" class="place-results" aria-label="Search results"></ul>
      <div class="row gap"><button id="btn-gps" class="btn ghost small"><span aria-hidden="true">◎</span> Use my GPS</button><button id="btn-pick" class="btn ghost small"><span aria-hidden="true">📍</span> Pick on map</button></div>
      <div class="row gap"><button id="btn-guide" class="btn primary"><span aria-hidden="true">🔊</span> Route from this place</button></div>
      <p class="safety-note">If location is on and no place is chosen, it will route you immediately to the nearest safe spot.</p>
      </div>
      <div id="guide-out" class="guide-out" hidden>
        <div class="dest" id="g-dest" tabindex="-1"></div>
        <div class="row gap small"><button id="btn-replay" class="read-toggle" role="switch" aria-checked="false"><span><span aria-hidden="true">🔊</span> Read aloud</span><span class="rt-track" aria-hidden="true"><span class="rt-knob"></span></span><span class="rt-state" aria-hidden="true">OFF</span></button></div>
        <!-- spoken script, voice and AI-guard details: kept for debugging and a possible Admin view, not shown to students -->
        <blockquote id="g-script" hidden></blockquote><span id="g-voice" hidden></span><div class="badge-row" id="g-by" hidden></div>
        <ol class="steps" id="g-steps"></ol>
        <div class="onestep" id="g-onestep" hidden>
          <div class="row"><span class="mono small muted" id="g-steplbl"></span></div>
          <div class="steptext" id="g-steptext" aria-live="polite"></div>
          <div class="row gap"><button id="g-prev" class="btn ghost small">Back</button><button id="g-next" class="btn small">Next direction</button></div>
        </div>
        <button id="g-all" class="link small" hidden>Show all steps</button>
        <h3 class="dest-h" id="dest-h">Options to go</h3>
        <ul id="dest-list" class="dest-list" aria-labelledby="dest-h"></ul>
        <div id="g-replan" class="replan" hidden>Route re-planned (river level or route options changed). <button id="btn-respeak" class="link">Hear the new route</button></div>
      </div>` });
    app.card({ student: "left", studentOrder: 6, id: "contacts-card", title: "Contact emergency", order: 70, html: `
      <ul class="contacts">
        <li><b>Emergency</b><a href="tel:911">911</a></li>
        <li><b>Rutgers Police (New Brunswick)</b><a href="tel:7329327111">(732) 932-7111</a></li>
        <li data-views="admin"><b>NJ Office of Emergency Mgmt</b><a href="https://ready.nj.gov/" target="_blank" rel="noopener">ready.nj.gov</a></li>
        <li data-views="admin"><b>NJ road closures</b><a href="https://www.511nj.org/" target="_blank" rel="noopener">511nj.org</a></li>
      </ul>` });
    $("impact-stats")?.insertAdjacentHTML("beforeend", `<div><b id="s-gather" class="mono">--</b><span>gathering pts dry</span></div>`);

    const sel = $<HTMLSelectElement>("start-select");
    for (const s of starts) sel.add(new Option(s.name, JSON.stringify(s)));
    sel.onchange = () => sel.value && setStart(JSON.parse(sel.value));
    $("btn-guide").onclick = () => void (start ? run() : locateAndRun());
    $("btn-pick").onclick = () => app.pick("Click the map where you are", (pt: Pt) => setStart({ name: "Pinned location", ...pt }));
    $("btn-replay").onclick = () => {
      readOn = !readOn;
      const b = $("btn-replay");
      b.setAttribute("aria-checked", String(readOn));
      b.classList.toggle("on", readOn);
      b.querySelector(".rt-state")!.textContent = readOn ? "ON" : "OFF";
      if (readOn) { lastRead = ""; readCurrent(); } else stopSpeaking();
    };
    $("btn-respeak").onclick = () => void run();
    $("g-prev").onclick = () => showStep(stepIdx - 1);
    $("g-next").onclick = () => showStep(stepIdx + 1);
    $("g-all").onclick = () => { showAll = !showAll; renderSteps(); };

    // Search: the same 324-building index the voice agent uses. Results are plain buttons a screen reader can read.
    const q = $<HTMLInputElement>("place-q"), results = $("place-results");
    let qTimer = 0;
    q.oninput = () => {
      clearTimeout(qTimer);
      const text = q.value.trim();
      if (text.length < 2) { results.innerHTML = ""; $("place-n").textContent = ""; return; }
      qTimer = window.setTimeout(async () => {
        let r: { matches?: { name: string; lon: number; lat: number; campus: string | null }[]; note?: string; error?: string };
        try { r = await getJson(`/api/places/search?q=${encodeURIComponent(text)}`); } catch { r = { error: "search unavailable" }; }
        const m = (r.matches ?? []).filter((x) => app.get("grid").cellAt(x.lon, x.lat) >= 0);
        results.innerHTML = m.map((x, i) => `<li><button class="btn ghost small" data-i="${i}">${esc(x.name)}${x.campus ? `<span class="muted">, ${esc(x.campus)}</span>` : ""}</button></li>`).join("");
        results.onclick = (e) => {
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-i]");
          if (!b) return;
          const x = m[+b.dataset.i!];
          setStart({ name: x.name, lon: x.lon, lat: x.lat });
          results.innerHTML = ""; q.value = "";
          announce(`Starting point: ${x.name}. Press Route from this place.`);
          $("btn-guide").focus();
        };
        $("place-n").textContent = r.error ? "Search unavailable." : m.length ? `${m.length} result${m.length > 1 ? "s" : ""}${r.note ? `. ${r.note}` : ""}` : "No matches in the area this app covers.";
      }, 300);
    };

    // Options to go: dry gathering points within a 20-minute walk, nearest first. The button text carries the place information.
    $("dest-list").onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-dest]");
      if (!b) return;
      chosen = b.dataset.dest === "" ? null : places.find((p) => p.name === b.dataset.dest) ?? null;
      void run();
    };

    // Sets where you are from GPS without routing yet (Route me to safety above does both in one tap).
    $("btn-gps").onclick = () => {
      if (!navigator.geolocation) return askForPlace("This browser can't share its location. Choose where you are:");
      app.hint("Finding your location…");
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (app.get("grid").cellAt(p.coords.longitude, p.coords.latitude) < 0) return askForPlace("You're outside the area RU Ready covers. Choose where you are on campus:");
          setStart({ name: "Your location", lon: p.coords.longitude, lat: p.coords.latitude });
          // Laptops have no GPS and guess from Wi-Fi: say how far off it may be, so a wrong guess is obvious.
          app.hint(`From: Your location (accurate to about ${Math.round(p.coords.accuracy)} m) · wrong? Pick on map`);
        },
        () => askForPlace("Couldn't get your location. Choose where you are:"),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    };

    /**
     * No place chosen: use the phone's location, plan the walk and read it aloud, in one press.
     * Replays (Ida, what-if) start from Scott Hall when the user is off campus, so the demo works from anywhere.
     */
    async function locateAndRun() {
      const btn = $<HTMLButtonElement>("btn-guide");
      btn.disabled = true; btn.textContent = "Finding your location…";
      announce("Finding your location.");
      const pos = await new Promise<GeolocationPosition | null>((res) => {
        if (!navigator.geolocation) return res(null);
        navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      });
      btn.disabled = false; btn.innerHTML = `<span aria-hidden="true">🔊</span> Route from this place`;
      if (pos && app.get("grid").cellAt(pos.coords.longitude, pos.coords.latitude) >= 0) {
        setStart({ name: "Your location", lon: pos.coords.longitude, lat: pos.coords.latitude });
      } else if (app.state.mode !== "live") {
        const demo = starts.find((s) => s.name === DEMO_START);
        if (!demo) return;
        setStart(demo);
        await speak(`${pos ? "You are not on campus" : "I could not get your location"}, so for this replay I will start from ${DEMO_START}.`);
      } else {
        void speak(pos
          ? "You are outside the area RU Ready covers, which is Rutgers New Brunswick. Choose a place on campus. If you are in danger, call 9 1 1."
          : "I could not get your location. Choose the building you are in, then press Route from this place. If you are in danger, call 9 1 1.");
        return askForPlace(pos ? "You're outside the area RU Ready covers. Choose where you are on campus:" : "Couldn't get your location. Choose where you are:");
      }
      await run();
    }

    function askForPlace(message: string) {
      $("start-msg").textContent = message;
      $("start-msg").hidden = false;
      $("start-box").classList.add("need");
      $("start-box").scrollIntoView({ behavior: "smooth", block: "nearest" });
      sel.focus({ preventScroll: true });
    }

    function setStart(s: Start) {
      $("start-msg").hidden = true;
      $("start-box").classList.remove("need");
      chosen = null;   // a new start: back to the nearest dry point
      // A new starting point makes the old route wrong: clear it so nothing (screen, voice agent, Map in words) reads it.
      if (start && plan && (start.lon !== s.lon || start.lat !== s.lat)) {
        plan = null;
        (app.map.getSource("route") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
        $("g-steps").innerHTML = "";
        $("guide-out").hidden = true;
      }
      start = s;
      app.hint(`From: ${s.name} · click a road for its status`);
      // Places not in the list (your location, a pinned point, a building found by voice) get their own entry,
      // so the dropdown never claims nothing is chosen.
      let idx = [...sel.options].findIndex((o) => o.text === s.name);
      if (idx < 0) {
        [...sel.options].filter((o) => o.dataset.extra).forEach((o) => o.remove());
        const o = new Option(s.name, JSON.stringify(s));
        o.dataset.extra = "1";
        sel.add(o, 1);
        idx = 1;
      }
      sel.selectedIndex = idx;
      marker?.remove();
      const el = document.createElement("div");
      el.style.cssText = "width:16px;height:16px;border-radius:50%;background:#fff;border:4px solid #cc0033;box-shadow:0 0 0 6px rgba(204,0,51,.25)";
      marker = new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(app.map);
    }

    function showPlan(p: Plan | null) {
      plan = p;
      (app.map.getSource("route") as GeoJSONSource).setData(p ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: p.coords } } : { type: "FeatureCollection", features: [] });
      $("g-steps").innerHTML = p ? p.steps.map((s) => `<li>${s.say}</li>`).join("") : "";
      stepIdx = 0;
      renderSteps();
      $("g-dest").innerHTML = p?.here
        ? `You're at a help meetup spot: ${esc(p.dest.name)}<small>It stays dry at this river level · gathering point, not an official shelter</small>`
        : p
        ? `→ ${p.dest.name}<small>${(p.meters / 1000).toFixed(2)} km · ~${Math.round(p.minutes)} min walk · ${p.dest.campus ?? ""}${p.dest.capacity ? ` · ~${p.dest.capacity.toLocaleString()} people (est.)` : ""} · gathering point, not an official shelter</small>`
        : "No dry gathering point reachable on foot";
    }
    showPlanRef = showPlan;

    /** Student option: one instruction at a time instead of the full list. */
    function renderSteps() {
      // Student view: one direction at a time by default (Back / Next); the full list is one click away.
      const student = app.state.view === "student", one = student && !showAll && !!plan;
      stepsMode = `${showAll}|${app.state.view}`;
      $("g-steps").hidden = one;
      $("g-onestep").hidden = !one;
      $("g-all").hidden = !student || !plan;
      $("g-all").textContent = showAll ? "Show one step at a time" : "Show all steps";
      if (one) showStep(stepIdx);
    }
    function showStep(i: number) {
      if (!plan) return;
      stepIdx = Math.max(0, Math.min(plan.steps.length - 1, i));
      $("g-steplbl").textContent = `STEP ${stepIdx + 1} OF ${plan.steps.length}`;
      $("g-steptext").textContent = plan.steps[stepIdx].say;
      readCurrent();
    }
    /** With Read aloud on: say the step on screen once (or the one message when there is no walk). */
    function readCurrent() {
      if (!readOn) return;
      const text = plan ? (plan.here ? plan.steps[0].say : `Step ${stepIdx + 1} of ${plan.steps.length}. ${plan.steps[stepIdx].say}`) : lastScript;
      const key = `${plan?.dest.name ?? "none"}|${stepIdx}|${text}`;
      if (!text || key === lastRead) return;
      lastRead = key;
      void speak(text);
    }
    renderStepsRef = renderSteps;

    async function run(silent = false): Promise<{ script: string; plan: Plan | null }> {
      if (!start) { app.hint("First: pick where you are"); return { script: "", plan: null }; }
      const btn = $<HTMLButtonElement>("btn-guide");
      btn.disabled = true; btn.textContent = "Planning…";
      $("guide-out").hidden = false; $("g-replan").hidden = true;
      const rise = app.rise(), s = start, obs = app.maybe("observations")?.() ?? NO_OBSERVATIONS;
      const p = app.get("grid").depthAt(s.lon, s.lat, rise) >= 3 ? null : app.get("router").plan(s.lon, s.lat, rise, targets(rise), obs.closed);
      showPlan(p);
      if (p) renderDestinations(app);
      // Screen-reader users land on the result instead of staying on the button with no idea where it appeared.
      $("g-dest").focus();
      if (p) {
        const b = new maplibregl.LngLatBounds();
        p.coords.forEach((c) => b.extend(c));
        app.map.fitBounds(b, { padding: 90, maxZoom: 16, duration: 900 });
      }
      const scenario = app.state.mode === "live" ? "live river reading" : app.state.mode === "ida" ? "Hurricane Ida 2021 replay" : `what-if, ${fmtFt(app.state.stageFt)} at Bound Brook`;
      const payload = p
        ? { start: s.name, dest: p.dest.name, meters: p.meters, minutes: p.minutes, steps: p.steps, avoid: p.avoid, scenario }
        : { start: s.name === "Pinned location" ? "your location" : s.name, shelter_in_place: true, steps: [], avoid: [], scenario };
      let res: Res;
      // Already at a dry meetup spot: fixed advice to stay, no route for the AI to describe.
      if (p?.here) res = { script: `You're at ${p.dest.name}, a help meetup spot that stays dry at this river level. Stay here and follow RU Alert. If you are in danger, call 9 1 1.`, by: "fixed", check: [] };
      else try { res = await postJson<Res>("/api/guide", payload); }
      catch { res = { script: p ? `Walk to ${p.dest.name}, about ${Math.round(p.minutes)} minutes. If you are in danger, call 9 1 1.` : "Move to the highest floor you can reach and call 9 1 1.", by: "offline", check: ["API offline"] }; }
      const q = $("g-script");
      q.textContent = res.script;
      q.className = p ? "" : "danger";
      $("g-by").innerHTML = [
        `<span class="badge">script: ${esc(res.by)}</span>`,
        !p ? `<span class="badge ok">fixed shelter-in-place script</span>` : res.check.length ? `<span class="badge warn" title="${res.rejected ? "Rejected: " + esc(res.rejected) : ""}">guard: ${esc(res.check.join("; "))}</span>` : `<span class="badge ok">guard: every name is on the route</span>`,
        ...(res.fixes ?? []).map((f) => `<span class="badge">${esc(f)}</span>`),
        `<span class="badge">${scenario}</span>`,
      ].join("");
      lastScript = res.script;
      if (!p) readCurrent();   // shelter in place: the fixed message is the only thing to read
      btn.disabled = false; btn.innerHTML = `<span aria-hidden="true">🔊</span> Route from this place`;
      // Nothing is spoken automatically: the student presses Read aloud. (`silent` stays for callers like the voice agent.)
      return { script: res.script, plan: p };
    }

    // phones: the guide card scrolls away under the map, so keep a thumb-reach shortcut to it
    const fab = document.createElement("button");
    fab.className = "btn primary go-fab";
    fab.innerHTML = `<span aria-hidden="true">🆘</span> Route me to safety`;
    fab.onclick = () => { $("guide-card").scrollIntoView({ behavior: "smooth", block: "start" }); $("btn-guide").click(); };
    document.body.append(fab);
    new IntersectionObserver(([e]) => (fab.hidden = e.isIntersecting), { threshold: 0.2 }).observe($("guide-card"));

    onSpeak((_, voice) => { const el = document.getElementById("g-voice"); if (el) el.textContent = `Voice: ${voice}`; });
    app.provide("guide", { places, starts, start: () => start, setStart, plan: () => plan, run, askForPlace });
  },
  update(app) {
    const rise = app.rise();
    (app.map.getSource("places") as GeoJSONSource).setData(placesGeoJSON(rise));
    const gathers = places.filter((p) => p.kind === "gather");
    $("s-gather").textContent = `${gathers.filter((p) => p.block > rise + DRY_MARGIN_DM).length}/${gathers.length}`;
    if (plan && start) {
      const obs = app.maybe("observations")?.() ?? NO_OBSERVATIONS;
      const next = app.get("router").plan(start.lon, start.lat, rise, targets(rise), obs.closed);
      const changed = !next || next.dest.name !== plan.dest.name || Math.abs(next.meters - plan.meters) > 25;
      if (changed) { showPlanRef(next); $("g-replan").hidden = false; }
    }
    if (stepsMode !== `${showAll}|${app.state.view}`) renderStepsRef();
    if (plan && start) renderDestinations(app);
  },
  click(app, pt, ev) {
    const f = app.map.queryRenderedFeatures(ev.point, { layers: ["places"] })[0];
    if (!f) return false;
    const p = f.properties as { name: string; kind: string; wet: boolean; capacity?: number };
    app.popup(pt, `<b>${p.name}</b><br>${p.kind}${p.capacity ? ` · ~${p.capacity.toLocaleString()} people (est. from floor area)` : ""}${p.wet ? " · <span style=color:#f87171>flood risk now</span>" : ""}`);
    return true;
  },
  facts(app) {
    const rise = app.rise();
    return {
      gathering_points_dry: places.filter((p) => p.kind === "gather" && p.block > rise + DRY_MARGIN_DM).map((p) => p.name),
      you_are_at: start?.name ?? null,
      route: plan ? { to: plan.dest.name, minutes: Math.round(plan.minutes), steps: plan.steps.map((x) => x.say) } : null,
      emergency_numbers: { emergency: "911", rutgers_police: "732-932-7111" },
    };
  },
};
let showPlanRef: (p: Plan | null) => void = () => {};

/** The chosen gathering point while it stays dry; otherwise every place, so the planner picks the nearest. */
function targets(rise: number): Place[] {
  if (chosen && chosen.block <= rise + DRY_MARGIN_DM) chosen = null;   // it flooded: fall back to the nearest
  return chosen ? [chosen] : places;
}

/** One button per dry gathering point; its text is everything a screen reader user needs to choose. */
function renderDestinations(app: App) {
  const obs = app.maybe("observations")?.() ?? NO_OBSERVATIONS;
  const reach = app.get("router").reachable(start!.lon, start!.lat, app.rise(), places, obs.closed);
  // Only walks of 20 minutes or less; if nothing dry is that close, just the nearest one.
  const near = reach.filter((x) => x.minutes <= MAX_WALK_MIN);
  const all = near.length ? near : reach.slice(0, 1);
  const html = all.slice(0, 6).map(({ place: p, meters, minutes }, i) => {
    const on = plan?.dest.name === p.name;
    return `<li><button class="dest-btn${on ? " on" : ""}" data-dest="${i === 0 ? "" : esc(p.name)}" aria-pressed="${on}">
      <b>${esc(p.name)}</b><span>${Math.max(1, Math.round(minutes))} minute walk · ${(meters / 1000).toFixed(1)} km · predicted to stay dry${p.capacity ? ` · room for about ${p.capacity.toLocaleString()} people` : ""}${p.campus ? ` · ${esc(p.campus)}` : ""}${i === 0 ? (minutes > MAX_WALK_MIN ? " · nearest, a long walk" : " · nearest") : ""}</span></button></li>`;
  }).join("") || `<li class="muted">No dry gathering point reachable on foot.</li>`;
  if (html !== destShown) $("dest-list").innerHTML = destShown = html;   // untouched unless it changed, so VoiceOver doesn't lose its place
}
let renderStepsRef: () => void = () => {};
export default feature;
