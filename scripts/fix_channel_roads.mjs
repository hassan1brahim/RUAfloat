// Road segments drawn over the river channel (unmarked bridges, or long paths that clip a channel cell at 7 m resolution)
// came out "wet at zero rise", so Landing Lane and the D&R towpath closed at 17.3 ft, ordinary flow.
// This recomputes those segments' closing levels from the flood grid, ignoring channel cells; the banks still count.
// Usage: node scripts/fix_channel_roads.mjs   (rewrites web/public/data/roads.json; prints what changed)
import fs from "node:fs";

const DATA = new URL("../web/public/data/", import.meta.url);
const NEVER = 65535, WALK_DM = 1, VEHICLE_DM = 3;   // pipeline/area.py: 10 cm closes walking, 30 cm closes cars

const meta = JSON.parse(fs.readFileSync(new URL("grid.json", DATA)));
const buf = fs.readFileSync(new URL("grid.bin", DATA));
const n = meta.w * meta.h;
const level = new Uint16Array(buf.buffer, buf.byteOffset, n), hand = new Uint16Array(buf.buffer, buf.byteOffset + n * 2, n);

/** Fractional pixel in the grid (Web Mercator z14, same as web/src/lib/flood.ts). */
function px(lon, lat) {
  const N = 2 ** 14 * 256, merc = (la) => { const r = (la * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };
  return [((lon + 180) / 360) * N - ((meta.bounds[0] + 180) / 360) * N, merc(lat) - merc(meta.bounds[3])];
}

/** [first water, closed to walking, closed to cars] in dm, sampling every half pixel and skipping channel cells. */
export function tiers(coords) {
  let wet = NEVER, walk = NEVER, veh = NEVER;
  for (let k = 0; k + 1 < coords.length; k++) {
    const [x0, y0] = px(...coords[k]), [x1, y1] = px(...coords[k + 1]);
    const steps = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 0.5));
    for (let i = 0; i <= steps; i++) {
      const x = Math.floor(x0 + ((x1 - x0) * i) / steps), y = Math.floor(y0 + ((y1 - y0) * i) / steps);
      if (x < 0 || y < 0 || x >= meta.w || y >= meta.h) continue;
      const lv = level[y * meta.w + x], hd = hand[y * meta.w + x];
      if (lv === NEVER || lv === 0) continue;   // never floods, or the channel itself
      wet = Math.min(wet, lv);
      walk = Math.min(walk, Math.max(lv, hd + WALK_DM));
      veh = Math.min(veh, Math.max(lv, hd + VEHICLE_DM));
    }
  }
  return [wet, walk, veh];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const roads = JSON.parse(fs.readFileSync(new URL("roads.json", DATA)));
  const ft = (dm) => (dm >= NEVER ? "never" : `${(17 + dm / 3.048).toFixed(1)} ft`);
  let fixed = 0;
  for (const e of roads.edges) {
    if (e[8] !== 0) continue;   // only segments that were wet at zero rise
    const coords = Array.from({ length: e[6] }, (_, k) => [roads.geom[2 * (e[5] + k)], roads.geom[2 * (e[5] + k) + 1]]);
    const [wet, walk, veh] = tiers(coords);
    console.log(`${roads.names[e[4]].padEnd(36)} ${String(Math.round(e[2])).padStart(5)} m  walking ${ft(e[3])} -> ${ft(walk)}  cars ${ft(e[7])} -> ${ft(veh)}`);
    [e[8], e[3], e[7]] = [wet, walk, veh];
    fixed++;
  }
  fs.writeFileSync(new URL("roads.json", DATA), JSON.stringify(roads));
  console.log(`${fixed} segment(s) recomputed`);
}
