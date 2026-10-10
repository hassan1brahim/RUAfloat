import test from "node:test";
import assert from "node:assert/strict";
import { depthCm, statusFor, createSensors, STALE_MS } from "../server/sensors.mjs";

const CONFIG = [{ id: "s1", name: "Test", road: "River Road", lat: 0, lon: 0, mount_cm: 100 }];

test("depth = mount height - distance, never negative", () => {
  assert.equal(depthCm(100, 80), 20);
  assert.equal(depthCm(100, 103), 0);
});

test("implausible distances are rejected", () => {
  for (const d of [0, -5, NaN, undefined, 151]) assert.equal(depthCm(100, d), null);
});

test("depth tiers: caution, walking closed at 15 cm, vehicles at 30 cm", () => {
  assert.equal(statusFor(0), "dry");
  assert.equal(statusFor(3), "caution");
  assert.equal(statusFor(14.9), "caution");
  assert.equal(statusFor(15), "closed_walking");
  assert.equal(statusFor(30), "closed_vehicles");
  assert.equal(statusFor(null), "no_reading");
});

test("a stale reading stops closing the road", () => {
  let t = Date.parse("2026-10-10T12:00:00Z");
  const s = createSensors(CONFIG, () => t);
  assert.equal(s.addReading("s1", { distance_cm: 60 }).status, "closed_vehicles");
  assert.equal(s.list()[0].status, "closed_vehicles");
  t += STALE_MS + 1;
  assert.equal(s.list()[0].status, "no_reading");
  assert.equal(s.list()[0].stale, true);
});

test("unknown sensor and bad body throw with HTTP status", () => {
  const s = createSensors(CONFIG);
  assert.throws(() => s.addReading("nope", { distance_cm: 50 }), { status: 404 });
  assert.throws(() => s.addReading("s1", { distance_cm: "x" }), { status: 400 });
});

test("server: token required, reading updates status", async () => {
  process.env.SENSOR_TOKEN = "t0ken";
  const { server } = await import(`../server/index.mjs?${Date.now()}`);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const post = (token, body) => fetch(`${base}/api/sensors/river-rd-low`, { method: "POST", headers: { "Content-Type": "application/json", ...(token && { "x-sensor-token": token }) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(null, { distance_cm: 200 })).status, 401);
    assert.equal((await post("wrong", { distance_cm: 200 })).status, 401);
    const ok = await post("t0ken", { distance_cm: 230 });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).status, "closed_walking");
    const list = await (await fetch(`${base}/api/sensors`)).json();
    assert.equal(list[0].status, "closed_walking");
  } finally {
    server.close();
  }
});
