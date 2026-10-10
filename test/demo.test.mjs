import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LINKS, check, urlFor } from "../scripts/demo_links.mjs";
import { tokenOk } from "../server/routes/sensors.mjs";

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../web/public/data/${p}`, import.meta.url), "utf8"));
const data = {
  names: new Set([...read("starts.json"), ...read("places.json").filter((p) => p.kind === "gather")].map((s) => s.name.toLowerCase())),
  series: read("ida.json").series,
};

test("every demo link points at a real start, time and stage", () => {
  for (const l of LINKS) assert.deepEqual(check(l.params, data), [], l.slug);
});

test("broken demo links are caught", () => {
  assert.match(check({ scenario: "ida", t: "2021-09-02T16", from: "Scot Hall" }, data)[0], /unknown start/);
  assert.match(check({ scenario: "ida", t: "2020-01-01T00" }, data)[0], /outside the Ida replay/);
  assert.match(check({ scenario: "whatif", stage: "60" }, data)[0], /outside the 15-45/);
  assert.match(check({ scenario: "ida", guide: "1" }, data)[0], /needs from=/);
});

test("link URLs encode names", () => {
  assert.equal(urlFor("https://x.dev/", { from: "Scott Hall", guide: "1" }), "https://x.dev/?from=Scott+Hall&guide=1");
});

test("sensor token: constant-time match, empty token rejects everything", () => {
  assert.equal(tokenOk("abc", "abc"), true);
  assert.equal(tokenOk("abd", "abc"), false);
  assert.equal(tokenOk("ab", "abc"), false);
  assert.equal(tokenOk(undefined, "abc"), false);
  assert.equal(tokenOk("", ""), false);
});
