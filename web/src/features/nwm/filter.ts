/** NOAA National Water Model features: noise filter and "nearest stream" sentences. */
import { et, metersBetween } from "../../core/util";

type FC = { type: "FeatureCollection"; features: { type: "Feature"; properties: Record<string, string | number>; geometry: { type: string; coordinates: unknown } }[] };
export type Nwm = { fetched_at: string; run: { reference_time: string } | null; reaches_modeled?: number; source: string;
  rapid: FC; arrival: FC; probability: FC; inundation: FC; errors: Record<string, string> };

/**
 * Headwater ditches (stream order 1, a few cfs) cross their tiny thresholds on dry nights: model noise for our purpose.
 * Shown: order >= 2, or >= 10 cfs. The rest are counted, not drawn.
 */
const meaningful = (p: Record<string, string | number>) => Number(p.strm_order) >= 2 || Number(p.max_flow ?? p.flood_flow ?? 0) >= 10;
export function filterNwm(n: Nwm) {
  const keep = (fc: FC) => ({ ...fc, features: fc.features.filter((f) => meaningful(f.properties)) });
  const hidden = n.arrival.features.length - keep(n.arrival).features.length;
  return {
    ...n, hidden,
    rapid: keep(n.rapid), arrival: keep(n.arrival),
    probability: { ...n.probability, features: n.probability.features.filter((f) => Number(f.properties.strm_order) >= 2) },
    inundation: { ...n.inundation, features: n.inundation.features.filter((f) => Number(f.properties.streamflow_cfs) >= 10) },
  };
}

const utc = (s: string) => new Date(s.replace(" UTC", "").replace(" ", "T") + "Z").toISOString();
const lines = (g: { type: string; coordinates: unknown }) => (g.type === "MultiLineString" ? (g.coordinates as number[][][]) : [g.coordinates as number[][]]);

/** NOAA forecast on the nearest modeled stream within 400 m of a point, as plain sentences. */
export function nwmNear(n: ReturnType<typeof filterNwm> | null, lon: number, lat: number, maxM = 400): string[] {
  if (!n) return [];
  const near = (fc: FC) => fc.features.filter((f) => lines(f.geometry).some((l) => l.some(([x, y]) => metersBetween({ lon: x, lat: y }, { lon, lat }) <= maxM)));
  const out: string[] = [];
  for (const f of near(n.rapid)) out.push(`NOAA flash-flood forecast on ${f.properties.name}: starts ${et(utc(String(f.properties.flood_start_time)))} (+${Math.round(Number(f.properties.flood_percent_increase))}% flow)`);
  for (const f of near(n.arrival)) out.push(`NOAA high water on ${f.properties.name}: ${et(utc(String(f.properties.high_water_arrival_time)))} to ${et(utc(String(f.properties.below_bank_return_time)))}`);
  for (const f of near(n.probability)) out.push(`NOAA high-water probability on ${f.properties.name}: ${Math.round(Number(f.properties.hw_prob_all))}% (next 12 h)`);
  return out;
}
