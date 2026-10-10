/** Hands-free voice mode for blind and low-vision users: V (or /?voice=1, then any key) starts it; then just talk. */
import type { Feature } from "../../core/app";
import { $, BASE_FT } from "../../core/util";
import { onSpeak, speak, stopSpeaking } from "../../lib/speech";
import { GENERIC_ROAD, NO_OBSERVATIONS } from "../roads";
import { VoiceAssistant } from "./assistant";
import { AgentConversation } from "./conversation";
import "./style.css";

let voice: VoiceAssistant;

function log(line: string) {
  const el = document.getElementById("voice-log");
  if (!el) return;
  el.insertAdjacentHTML("afterbegin", `<li>${line.replace(/</g, "&lt;")}</li>`);
  while (el.children.length > 12) el.lastElementChild!.remove();
}

const feature: Feature = {
  id: "voice",
  init(app) {
    const router = app.get("router"), guide = app.get("guide");
    const edgeCount = (router as unknown as { r: { edges: unknown[] } }).r.edges.length;
    const roadNames = [...new Set(Array.from({ length: edgeCount }, (_, i) => router.edgeName(i)))].filter((n) => !GENERIC_ROAD.test(n));

    document.body.insertAdjacentHTML("afterbegin", `
      <a class="skip" href="#btn-voice" id="skip-voice">Skip to voice assistant</a>
      <div id="voice-gate" class="voice-gate" role="button" tabindex="0" aria-label="Press any key or tap anywhere to start the HackRU-26 voice assistant" hidden>
        <div><div class="big-icon" aria-hidden="true">🎧</div><h1>HackRU-26 voice assistant</h1><p>Press any key or tap anywhere to start.<br>It will tell you what the river is doing and where to go.</p></div>
      </div>`);
    const btn = document.createElement("button");
    btn.id = "btn-voice"; btn.className = "btn voice-btn"; btn.title = "Voice assistant (V)";
    btn.setAttribute("aria-pressed", "false"); btn.setAttribute("aria-describedby", "voice-help");
    // the help text sits outside the button so it is the description, not part of the name
    btn.innerHTML = `<span aria-hidden="true">🎧</span><span class="lbl"> Voice assistant</span>`;
    btn.setAttribute("aria-label", "Voice assistant");
    app.headerItem(btn);
    btn.insertAdjacentHTML("afterend", `<span id="voice-help" class="sr-only">Hands-free mode for blind and low-vision users. Press V to start or stop. Then just talk. Keys: space for a briefing, G to be guided, N for next step, R to repeat, Escape to stop.</span>`);
    $("skip-voice").onclick = (e) => { e.preventDefault(); btn.focus(); };
    app.card({ col: "right", id: "voice-card", title: "Voice assistant", order: 10, hidden: true, extraTitle: ` <span class="src muted">V to stop</span>`, html: `
      <div id="voice-state" class="small muted"></div>
      <ul id="voice-log" class="voice-log"></ul>
      <div class="small muted">Say “help” for what you can ask. Keys: Space briefing · G guide · N next step · R repeat · Esc stop.</div>` });
    $("map").setAttribute("role", "img");
    $("map").setAttribute("aria-label", "Flood map of Rutgers New Brunswick. Everything on the map is also available by voice: press V.");
    onSpeak((text) => log(`🔊 ${text}`));

    const roadFacts = (name: string) => {
      const ids: number[] = [];
      for (let i = 0; i < edgeCount; i++) if (router.edgeName(i) === name) ids.push(i);
      if (!ids.length) return null;
      const rise = app.rise(), obs = app.maybe("observations")?.() ?? NO_OBSERVATIONS;
      const worst = ids.reduce((a, b) => (router.edge(b)[3] < router.edge(a)[3] ? b : a));
      const e = router.edge(worst), closesFt = e[3] >= 65535 ? null : +(BASE_FT + e[3] / 3.048).toFixed(1);
      const closedNow = ids.some((i) => router.edge(i)[3] <= rise), observed = ids.some((i) => obs.closed.has(i));
      const summary = observed ? `${name} has a flooded section reported right now. Avoid it.`
        : closedNow ? `Parts of ${name} are predicted to be under water, too deep to walk. Avoid it.`
        : closesFt ? `${name} is predicted to be open for walking now. Its lowest section floods when the river reaches about ${closesFt} feet; it is ${app.state.stageFt.toFixed(1)} feet now.`
        : `${name} is not predicted to flood.`;
      return { name, closed_to_walking_now: closedNow, closed_by_observation: observed, lowest_section_closes_at_ft: closesFt, river_now_ft: +app.state.stageFt.toFixed(1), summary };
    };

    voice = new VoiceAssistant({
      facts: () => app.facts(),
      placeNames: () => guide.starts.map((s) => s.name),
      roadNames: () => roadNames,
      setStartByName: (n) => { const st = guide.starts.find((s) => s.name === n); if (st) guide.setStart(st); return !!st; },
      setStartAt: (lon, lat) => guide.setStart({ name: "Your location", lon, lat }),
      inArea: (lon, lat) => app.get("grid").cellAt(lon, lat) >= 0,
      guide: () => guide.run(true),
      roadFacts, speak, stopSpeaking,
    }, log);
    if (import.meta.env.DEV) (window as unknown as { __voice: VoiceAssistant }).__voice = voice;

    // Full conversation through ElevenLabs Agents when the server has an agent; the command assistant otherwise.
    const showState = () => {
      const on = agent.active || voice.active;
      btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on); $("voice-card").hidden = !on;
    };
    const agent = new AgentConversation({
      facts: () => app.facts(),
      placeNames: () => guide.starts.map((s) => s.name),
      roadNames: () => roadNames,
      setStartByName: (n) => { const st = guide.starts.find((s) => s.name === n); if (st) guide.setStart(st); return !!st; },
      setStartAt: (lon, lat) => guide.setStart({ name: "Your location", lon, lat }),
      setStart: (s) => guide.setStart(s),
      inArea: (lon, lat) => app.get("grid").cellAt(lon, lat) >= 0,
      hasStart: () => !!guide.start(),
      guide: () => guide.run(true),
      roadFacts,
    }, log, (s) => { $("voice-state").textContent = s; showState(); });
    let agentReady: boolean | null = null;
    if (import.meta.env.DEV) (window as unknown as { __agent: AgentConversation }).__agent = agent;

    const toggle = async () => {
      if (agent.active) await agent.stop();
      else if (voice.active) voice.stop();
      else {
        agentReady ??= await AgentConversation.available();
        if (agentReady) {
          try { await agent.start(); }
          catch (e) { log(`⚠️ ElevenLabs conversation unavailable (${(e as Error).message}). Using basic voice mode.`); void voice.start(); }
        } else void voice.start();
      }
      showState();
    };
    btn.onclick = () => void toggle();
    document.addEventListener("keydown", (e) => {
      if (!$("voice-gate").hidden) return;   // the start screen handles its own first key
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (e.key === " " && t.closest("button, a, summary, [role=button]")) return;   // Space still presses the focused control
      if (e.key.toLowerCase() === "v" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void toggle(); return; }
      if (agent.active && e.key === "Escape") { void toggle(); return; }
      if (!voice.active) return;
      if (e.key === "Escape") { void toggle(); return; }
      if ([" ", "g", "r", "n"].includes(e.key.toLowerCase())) { e.preventDefault(); voice.key(e.key.toLowerCase()); }
    });
  },
  ready(app) {
    if (app.params.get("voice") !== "1") return;
    // the whole screen is one button: audio and microphone need one gesture to start
    const gate = $("voice-gate");
    gate.hidden = false;
    gate.focus();
    const go = (e?: Event) => {
      e?.preventDefault();
      e?.stopPropagation();   // otherwise the V shortcut sees this key too and toggles straight back off
      gate.hidden = true;
      document.removeEventListener("keydown", go, true);
      $<HTMLButtonElement>("btn-voice").click();
      $("btn-voice").focus();
    };
    gate.onclick = () => go();
    document.addEventListener("keydown", go, true);
  },
};
export default feature;
