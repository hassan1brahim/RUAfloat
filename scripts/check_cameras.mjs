// Run the AI check on every river camera's latest image and append the results to the HackRU tally.
// Usage: npm run cameras:check   (needs the API running: npm run dev)
import fs from "node:fs";

const API = process.env.API || "http://localhost:8787";
const OUT = new URL("../data/validation/cameras_hackru.json", import.meta.url);

const tally = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { note: "Live camera AI checks at HackRU F26, graded against the gauge at the same moment.", checks: [] };
const cams = await (await fetch(`${API}/api/cameras`)).json();
for (const cam of cams) {
  if (!cam.file) { console.log(`${cam.name}: no current image`); continue; }
  if (tally.checks.some((c) => c.file === cam.file)) { console.log(`${cam.name}: ${cam.file} already checked`); continue; }
  const r = await fetch(`${API}/api/cameras/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cam.id }) });
  const c = await r.json();
  if (!r.ok) { console.log(`${cam.name}: ${c.error}`); continue; }
  tally.checks.push({ camera: c.camera, file: c.file, image_time: c.time, checked_at: new Date().toISOString(), water_state: c.vision?.water_state,
    image_usable: c.vision?.image_usable, confidence: c.vision?.confidence, seen: c.vision?.change_vs_reference, gauge_ft: c.gauge?.stage, expected: c.expected, agreement: c.agreement, model: c.model });
  console.log(`${c.camera}: ${c.vision?.water_state} | gauge ${c.gauge?.stage} ft | ${c.agreement}`);
}
const n = (a) => tally.checks.filter((c) => c.agreement === a).length;
tally.summary = { checks: tally.checks.length, agrees: n("agrees with gauge"), disagrees: n("DISAGREES with gauge"), no_visual: n("no visual check"), no_gauge: n("no gauge reading") };
fs.writeFileSync(OUT, JSON.stringify(tally, null, 1) + "\n");
console.log("tally:", tally.summary);
