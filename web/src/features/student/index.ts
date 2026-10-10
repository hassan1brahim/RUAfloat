/** Student view: the "Right now" summary in the header corner (text size is the browser's own zoom, Ctrl/Cmd + and -). */
import type { Feature } from "../../core/app";
import { $, catOf } from "../../core/util";
import { DRY_MARGIN_DM } from "../../lib/route";
import { announce, screenReaderMode, setScreenReaderMode } from "../../lib/speech";
import "./style.css";

let lastHeadline = "";

const feature: Feature = {
  id: "student",
  init(app) {
    const now = document.createElement("div");
    now.id = "now-body";
    app.headerNow(now);
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
    // Tell screen readers when the situation changes category, not every redraw (the Ida replay redraws 4 times a second).
    if (lastHeadline && headline !== lastHeadline) announce(headline);
    lastHeadline = headline;
    el.innerHTML = `<b>${headline}</b> <span class="muted">· ${detail}</span><div class="now-ml mono">${forecast}</div>`;
  },
};
export default feature;
