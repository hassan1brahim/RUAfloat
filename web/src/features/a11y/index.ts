/**
 * Screen-reader support for blind and low-vision users (VoiceOver, TalkBack, NVDA, JAWS):
 * - "Flood situation": what the map shows, as text, for screen readers only (visually hidden), right after the Get me to safety box.
 * - Screen-reader mode lives in the student Accessibility panel; speech.ts does the hand-off.
 * - Skip links, a page heading, and every panel exposed as a named region, so users can jump instead of swiping.
 */
import type { App, Feature } from "../../core/app";
import { $, esc } from "../../core/util";
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

let shown = "";
function render(app: App) {
  const f = app.facts() as Facts, s = summary(f);
  const html = `
    <h3>River</h3><p>${esc(f.scenario === "live" ? "Live" : f.scenario)}: Raritan River at ${esc(s.level)}, <b>${esc(s.cat)}</b>. Flooding starts at ${esc(f.flood_stage_ft ?? 28)} feet.</p>
    <h3>Roads closed to walking${s.roads.length >= 8 ? " (main roads)" : ` (${s.roads.length})`}</h3>${list(s.roads, "None.")}
    <h3>Weather alerts (${s.alerts.length})</h3>${list(s.alerts, "None.")}
    <h3>Dry gathering points (${s.dry.length})</h3>${list(s.dry, "None reachable. Move to the highest floor you can and call 911.")}
    <h3>Your route</h3>${s.route
      ? `<p>To <b>${esc(s.route.to)}</b>, about ${esc(s.route.minutes)} minutes on foot.</p><ol>${s.route.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`
      : `<p>No route yet. Under Get me to safety, press Route from this place: it uses your location if no place is chosen.</p>`}`;
  // only touch the DOM when the words change: replacing it under VoiceOver's cursor makes it jump
  if (html !== shown) $("words-body").innerHTML = shown = html;
}

const feature: Feature = {
  id: "a11y",
  init(app) {
    // Skip links that appear on keyboard focus (the header already has the page's h1).
    document.querySelector("header.top")!.insertAdjacentHTML("afterend", `
      <nav class="skip-links" aria-label="Skip links" data-views="student">
        <a class="skip" href="#words-card">Skip to the flood situation</a>
        <a class="skip" href="#guide-card">Skip to Get me to safety</a>
      </nav>`);

    // Screen readers only: sighted students have the map; this is the map for everyone else.
    const words = app.card({ student: "left", studentOrder: 2, id: "words-card", title: "Flood situation", order: 5, html: `
      <div id="words-body" class="words-body"></div>` });

    words.classList.add("sr-only");

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
  update(app) {
    if (document.getElementById("words-body")) render(app);
  },
};
export default feature;
