/** Our ML river forecast: Bound Brook level in 3 / 6 / 12 / 18 h from upstream gauges and rain already fallen (live), and what it would have said during Ida. */
import type { Feature } from "../../core/app";
import { $, esc, et, getJson } from "../../core/util";
import "./style.css";

type MlLive = { issued: string; now_ft: number; inputs: string[]; rain?: { station: string } & Record<string, number | string> | null; predictions: { h: number; at: string; ft: number }[];
  scores: Record<string, { mae_ft_high_water: number | null; persistence_mae_ft_high_water: number | null }>; error?: string };
type MlIda = { t: string; now: number; pred: Record<string, number>; actual: Record<string, number | null> }[];
let live: MlLive | null = null, ida: MlIda | null = null;
declare module "../../core/app" { interface Services { mlForecast: () => MlLive | null } }

/** Orange dots on the river chart at issue time + h hours (the chart stores its scale on the svg). */
function plot(issued: string, pts: [number, number][]) {
  const svg = document.getElementById("spark") as unknown as SVGSVGElement | null;
  if (!svg?.dataset.t0) return;
  const { t0, t1, lo, hi } = Object.fromEntries(Object.entries(svg.dataset).map(([k, v]) => [k, Number(v)]));
  const X = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 300, Y = (v: number) => 78 - ((v - lo) / (hi - lo)) * 74;
  svg.querySelectorAll(".ml-pt").forEach((n) => n.remove());
  for (const [h, ft] of pts) {
    const x = X(Date.parse(issued) + h * 3600e3);
    if (x >= 0 && x <= 300) svg.insertAdjacentHTML("beforeend", `<circle class="ml-pt" cx="${x}" cy="${Y(ft)}" r="3.5" fill="#fb923c" stroke="#0f151d" stroke-width="1"/>`);
  }
}

const feature: Feature = {
  id: "forecast",
  async init(app) {
    $("gauge-card").insertAdjacentHTML("beforeend", `<div class="ml" id="g-ml" aria-live="polite"></div>`);
    app.provide("mlForecast", () => live);
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
      const river = app.get("river");
      if (river.ida.id !== "ida") { el.innerHTML = `<span class="muted">Our ML forecast check covers Ida 2021 only.</span>`; return; }
      const t = river.ida.series[river.idaIndex()][0].slice(0, 13);
      const r = ida?.find((x) => x.t.slice(0, 13) === t);
      const hs = Object.keys(r?.pred ?? {}).map((k) => parseInt(k));
      if (!r) { el.innerHTML = `<span class="muted">ML forecast for this hour not available.</span>`; return; }
      // the forecast made at this hour, as orange dots on the chart; the blue line is what really happened
      plot(river.ida.series[river.idaIndex()][0], hs.map((h) => [h, r.pred[`${h}h`]]));
      el.innerHTML = `<div class="ml-h"><i class="ml-dot"></i><b>Our ML forecast</b> <span class="muted">· made at this hour, never trained on Ida</span></div>
        <div class="ml-chips">${hs.map((h) => {
          const p = r.pred[`${h}h`], a = r.actual[`${h}h`], off = a == null ? null : Math.abs(p - a);
          const cls = off == null ? "" : off < 1 ? "good" : off < 2 ? "fair" : "poor";
          return `<span class="ml-chip ${cls}"><small>in ${h} h</small><b>${p.toFixed(1)} ft</b><span>${off == null ? "no reading" : `${off.toFixed(1)} ft off`}</span></span>`;
        }).join("")}</div>`;
      return;
    }
    if (!live || live.error) { el.innerHTML = `<span class="muted">ML forecast: ${esc(live?.error ?? "unavailable")}</span>`; return; }
    const score = (h: number) => { const s = live!.scores[`${h}h`]; return s?.mae_ft_high_water != null ? `±${s.mae_ft_high_water} ft` : ""; };
    plot(live.issued, live.predictions.map((p) => [p.h, p.ft]));
    el.innerHTML = `<div class="ml-h"><i class="ml-dot"></i><b>Our ML forecast</b> <span class="muted">· ${live.inputs.length} river gauges${live.rain ? ` + rain at Somerset Airport (${live.rain.last_24h_in} in, 24 h)` : ""}, ${et(live.issued)} ET</span></div>
      <div class="ml-chips">${live.predictions.map((p) => `<span class="ml-chip"><small>in ${p.h} h</small><b>${p.ft.toFixed(1)} ft</b><span>${score(p.h) || "&nbsp;"}</span></span>`).join("")}</div>
      <div class="muted small">± = typical error at high water, on years it never saw.</div>`;
  },
  facts(app) {
    return { our_ml_forecast: app.state.mode === "live" && live && !live.error ? live.predictions.map((p) => ({ in_hours: p.h, ft: p.ft })) : null };
  },
};
export default feature;
