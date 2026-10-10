/** Walking router over the OSM graph. Edge e[3] = rise (dm) that closes it to walking (10-15 cm), e[7] = to vehicles (30 cm), e[8] = first water. */

export type Place = { name: string; kind: "gather" | "hospital" | "police" | "fire"; lon: number; lat: number; campus?: string; block: number; hand: number; capacity?: number; capacity_from?: string };
export type Step = { road: string; meters: number; say: string; at: [number, number] };
export type Plan = {
  dest: Place; meters: number; minutes: number; steps: Step[];
  coords: [number, number][]; avoid: string[]; edges: number[];
  /** The start is already at a dry meetup spot: stay there, no walk. */
  here?: boolean;
};
/** Road segments closed by observations (sensor or confirmed report), on top of the model's closures. */
export type Closed = Set<number>;

type Roads = { nodes: number[]; edges: number[][]; names: string[]; geom: number[] };
const WALK_MPS = 1.3;
const GENERIC = new Set(["footpath", "path", "service road", "bike path", "steps", "unnamed road", "walkway", "access road"]);
export const DRY_MARGIN_DM = 9; // a gathering point must stay dry ~3 ft above the current rise
// A building is reached from whichever nearby path point gives the shortest walk, not only the single nearest one
// (the nearest can be a walkway behind the building that loops the long way round). Off-path metres cost a bit more.
const START_SNAP_M = 50, DEST_SNAP_M = 70, OFF_PATH = 2, HERE_M = 80;

export class Router {
  private adj: Int32Array;
  private adjStart: Int32Array;

  constructor(readonly r: Roads) {
    const n = r.nodes.length / 2;
    const deg = new Int32Array(n + 1);
    for (const e of r.edges) { deg[e[0] + 1]++; deg[e[1] + 1]++; }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    this.adjStart = deg.slice();
    this.adj = new Int32Array(deg[n]);
    const fill = deg.slice();
    r.edges.forEach((e, i) => { this.adj[fill[e[0]]++] = i; this.adj[fill[e[1]]++] = i; });
  }

  static async load(): Promise<Router> {
    return new Router(await fetch("/data/roads.json").then((x) => x.json()));
  }

  get nodeCount() { return this.r.nodes.length / 2; }
  lon(i: number) { return this.r.nodes[2 * i]; }
  lat(i: number) { return this.r.nodes[2 * i + 1]; }
  name(e: number[]) { return this.r.names[e[4]]; }

  nearest(lon: number, lat: number): number {
    const k = Math.cos((lat * Math.PI) / 180);
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.nodeCount; i++) {
      const dx = (this.lon(i) - lon) * k, dy = this.lat(i) - lat;
      const d = dx * dx + dy * dy;
      if (d < bd && this.adjStart[i + 1] > this.adjStart[i]) { bd = d; best = i; }
    }
    return best;
  }

  edgeCoords(ei: number, from: number): [number, number][] {
    const e = this.r.edges[ei];
    const out: [number, number][] = [];
    for (let k = 0; k < e[6]; k++) out.push([this.r.geom[2 * (e[5] + k)], this.r.geom[2 * (e[5] + k) + 1]]);
    return e[0] === from ? out : out.reverse();
  }

  /** Closed edges as GeoJSON; `observed` marks closures that come from sensors/reports rather than the model. */
  closedGeoJSON(riseDm: number, observed: Closed = new Set()) {
    const features = [];
    for (let i = 0; i < this.r.edges.length; i++) {
      const e = this.r.edges[i];
      const tier = observed.has(i) ? "observed" : e[3] <= riseDm ? "closed" : e[8] <= riseDm ? "caution" : null;
      if (tier) features.push({ type: "Feature" as const, properties: { name: this.name(e), observed: tier === "observed", tier }, geometry: { type: "LineString" as const, coordinates: this.edgeCoords(i, e[0]) } });
    }
    return { type: "FeatureCollection" as const, features };
  }

  edge(i: number) { return this.r.edges[i]; }
  edgeName(i: number) { return this.name(this.r.edges[i]); }

  /** Edges with any vertex within `radiusM` of a point. */
  edgesNear(lon: number, lat: number, radiusM: number): number[] {
    const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110570;
    const out: number[] = [];
    this.r.edges.forEach((e, i) => {
      for (let k = 0; k < e[6]; k++) {
        const dx = (this.r.geom[2 * (e[5] + k)] - lon) * kx, dy = (this.r.geom[2 * (e[5] + k) + 1] - lat) * ky;
        if (dx * dx + dy * dy <= radiusM * radiusM) { out.push(i); return; }
      }
    });
    return out;
  }

  /** Nearest edge to a point (distance to segments), or -1 beyond maxM. */
  nearestEdge(lon: number, lat: number, maxM = 25): number {
    const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110570;
    let best = -1, bd = maxM;
    this.r.edges.forEach((e, i) => {
      for (let k = 0; k + 1 < e[6]; k++) {
        const ax = (this.r.geom[2 * (e[5] + k)] - lon) * kx, ay = (this.r.geom[2 * (e[5] + k) + 1] - lat) * ky;
        const bx = (this.r.geom[2 * (e[5] + k + 1)] - lon) * kx, by = (this.r.geom[2 * (e[5] + k + 1) + 1] - lat) * ky;
        const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
        const t = L ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L)) : 0;
        const d = Math.hypot(ax + t * vx, ay + t * vy);
        if (d < bd) { bd = d; best = i; }
      }
    });
    return best;
  }

  /** Points every ~8 m along an edge, for sampling the flood grid. */
  edgeSamples(i: number): [number, number][] {
    const c = this.edgeCoords(i, this.r.edges[i][0]);
    const out: [number, number][] = [];
    for (let k = 0; k + 1 < c.length; k++) {
      const [a, b] = [c[k], c[k + 1]];
      const n = Math.max(1, Math.round(Math.hypot((b[0] - a[0]) * 84000, (b[1] - a[1]) * 111000) / 8));
      for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
    out.push(c[c.length - 1]);
    return out;
  }

  closedSummary(riseDm: number) {
    const byName = new Map<string, number>();
    let total = 0;
    for (const e of this.r.edges) {
      if (e[3] > riseDm) continue;
      total += e[2];
      const n = this.name(e);
      if (!GENERIC.has(n)) byName.set(n, (byName.get(n) || 0) + e[2]);
    }
    return { km: total / 1000, named: [...byName.entries()].sort((a, b) => b[1] - a[1]) };
  }

  /** Path nodes within `radiusM` of a point with their straight-line distance; at least the nearest one. */
  private nodesNear(lon: number, lat: number, radiusM: number): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.adjStart[i + 1] === this.adjStart[i]) continue;
      const d = metersBetween([lon, lat], [this.lon(i), this.lat(i)]);
      if (d <= radiusM) out.push([i, d]);
    }
    if (!out.length) { const n = this.nearest(lon, lat); out.push([n, metersBetween([lon, lat], [this.lon(n), this.lat(n)])]); }
    return out;
  }

  /** Shortest walking distance from several start nodes at once, each with its own head start (metres). */
  private dijkstra(seeds: [number, number][], riseDm: number, observed: Closed) {
    const n = this.nodeCount;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap: [number, number][] = [];
    for (const [node, d] of seeds) if (d < dist[node]) { dist[node] = d; heap.push([d, node]); }
    heap.sort((a, b) => a[0] - b[0]);   // a sorted array is a valid min-heap
    const push = (x: [number, number]) => {
      heap.push(x);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      for (let k = this.adjStart[u]; k < this.adjStart[u + 1]; k++) {
        const ei = this.adj[k], e = this.r.edges[ei];
        if (e[3] <= riseDm || observed.has(ei)) continue;
        const v = e[0] === u ? e[1] : e[0];
        const nd = d + e[2];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = ei; push([nd, v]); }
      }
    }
    return { dist, prev };
  }

  /** Every dry gathering point reachable on foot from a point, nearest walk first (one search for all of them). */
  reachable(lon: number, lat: number, riseDm: number, places: Place[], observed: Closed = new Set()): { place: Place; meters: number; minutes: number }[] {
    // same start and end snapping as plan(), so the list and the route agree on distances
    const seeds = this.nodesNear(lon, lat, START_SNAP_M).map(([node, d]) => [node, d * OFF_PATH] as [number, number]);
    const { dist } = this.dijkstra(seeds, riseDm, observed);
    return places
      .filter((p) => p.kind === "gather" && p.block > riseDm + DRY_MARGIN_DM)
      .map((p) => ({ place: p, meters: Math.min(...this.nodesNear(p.lon, p.lat, DEST_SNAP_M).map(([node, d]) => dist[node] + d * OFF_PATH)) }))
      .filter((x) => isFinite(x.meters))
      .sort((a, b) => a.meters - b.meters)
      .map((x) => ({ ...x, minutes: x.meters / WALK_MPS / 60 }));
  }

  /** Route from a point to the nearest gathering point that stays dry at this rise. */
  plan(lon: number, lat: number, riseDm: number, places: Place[], observed: Closed = new Set()): Plan | null {
    const dry = places.filter((p) => p.kind === "gather" && p.block > riseDm + DRY_MARGIN_DM);
    // Already at a dry meetup spot: the advice is to stay, not a 0-minute walk.
    const at0 = dry.map((p) => ({ p, d: metersBetween([lon, lat], [p.lon, p.lat]) })).sort((a, b) => a.d - b.d)[0];
    if (at0 && at0.d <= HERE_M) {
      const p = at0.p;
      return { dest: p, meters: 0, minutes: 0, here: true, edges: [], coords: [[lon, lat], [p.lon, p.lat]], avoid: this.avoidNear(lon, lat, riseDm, observed),
        steps: [{ road: p.name, meters: 0, at: [p.lon, p.lat], say: `You're at ${p.name}, a help meetup spot that stays dry at this river level. Stay here.` }] };
    }

    const seeds = this.nodesNear(lon, lat, START_SNAP_M).map(([node, d]) => [node, d * OFF_PATH] as [number, number]);
    const { dist, prev } = this.dijkstra(seeds, riseDm, observed);
    let best: { p: Place; node: number; cost: number } | null = null;
    for (const p of dry) {
      for (const [node, d] of this.nodesNear(p.lon, p.lat, DEST_SNAP_M)) {
        const cost = dist[node] + d * OFF_PATH;
        if (isFinite(cost) && (!best || cost < best.cost)) best = { p, node, cost };
      }
    }
    if (!best) return null;

    const path: number[] = [];
    let src = best.node;
    while (prev[src] !== -1) {
      const ei = prev[src];
      path.push(ei);
      const e = this.r.edges[ei];
      src = e[0] === src ? e[1] : e[0];
    }
    path.reverse();

    const coords: [number, number][] = [[lon, lat]];
    const groups: { road: string; meters: number; c0: [number, number][]; }[] = [];
    let at = src;
    for (const ei of path) {
      const e = this.r.edges[ei];
      const seg = this.edgeCoords(ei, at);
      coords.push(...seg);
      const road = spoken(this.name(e));
      const g = groups[groups.length - 1];
      // an unnamed walkway that turns sharply into another is a new step, so the turn gets spoken
      const turns = g && (road === "walkway" || road === "access road") && turnDeg(g.c0, seg) > 50;
      if (g && g.road === road && !turns) { g.meters += e[2]; g.c0.push(...seg); }
      else groups.push({ road, meters: e[2], c0: seg.slice() });
      at = e[0] === at ? e[1] : e[0];
    }
    coords.push([best.p.lon, best.p.lat]);

    const meters = best.cost;
    const steps = toSteps(groups);
    steps.push({ road: best.p.name, meters: 0, at: [best.p.lon, best.p.lat], say: `Arrive at ${best.p.name}.` });
    return { dest: best.p, meters, minutes: meters / WALK_MPS / 60, steps, coords, avoid: this.avoidNear(lon, lat, riseDm, observed), edges: path };
  }

  /** Closed named roads near the start, nearest first. */
  avoidNear(lon: number, lat: number, riseDm: number, observed: Closed = new Set(), radiusM = 1200): string[] {
    const k = Math.cos((lat * Math.PI) / 180) * 111320;
    const seen = new Map<string, number>();
    for (const [i, e] of this.r.edges.entries()) {
      if (e[3] > riseDm && !observed.has(i)) continue;
      const n = this.name(e);
      if (GENERIC.has(n)) continue;
      const dx = (this.lon(e[0]) - lon) * k, dy = (this.lat(e[0]) - lat) * 110570;
      const d = Math.hypot(dx, dy);
      if (d < radiusM && d < (seen.get(n) ?? Infinity)) seen.set(n, d);
    }
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n).slice(0, 3);
  }
}

function bearing(a: [number, number], b: [number, number]) {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
}
const metersBetween = (a: [number, number], b: [number, number]) =>
  Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180) * 111320, (b[1] - a[1]) * 110570);
/** Heading over the first ~40 m (or the last ~40 m with fromEnd), so a short jog at a corner doesn't flip it. */
function heading(c: [number, number][], fromEnd = false) {
  const pts = fromEnd ? [...c].reverse() : c;
  const far = pts.find((p) => metersBetween(pts[0], p) >= 40) ?? pts[pts.length - 1];
  return fromEnd ? bearing(far, pts[0]) : bearing(pts[0], far);
}
/** How sharply a walk bends from the end of `a` into the start of `b` (degrees, 0-180). */
const turnDeg = (a: [number, number][], b: [number, number][]) => Math.abs(((heading(b) - heading(a, true) + 540) % 360) - 180);
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const compass = (b: number) => COMPASS[Math.round(((b + 360) % 360) / 45) % 8];
const roundM = (m: number) => (m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50);
/** Collapse OSM's unnamed segment kinds into two words a listener can follow. */
const spoken = (road: string) =>
  ["footpath", "path", "steps", "bike path"].includes(road) ? "walkway" : ["service road", "unnamed road"].includes(road) ? "access road" : road;
const label = (road: string) => (road === "walkway" || road === "access road" ? `the ${road}` : road);

function toSteps(groups: { road: string; meters: number; c0: [number, number][] }[]): Step[] {
  // fold slivers (< 25 m) into the previous group so speech stays short
  const g2: typeof groups = [];
  for (const g of groups) {
    const last = g2[g2.length - 1];
    if (last && g.meters < 25) { last.meters += g.meters; last.c0.push(...g.c0); }
    else g2.push({ ...g, c0: g.c0.slice() });
  }
  const steps: Step[] = [];
  g2.forEach((g, i) => {
    const c = g.c0;
    const start = heading(c);
    if (i === 0) {
      steps.push({ road: g.road, meters: g.meters, at: c[0], say: `Head ${compass(start)} on ${label(g.road)} for ${roundM(g.meters)} meters.` });
      return;
    }
    const prevB = heading(g2[i - 1].c0, true);
    const turn = ((start - prevB + 540) % 360) - 180;
    const dir = Math.abs(turn) < 25 ? "Continue" : Math.abs(turn) < 60 ? (turn > 0 ? "Bear right" : "Bear left") : turn > 0 ? "Turn right" : "Turn left";
    steps.push({ road: g.road, meters: g.meters, at: c[0], say: `${dir} onto ${label(g.road)} for ${roundM(g.meters)} meters.` });
  });
  return steps;
}
