import test from "node:test";
import assert from "node:assert/strict";
import { limiter, spaced } from "../server/lib/limit.mjs";

test("limiter: max per window per key, then resets", () => {
  let t = 0;
  const hit = limiter(2, 1000, () => t);
  assert.deepEqual([hit("a"), hit("a"), hit("a"), hit("b")], [true, true, false, true]);
  t = 1000;
  assert.equal(hit("a"), true);
});

test("spaced: calls run one at a time, at least gap apart", async () => {
  let t = 0;
  const waits = [];
  const run = spaced(1000, () => t, async (ms) => { waits.push(ms); t += ms; });
  const out = await Promise.all([run(() => "x"), run(() => "y"), run(() => "z")]);
  assert.deepEqual(out, ["x", "y", "z"]);
  assert.deepEqual(waits, [1000, 1000]);   // first call goes straight away
});

test("spaced: a failed call doesn't block the next", async () => {
  const run = spaced(0);
  await assert.rejects(run(() => { throw new Error("boom"); }));
  assert.equal(await run(() => 1), 1);
});
