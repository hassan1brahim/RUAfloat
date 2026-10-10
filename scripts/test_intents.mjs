// Spoken-phrase tests for the voice assistant's intent step, through Gemini and through the keyword fallback.
// Usage: npm run test:intents   (GEMINI_API_KEY set: tests both paths; unset: fallback only)
import fs from "node:fs";

const data = (f) => JSON.parse(fs.readFileSync(new URL(`../apps/web/public/data/${f}`, import.meta.url), "utf8"));
const places = data("places.json").map((p) => p.name);
const roads = [...new Set(data("roads.json").names.filter(Boolean))];

// [what the browser heard, expected intent, expected place/road substring or null]
const CASES = [
  ["where should I go", "where_to_go"],
  ["where do I go", "where_to_go"],
  ["how do I get somewhere safe", "where_to_go"],
  ["take me to safety", "where_to_go"],
  ["I'm at Scott Hall", "set_location", "Scott Hall"],
  ["im at scott hall", "set_location", "Scott Hall"],
  ["I am near Scott Hall where do I go", "where_to_go", "Scott Hall"],
  ["use my location", "use_my_location"],
  ["where am I", "use_my_location"],
  ["is River Road flooded", "road_status", "River Road"],
  ["can I walk on George Street", "road_status", "George Street"],
  ["next step", "next_step"],
  ["what's next", "next_step"],
  ["okay now what", "next_step"],
  ["repeat that", "repeat"],
  ["say that again", "repeat"],
  ["what", "repeat"],
  ["help", "help"],
  ["what can you do", "help"],
  ["stop", "stop"],
  ["be quiet", "stop"],
  ["emergency", "emergency"],
  ["I'm stuck in the water", "emergency"],
  ["call 911", "emergency"],
  ["the water is up to my knees", "emergency"],
  ["my car is stuck", "emergency"],
  ["what's the river doing", "status"],
  ["is it flooding", "status"],
  ["is there a flood warning", "status"],
];

async function run(label, createAssist) {
  const a = createAssist();
  let pass = 0;
  const fails = [];
  for (const [text, want, name] of CASES) {
    const r = await a.intent({ text, places, roads });
    const got = r.place || r.road || "";
    const ok = r.intent === want && (!name || got.includes(name));
    if (ok) pass++; else fails.push(`  "${text}" -> ${r.intent}${got ? ` (${got})` : ""}, want ${want}${name ? ` (${name})` : ""}${r.by !== label ? ` [by ${r.by}]` : ""}`);
  }
  console.log(`${label}: ${pass}/${CASES.length}`);
  for (const f of fails) console.log(f);
  return fails.length;
}

let failed = 0;
if (process.env.GEMINI_API_KEY) failed += await run("gemini", (await import("../apps/server/lib/assist.mjs?gemini")).createAssist);
const key = process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY;
failed += await run("rules", (await import("../apps/server/lib/gemini.mjs?nokey").then(() => import("../apps/server/lib/assist.mjs?rules"))).createAssist);
if (key) process.env.GEMINI_API_KEY = key;
process.exit(failed ? 1 : 0);
