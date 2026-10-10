/** The five things a person needs to know about one road segment. */
import type { FloodGrid } from "../../lib/flood";
import type { Router } from "../../lib/route";
import { et } from "../../core/util";
import type { Evidence } from "../roads";

/** Lower edge of the New Brunswick rise, from NOAA FIM cross-sections on the Bound Brook reach (14.4 vs 16.6 ft). */
export const NB_LOW = 0.87;

export function roadPanel(o: {
  ei: number; router: Router; grid: FloodGrid; riseDm: number; stageFt: number; baseFt: number;
  mode: "live" | "ida" | "whatif"; forecast: [string, number][]; forecastIssued: string | null; observedAt: string | null;
  ida: [string, number][]; evidence: Evidence[]; observedClosed: boolean; onRoute: boolean; noaa: string[] | null;
}) {
  const e = o.router.edge(o.ei);
  const name = o.router.edgeName(o.ei);
  const toFt = (dm: number) => (dm >= 65535 ? null : o.baseFt + dm / 3.048);
  const closeFt = toFt(e[3]), vehFt = toFt(e[7]), wetFt = toFt(e[8]);
  const closeFtLate = e[3] >= 65535 ? null : o.baseFt + e[3] / NB_LOW / 3.048;  // if New Brunswick rises 13% less
  const modelClosed = e[3] <= o.riseDm;

  const observedWet = o.evidence.some((ev) => ev.closes);
  const conflict = observedWet && !modelClosed ? "<br><b>⚠ Observation and model disagree:</b> the model predicts this segment is open; routing follows the observation."
    : !observedWet && modelClosed && o.evidence.length ? "<br><b>⚠ Model predicts closure</b> but no observation confirms ≥ 15 cm; routing stays conservative and keeps it closed." : "";
  const condition = (o.evidence.length
    ? o.evidence.map((ev) => `• ${ev.text}`).join("<br>")
    : "Unknown: no sensor or student report on this segment.") + conflict;

  let onset: string;
  if (closeFt == null) onset = "Not predicted to flood within the model's range.";
  else if (modelClosed) onset = `Predicted closed to walking now (closes at ≥ ${closeFt.toFixed(1)} ft at Bound Brook, possibly as late as ${closeFtLate!.toFixed(1)} ft).`;
  else if (o.mode === "live") {
    const hit = o.forecast.find((p) => p[1] >= closeFt);
    const peak = o.forecast.reduce((m, p) => (p[1] > m[1] ? p : m), ["", -1] as [string, number]);
    onset = hit ? `NWS forecast reaches ${closeFt.toFixed(1)} ft around <b>${et(hit[0])}</b>: expect closure then.`
      : `Closes at ≥ ${closeFt.toFixed(1)} ft. Not reached in the current NWS forecast${peak[0] ? ` (peak ${peak[1].toFixed(1)} ft, ${et(peak[0])})` : ""}.`;
  } else if (o.mode === "ida") {
    const hit = o.ida.find((p) => p[1] >= closeFt);
    onset = hit ? `During Ida the river passed ${closeFt.toFixed(1)} ft at <b>${et(hit[0])}</b>.` : `Closes at ≥ ${closeFt.toFixed(1)} ft; Ida never got there.`;
  } else onset = `Closes when Bound Brook reaches ≥ ${closeFt.toFixed(1)} ft.`;

  // New Brunswick likely rises less than Bound Brook: NOAA's cross-sections show -13% within 13 km.
  // Upper edge = our model (routing uses this, to stay safe); lower edge = rise x 0.87.
  const samples = o.router.edgeSamples(o.ei);
  const maxDepth = (r: number) => Math.max(0, ...samples.map(([x, y]) => o.grid.depthAt(x, y, r)).filter((d) => d >= 0)) * 10;
  const hi = maxDepth(o.riseDm), lo = maxDepth(Math.round(o.riseDm * NB_LOW));
  // Bridges and high ground carry no closing level; sampling the grid under a bridge would report the river.
  const depth = closeFt == null ? "Not flooded in the model (bridge or high ground)."
    : (hi <= 0 ? "Dry at this river level." : `Deepest point on this segment: likely ${Math.round(lo)}–${Math.round(hi)} cm (range = how much less New Brunswick may rise than Bound Brook).`)
      + `<br><span class="muted">First water at ${wetFt?.toFixed(1)} ft · closed to walking (10–15 cm) at ${closeFt.toFixed(1)} ft · to vehicles (30 cm) at ${vehFt?.toFixed(1)} ft</span>`;

  const evidence = [
    `River: ${o.stageFt.toFixed(1)} ft at Bound Brook (${o.mode === "live" ? `NWS/USGS, observed ${o.observedAt ? et(o.observedAt) : "n/a"}` : o.mode === "ida" ? "USGS record, Ida 2021" : "what-if"})`,
    o.mode === "live" && o.forecastIssued ? `NWS forecast issued ${et(o.forecastIssued)}` : "",
    "Model: height above the Raritan over USGS 3DEP elevation (approximation, not validated for New Brunswick)",
  ].filter(Boolean).join("<br>");

  const closedNow = modelClosed || o.observedClosed;
  const consequence = closedNow
    ? `Excluded from walking routes now (${[modelClosed && "model", o.observedClosed && "observed"].filter(Boolean).join(" + ")}).`
    : "Open for routing at this level.";

  return `<div class="road-panel"><b>${name}</b>
    <dl>
      <dt>Current condition</dt><dd>${condition}</dd>
      <dt>Predicted onset</dt><dd>${onset}</dd>
      <dt>Predicted depth</dt><dd>${depth}</dd>
      ${o.noaa === null ? "" : `<dt>Likelihood (NOAA)</dt><dd>${o.mode !== "live" ? "NOAA's forecast is live data, so it isn't shown during a replay or what-if."
        : o.noaa.length ? o.noaa.join("<br>") : "No NOAA high-water forecast on modeled streams within 400 m. (Our river model has no probability; we don't invent one.)"}</dd>`}
      <dt>Evidence</dt><dd class="muted">${evidence}</dd>
      <dt>Route consequence</dt><dd>${consequence}${o.onRoute ? " <b>On your current route.</b>" : ""}</dd>
    </dl></div>`;
}

