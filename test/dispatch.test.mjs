import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDispatch, nearestUnits } from "../server/lib/dispatch.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-"));
const target = { target: "River Road", kind: "road", lon: -74.45, lat: 40.5, unit: "RUPD" };

test("nearest units: police, fire and hospital only, closest first", () => {
  const places = [
    { name: "Far fire", kind: "fire", lon: -74.40, lat: 40.5 },
    { name: "Shelter", kind: "gather", lon: -74.45, lat: 40.5 },
    { name: "Near police", kind: "police", lon: -74.451, lat: 40.5 },
  ];
  assert.deepEqual(nearestUnits(places, -74.45, 40.5).map((u) => u.name), ["Near police", "Far fire"]);
});

test("dispatch walks pending -> cleared and survives a restart", () => {
  const dir = tmp(), d = createDispatch({ liveDir: dir });
  const rec = d.add(target);
  for (const from of ["pending", "acknowledged", "en-route", "on-scene"]) d.advance(rec.id, from);
  const again = createDispatch({ liveDir: dir }).list()[0];
  assert.equal(again.status, "cleared");
  assert.deepEqual(again.history.map((h) => h.status), ["pending", "acknowledged", "en-route", "on-scene", "cleared"]);
});

test("two screens clicking the same step can't skip one", () => {
  const d = createDispatch({ liveDir: tmp() }), rec = d.add(target);
  d.advance(rec.id, "pending");
  assert.throws(() => d.advance(rec.id, "pending"), (e) => e.status === 409 && e.current.status === "acknowledged");
  assert.equal(d.list()[0].status, "acknowledged");
});

test("one open dispatch per target; bad input rejected", () => {
  const d = createDispatch({ liveDir: tmp() });
  d.add(target);
  assert.throws(() => d.add(target), (e) => e.status === 409);
  assert.throws(() => d.add({ ...target, target: "Other", unit: " " }), /unit required/);
  assert.throws(() => d.add({ ...target, target: "Other", kind: "car" }), (e) => e.status === 400);
});
