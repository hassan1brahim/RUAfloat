import test from "node:test";
import assert from "node:assert/strict";
import { parseScenario } from "../server/routes/scenario.mjs";

test("scenario: only well-formed drills are accepted", () => {
  assert.deepEqual(parseScenario({ mode: "live" }), { mode: "live" });
  assert.deepEqual(parseScenario({ mode: "ida", t: "2021-09-02T16:00:00+00:00" }), { mode: "ida", t: "2021-09-02T16" });
  assert.deepEqual(parseScenario({ mode: "whatif", stage: "33.04" }), { mode: "whatif", stage: 33 });
  for (const bad of [{}, { mode: "ida" }, { mode: "ida", t: "<script>" }, { mode: "whatif", stage: 99 }, { mode: "flood" }]) assert.equal(parseScenario(bad), null);
});

test("scenario: admin token required, and a student stream gets the change", async () => {
  process.env.ADMIN_TOKEN = "adm1n";
  const { server } = await import(`../server/index.mjs?scenario${Date.now()}`);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const post = (token, body) => fetch(`${base}/api/scenario`, { method: "POST", headers: { "Content-Type": "application/json", ...(token && { "x-admin-token": token }) }, body: JSON.stringify(body) });
  const ctrl = new AbortController();
  try {
    assert.equal((await post(null, { mode: "whatif", stage: 33 })).status, 401);
    assert.equal((await post("adm1n", { mode: "whatif", stage: 999 })).status, 400);
    const stream = await fetch(`${base}/api/scenario/stream`, { signal: ctrl.signal });
    const reader = stream.body.getReader(), dec = new TextDecoder();
    const next = async () => JSON.parse(/data: (.*)\n\n/.exec(dec.decode((await reader.read()).value))[1]);
    assert.equal((await next()).mode, "live");                       // current state on connect
    assert.equal((await post("adm1n", { mode: "ida", t: "2021-09-02T16" })).status, 200);
    assert.deepEqual(await next(), { ...(await (await fetch(`${base}/api/scenario`)).json()) });
    assert.equal((await (await fetch(`${base}/api/scenario`)).json()).t, "2021-09-02T16");
  } finally {
    ctrl.abort();
    server.closeAllConnections();
    server.close();
  }
});
