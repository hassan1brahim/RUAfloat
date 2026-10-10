import test from "node:test";
import assert from "node:assert/strict";
import { feed, rankBuildings, reviewQueue, riseDm, roadTimeline, stageAt, NEVER } from "../server/lib/admin.mjs";

const dm = (ft) => riseDm(ft);   // threshold (dm) reached at a Bound Brook stage
const B = (id, touchFt, deepFt, use = "ACAD-Lab") => ({ id, name: id, use, site: "X", lon: 0, lat: 0, touch: touchFt ? dm(touchFt) : NEVER, deep: deepFt ? dm(deepFt) : NEVER });

test("stage and rise convert both ways", () => {
  assert.equal(riseDm(17), 0);
  assert.ok(Math.abs(stageAt(dm(30)) - 30) <= 0.2);   // the grid stores 10 cm steps (~0.33 ft)
  assert.equal(stageAt(NEVER), null);
});

test("buildings: reached first, then by feet to go; never-flooding ones dropped", () => {
  const r = rankBuildings([B("far", 40), B("deep", 20, 22), B("near", 31), B("never")], 30, null);
  assert.deepEqual(r.top.map((b) => [b.id, b.status]), [["deep", "deep"], ["near", "near"], ["far", "dry"]]);
  assert.ok(Math.abs(r.top[1].margin_ft - 1) <= 0.2);
  assert.equal(r.summary.deep, 1);
});

test("buildings: the outlook gives the time water reaches the walls", () => {
  const outlook = [["2026-10-10T18:00Z", 29], ["2026-10-10T21:00Z", 31.5], ["2026-10-11T00:00Z", 33]];
  const [b] = rankBuildings([B("lab", 31)], 28, outlook).top;
  assert.equal(b.reached_at, "2026-10-10T21:00Z");
});

test("housing reached is counted separately", () => {
  assert.equal(rankBuildings([B("dorm", 20, null, "RES-Dorm"), B("lab", 20)], 25, null).summary.housing_reached, 1);
});

const roads = { names: ["River Road", "footpath", "Hill Road"], edges: [
  // [a, b, meters, walk dm, name, geomStart, geomLen, vehicles dm, first water dm]
  [0, 1, 100, dm(26.5), 0, 0, 2, dm(27.5), dm(26)],
  [1, 2, 50, dm(20), 1, 0, 2, dm(21), dm(19)],
  [2, 3, 80, dm(35), 2, 0, 2, dm(36), dm(34)],
] };

test("roads: closed now, closing in the outlook, generic paths ignored", () => {
  const outlook = [["2026-10-11T00:00Z", 30], ["2026-10-11T06:00Z", 36]];
  const r = roadTimeline(roads, 27, outlook);
  assert.deepEqual(r.roads.map((x) => [x.name, x.status]), [["River Road", "closed"], ["Hill Road", "closing"]]);
  assert.equal(r.roads[1].closes_at, "2026-10-11T06:00Z");
});

test("roads: a sensor closes its road even when the model says open", () => {
  const sensor = { name: "River Rd sensor", road: "River Road", status: "closed_walking", reading: { depth_cm: 22 } };
  const [river] = roadTimeline(roads, 18, null, [sensor]).roads;
  assert.equal(river.status, "closed");
  assert.match(river.observed, /22 cm/);
});

test("feed: sensor tier changes, newest first", () => {
  const sensors = [{ name: "S", history: [{ time: "2026-10-10T10:00Z", depth_cm: 0 }, { time: "2026-10-10T10:05Z", depth_cm: 20 }, { time: "2026-10-10T10:10Z", depth_cm: 2 }] }];
  const f = feed({ sensors });
  assert.deepEqual(f.map((e) => e.text), ["S: 2 cm, dry", "S: 20 cm, closed to walking"]);
});

test("review queue: recent, unreviewed, not clearly dry", () => {
  const now = Date.parse("2026-10-10T12:00Z");
  const r = (id, mins, ai, review) => ({ id, time: new Date(now - mins * 60e3).toISOString(), lat: 0, lon: 0, note: "", ai, review });
  const q = reviewQueue([
    r("water", 10, { usable: true, water_on_ground: true }),
    r("dry", 10, { usable: true, water_on_ground: false }),
    r("unclear", 20, { usable: false, error: "photo check failed" }),
    r("done", 5, { water_on_ground: true }, { verdict: "confirmed" }),
    r("old", 400, { water_on_ground: true }),
  ], now);
  assert.deepEqual(q.map((x) => x.id), ["water", "unclear"]);
});

test("roads: the map point is where the road floods first", () => {
  const withNodes = { ...roads, edges: [...roads.edges, [3, 4, 30, dm(24), 0, 0, 2, dm(25), dm(23)]], nodes: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5] };
  const river = roadTimeline(withNodes, 18, null).roads.find((r) => r.name === "River Road");
  assert.deepEqual([river.lon, river.lat], [4, 4]);
});

test("feed: dispatch steps show who went where", () => {
  const d = { unit: "RUPD", target: "River Road", history: [{ status: "pending", at: "2026-10-10T10:00Z" }, { status: "en-route", at: "2026-10-10T10:03Z" }] };
  assert.deepEqual(feed({ dispatches: [d] }).map((e) => e.text), ["Dispatch: RUPD en route at River Road", "Dispatch: RUPD sent to River Road"]);
});
