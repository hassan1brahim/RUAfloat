/**
 * Screen-reader support for blind and low-vision users (VoiceOver, TalkBack, NVDA, JAWS):
 * - "Map in words": everything the map shows, as text, first in the reading order.
 * - Screen-reader mode lives in the student Accessibility panel; speech.ts does the hand-off.
 * - Skip links, a page heading, and every panel exposed as a named region, so users can jump instead of swiping.
 */
import type { App, Feature } from "../../core/app";
import { $, esc } from "../../core/util";
import { announce, speak } from "../../lib/speech";
import "./style.css";

const list = (xs: string[], none: string) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>${none}</p>`);

type Facts = {
  scenario?: string; river_level_ft?: number; flood_category?: string; flood_stage_ft?: number; nws_alerts?: string[];
  roads_closed_to_walking?: string[]; roads_closed_by_observation?: string[]; gathering_points_dry?: string[];
  you_are_at?: string | null; route?: { to: string; minutes: number; steps: string[] } | null;
};

function summary(f: Facts) {
  const level = `${f.river_level_ft} feet`, cat = f.flood_category === "normal" ? "no flooding" : f.flood_category === "action" ? "action stage, just below flooding" : `${f.flood_category} flooding`;
  const roads = [...new Set([...(f.roads_closed_by_observation ?? []), ...(f.roads_closed_to_walking ?? [])])];
  return { level, cat, roads, alerts: f.nws_alerts ?? [], dry: f.gathering_points_dry ?? [], route: f.route ?? null };
}

/** One short paragraph for "Read this aloud". */
function spoken(f: Facts) {
  const s = summary(f);
  const parts = [`${f.scenario === "live" ? "Right now" : `In the ${f.scenario}`}, the Raritan River is at ${s.level}: ${s.cat}.`];
  parts.push(s.roads.length ? `Roads closed to walking: ${s.roads.slice(0, 5).join(", ")}${s.roads.length > 5 ? `, and ${s.roads.length - 5} more` : ""}.` : "No roads are closed to walking.");
  if (s.alerts.length) parts.push(`Weather alerts: ${s.alerts.join(", ")}.`);
  parts.push(s.route ? `Your route: walk to ${s.route.to}, about ${s.route.minutes} minutes.` : "To get directions, choose where you are under Where do I go.");
  return parts.join(" ");
}

function render(app: App) {
  const f = app.facts() as Facts, s = summary(f);
  $("words-body").innerHTML = `
    <h3>River</h3><p>${esc(f.scenario === "live" ? "Live" : f.scenario)}: Raritan River at ${esc(s.level)}, <b>${esc(s.cat)}</b>. Flooding starts at ${esc(f.flood_stage_ft ?? 28)} feet.</p>
    <h3>Roads closed to walking${s.roads.length >= 8 ? " (main roads)" : ` (${s.roads.length})`}</h3>${list(s.roads, "None.")}
    <h3>Weather alerts (${s.alerts.length})</h3>${list(s.alerts, "None.")}
    <h3>Dry gathering points (${s.dry.length})</h3>${list(s.dry, "None reachable. Move to the highest floor you can and call 911.")}
    <h3>Your route</h3>${s.route
      ? `<p>To <b>${esc(s.route.to)}</b>, about ${esc(s.route.minutes)} minutes on foot.</p><ol>${s.route.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`
      : `<p>No route yet. <a href="#guide-card">Choose where you are</a>, then press Guide me.</p>`}`;
}

const DEMO_START = "Scott Hall";

/**
 * One action from opening the page to hearing a route: get the location, plan the walk, read it aloud.
 * Replays (Ida, what-if) start from Scott Hall when the user is off campus, so the demo works from anywhere.
 */
async function getMeToSafety(app: App, btn: HTMLButtonElement) {
  const guide = app.maybe("guide"), grid = app.maybe("grid");
  if (!guide || !grid) return;
  const say = (t: string) => void speak(t);
  const label = $("btn-safety-label");
  btn.disabled = true;
  label.textContent = "Finding your location…";
  announce("Finding your location.");
  const pos = await new Promise<GeolocationPosition | null>((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
  btn.disabled = false;
  label.textContent = "Get me to safety";

  const onCampus = pos && grid.cellAt(pos.coords.longitude, pos.coords.latitude) >= 0;
  if (onCampus) {
    guide.setStart({ name: "Your location", lon: pos!.coords.longitude, lat: pos!.coords.latitude });
  } else if (app.state.mode !== "live") {
    const demo = guide.starts.find((s) => s.name === DEMO_START);
    if (!demo) return;
    guide.setStart(demo);
    await speak(`${pos ? "You are not on campus" : "I could not get your location"}, so for this replay I will start from ${DEMO_START}.`);
  } else {
    say(pos
      ? "You are outside the area RU Ready covers, which is Rutgers New Brunswick. If you are in danger, call 9 1 1."
      : "I could not get your location. Choose the building you are in under Where do I go, then press Guide me. If you are in danger, call 9 1 1.");
    if (!pos) $("start-select").focus();
    return;
  }
  await guide.run();   // plans the route, reads it aloud and moves focus to the result
}

const feature: Feature = {
  id: "a11y",
  init(app) {
    // The first control on the page, and the first thing a screen reader reaches after the title.
    const safe = document.createElement("button");
    safe.id = "btn-safety";
    safe.className = "btn safety-btn";
    safe.dataset.views = "student";   // admins act on the dashboard, not a route
    safe.setAttribute("aria-describedby", "btn-safety-help");
    safe.innerHTML = `<span aria-hidden="true">🆘</span> <span id="btn-safety-label">Get me to safety</span>
      <span id="btn-safety-help" class="sr-only">Uses your location, finds the nearest dry building and reads the walking route aloud.</span>`;
    safe.onclick = () => void getMeToSafety(app, safe);
    document.querySelector("header.top")!.prepend(safe);

    // Skip links that appear on keyboard focus (the header already has the page's h1).
    // Skip links come right after the safety button in the reading order.
    document.querySelector("header.top")!.insertAdjacentHTML("afterend", `
      <nav class="skip-links" aria-label="Skip links" data-views="student">
        <a class="skip" href="#words-card">Skip to the map in words</a>
        <a class="skip" href="#guide-card">Skip to Where do I go?</a>
      </nav>`);

    app.card({ student: "left", studentOrder: 2, id: "words-card", title: "Map in words", order: 5, html: `
      <button id="words-read" class="btn">🔊 Read this aloud</button>
      <div id="words-body" class="words-body"></div>` });

    $("words-read").onclick = () => void speak(spoken(app.facts() as Facts));

    // The route is planned outside the update loop: refresh when its steps change.
    const steps = document.getElementById("g-steps");
    if (steps) new MutationObserver(() => render(app)).observe(steps, { childList: true });
  },
  ready(app) {
    // The voice assistant's own skip link joins the others, after the safety button.
    const voiceSkip = document.getElementById("skip-voice");
    if (voiceSkip) document.querySelector(".skip-links")?.append(voiceSkip);
    // Every panel becomes a named region, so screen readers can list and jump between them.
    document.querySelectorAll<HTMLElement>("section.card").forEach((card) => {
      const h = card.querySelector("h2");
      if (!h) return;
      h.id ||= `${card.id}-title`;
      card.setAttribute("role", "region");
      card.setAttribute("aria-labelledby", h.id);
    });
    const layers = document.getElementById("map-layers");
    layers?.setAttribute("role", "group");
    layers?.setAttribute("aria-label", "Map layers");
    render(app);
  },
  update(app) { if (document.getElementById("words-body")) render(app); },
};
export default feature;
