/** Student view: a plain-language flood alert, and the accessibility panel (text size, voice mode, step-free routes, read-aloud). */
import type { Feature } from "../../core/app";
import { $, catOf } from "../../core/util";
import { DRY_MARGIN_DM } from "../../lib/route";
import "./style.css";

type Option = { key: "noStairs" | "readAloud"; label: string; desc: string };
const OPTIONS: Option[] = [
  { key: "noStairs", label: "Step-free route", desc: "Routes skip every mapped staircase. For wheelchairs, crutches, strollers." },
  { key: "readAloud", label: "Read directions aloud", desc: "Speaks each direction when you press Next." },
];
const SIZES = [["", "Default"], ["text-md", "Medium"], ["text-lg", "Large"]] as const;

const feature: Feature = {
  id: "student",
  init(app) {
    const now = document.createElement("div");
    now.id = "now-body";
    now.setAttribute("role", "status");
    app.headerNow(now);
    app.card({ student: "right", studentOrder: 10, order: 0, id: "access-card", title: "Accessibility", html: `
      <div class="small muted">Text size</div>
      <div class="seg a11y-size" id="a11y-size" role="group" aria-label="Text size">${SIZES.map(([cls, label]) => `<button data-size="${cls}">${label}</button>`).join("")}</div>
      <button id="a11y-voice" class="btn a11y-voice"></button>
      <p class="fine" style="margin:6px 0 0">Hands-free mode for blind and low-vision users: it tells you what the river is doing, listens, and guides you step by step.</p>
      <div class="a11y-opts" id="a11y-opts"></div>
      <div class="small muted" style="margin-top:12px">Keyboard</div>
      <div class="a11y-keys">
        <span class="chip mono">V</span><span>Turn voice mode on or off</span>
        <span class="chip mono">G</span><span>Find my route (voice mode)</span>
        <span class="chip mono">N</span><span>Next direction (voice mode)</span>
        <span class="chip mono">R</span><span>Repeat the last thing said</span>
        <span class="chip mono">Esc</span><span>Stop talking (voice mode stays on)</span>
      </div>` });

    // text size
    const sizeBtns = [...document.querySelectorAll<HTMLButtonElement>("#a11y-size button")];
    const setSize = (cls: string) => {
      document.body.classList.remove("text-md", "text-lg");
      if (cls) document.body.classList.add(cls);
      sizeBtns.forEach((b) => { b.classList.toggle("on", b.dataset.size === cls); b.setAttribute("aria-pressed", String(b.dataset.size === cls)); });
    };
    sizeBtns.forEach((b) => (b.onclick = () => setSize(b.dataset.size!)));
    setSize("");

    // voice mode
    const voiceBtn = $<HTMLButtonElement>("a11y-voice");
    const showVoice = (on: boolean) => { voiceBtn.textContent = on ? "■ Stop voice assistant" : "🎧 Start voice assistant"; voiceBtn.classList.toggle("on", on); };
    voiceBtn.onclick = () => app.get("voice").toggle();
    app.get("voice").onChange(showVoice);
    showVoice(false);

    // switches
    const opts = $("a11y-opts");
    const render = () => {
      opts.innerHTML = OPTIONS.map((o) => { const on = app.state.access[o.key];
        return `<button class="a11y-opt${on ? " on" : ""}" data-k="${o.key}" role="switch" aria-checked="${on}">
          <span><b>${o.label}</b><span class="small muted">${o.desc}</span></span><span class="switch" aria-hidden="true"></span></button>`; }).join("");
    };
    opts.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-k]");
      if (!b) return;
      const k = b.dataset.k as Option["key"];
      app.state.access[k] = !app.state.access[k];
      render();
      app.refresh();   // the guide re-plans with or without stairs
    };
    render();
  },
  update(app) {
    const ft = app.state.stageFt, cat = catOf(ft), rise = app.rise(), whatIf = app.state.mode !== "live";
    const named = app.get("router").closedSummary(rise).named.map(([n]) => n);
    const gathers = (app.maybe("guide")?.places ?? []).filter((p) => p.kind === "gather");
    const dry = gathers.filter((p) => p.block > rise + DRY_MARGIN_DM).length;
    const el = $("now-body");
    el.classList.toggle("bad", cat !== "normal");
    const prefix = whatIf ? "What-if: " : "";
    const headline = cat === "normal" ? `${prefix}No flooding ${whatIf ? "at this level" : "near campus"}` : `${prefix}${cat[0].toUpperCase() + cat.slice(1)} flooding near campus`;
    const detail = cat === "normal" ? `${dry}/${gathers.length} help meetup spots dry` : `${named.length} roads closed to walking · ${dry}/${gathers.length} help meetup spots dry`;
    // Our ML forecast is always on in live mode; a what-if shows a scenario instead.
    const ml = app.maybe("mlForecast")?.();
    const forecast = whatIf ? "Scenario, not the live river"
      : ml && !ml.error ? `ML forecast: ${ml.predictions.map((p) => `+${p.h} h ${p.ft.toFixed(1)}`).join(" · ")} ft` : "ML forecast unavailable";
    el.innerHTML = `<b>${headline}</b> <span class="muted">· ${detail}</span><div class="now-ml mono">${forecast}</div>`;
  },
};
export default feature;
