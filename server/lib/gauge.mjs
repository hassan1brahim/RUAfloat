// Gauge readings sometimes glitch (e.g. Bound Brook reported 0.11 ft between two 16.85 ft readings on 2026-10-10).
// A river can't move feet in minutes: drop readings that are missing or jump implausibly from the last good one.
const MAX_FT_PER_HOUR = 3;   // Ida, the record flood, rose about 1.5 ft an hour at its fastest

/** NWPS observed points [{validTime, primary}] -> the same points with glitches removed. */
export function cleanObserved(points) {
  const out = [];
  for (const p of points) {
    if (!(p.primary > -999)) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const hours = Math.max(0.25, (Date.parse(p.validTime) - Date.parse(prev.validTime)) / 3600e3);
      if (Math.abs(p.primary - prev.primary) > MAX_FT_PER_HOUR * hours) continue;
    }
    out.push(p);
  }
  return out;
}
