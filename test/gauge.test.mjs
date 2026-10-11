import test from "node:test";
import assert from "node:assert/strict";
import { cleanObserved } from "../server/lib/gauge.mjs";

const P = (t, ft) => ({ validTime: `2026-10-10T${t}:00Z`, primary: ft });

test("a one-off glitch reading is dropped (Bound Brook, 2026-10-10)", () => {
  const out = cleanObserved([P("22:00", 16.85), P("22:15", 16.85), P("22:45", 0.11)]);
  assert.deepEqual(out.map((p) => p.primary), [16.85, 16.85]);
});

test("missing values (-999) are dropped", () => {
  assert.equal(cleanObserved([P("10:00", 17), P("10:15", -999)]).length, 1);
});

test("a real flood rise is kept", () => {
  const rise = [P("00:00", 20), P("01:00", 21.5), P("02:00", 23), P("03:00", 24.4)];   // Ida-like, ~1.5 ft an hour
  assert.equal(cleanObserved(rise).length, 4);
});
