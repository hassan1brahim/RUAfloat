/** Our ML river forecast: Bound Brook level in 3 / 6 / 12 h from upstream gauges (live), and what it would have said during Ida. */
import type { Feature } from "../../core/app";
import { $, esc, et, getJson } from "../../core/util";
import "./style.css";

type MlLive = { issued: string; now_ft: number; inputs: string[]; predictions: { h: number; at: string; ft: number }[];
  scores: Record<string, { mae_ft_high_water: number | null; persistence_mae_ft_high_water: number | null }>; error?: string };
type MlIda = { t: string; now: number; pred: Record<string, number>; actual: Record<string, number | null> }[];
let live: MlLive | null = null, ida: MlIda | null = null;

const feature: Feature = {
  id: "forecast",
  async init(app) {
    $("gauge-card").insertAdjacentHTML("beforeend", `<div class="ml" id="g-ml" aria-live="polite"></div>`);
    const refresh = async () => { try { live = await getJson<MlLive>("/api/forecast"); } catch { live = null; } app.refresh(); };
    await refresh();
    setInterval(refresh, 10 * 60e3);
    getJson<MlIda>("/data/ida_forecast.json").then((d) => { ida = d; app.refresh(); }).catch(() => {});
  },
  update(app) {
    const el = $("g-ml");
    el.hidden = app.state.mode === "whatif";
    if (el.hidden) return;
    if (app.state.mode === "ida") {
      const river = app.get("river"), t = river.ida.series[river.idaIndex()][0].slice(0, 13);
      const r = ida?.find((x) => x.t.slice(0, 13) === t);
      el.innerHTML = r ? `<b>Our ML forecast</b>, never trained on Ida. Issued at this hour:
        <div class="row3">${[3, 6, 12].map((h) => `<span>+${h} h: ${r.pred[`${h}h`].toFixed(1)}<br><span class="muted">real ${r.actual[`${h}h`]?.toFixed(1) ?? "?"}</span></span>`).join("")}</div>`
        : `<span class="muted">ML forecast for this hour not available.</span>`;
      return;
    }
    if (!live || live.error) { el.innerHTML = `<span class="muted">ML forecast: ${esc(live?.error ?? "unavailable")}</span>`; return; }
    const score = (h: number) => { const s = live!.scores[`${h}h`]; return s?.mae_ft_high_water != null ? `±${s.mae_ft_high_water} ft` : ""; };
    el.innerHTML = `<b>Our ML forecast</b> (${live.inputs.length} river gauges, issued ${et(live.issued)} ET):
      <div class="row3">${live.predictions.map((p) => `<span>+${p.h} h: ${p.ft.toFixed(1)} ft<br><span class="muted">${score(p.h)}</span></span>`).join("")}</div>
      <span class="muted">± = typical error at high water on years it never saw.</span>`;
  },
  facts(app) {
    return { our_ml_forecast: app.state.mode === "live" && live && !live.error ? live.predictions.map((p) => ({ in_hours: p.h, ft: p.ft })) : null };
  },
};
export default feature;
