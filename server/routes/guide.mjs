// Guide feature: spoken route script (Gemini, checked by a guard; deterministic template otherwise) and ElevenLabs speech.
import fs from "node:fs";
import path from "node:path";
import { readBody, send } from "../lib/http.mjs";
import { GEMINI_KEY, GEMINI_MODEL, gemini } from "../lib/gemini.mjs";

const RUPD = "732-932-7111";
// Guidance must be fast: past this, the deterministic script speaks instead.
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 8000);
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";

const fmtMin = (m) => (m < 1.5 ? "about a minute" : `about ${Math.round(m)} minutes`);

/** Built only from the route data. Always correct; used when Gemini is off or fails the check. */
function templateScript(g) {
  if (g.shelter_in_place) return `Flood water is already around ${g.start}. Do not walk or drive through it. Move to the highest floor you can reach and call 9 1 1. Rutgers police: ${RUPD}.`;
  const steps = g.steps.slice(0, 4).map((s) => s.say).join(" ");
  const avoid = g.avoid.length ? ` Avoid ${g.avoid.slice(0, 2).join(" and ")}, flooded in this scenario.` : "";
  return `Raritan flood guidance. From ${g.start}, walk to ${g.dest}, ${fmtMin(g.minutes)}. ${steps}${avoid} This route only avoids flooding we know about, so turn back if you see water. If you are in danger, call 9 1 1.`;
}

export default function register(api, ctx) {
  const roadNames = JSON.parse(fs.readFileSync(path.join(ctx.webData, "roads.json"), "utf8")).names.filter((n) => /[A-Z]/.test(n[0]) && n.length > 4);
  const placeNames = JSON.parse(fs.readFileSync(path.join(ctx.webData, "places.json"), "utf8")).map((p) => p.name);

  /** Reject any script naming a road or place that is not in this route's data, ending mid-sentence, or calling it safe. */
  function checkScript(script, g) {
    const allowed = [g.start, g.dest, ...g.steps.map((s) => s.road), ...g.avoid].filter(Boolean).map((s) => s.toLowerCase());
    const lower = script.toLowerCase();
    const problems = [...roadNames, ...placeNames]
      .filter((n) => { const k = n.toLowerCase(); return lower.includes(k) && !allowed.some((a) => a.includes(k) || k.includes(a)); })
      .map((n) => `names "${n}", which is not on this route`);
    if (!/[.!?]["')]?$/.test(script.trim())) problems.push("ends mid-sentence");
    if (/\bsafe route\b|\bguaranteed\b|\bcompletely safe\b/i.test(script)) problems.push("claims the route is safe");
    return problems;
  }

  async function guide(g) {
    const base = templateScript(g);
    if (g.shelter_in_place || !GEMINI_KEY) return { script: base, by: "template", check: [] };
    try {
      let script = await gemini({ timeoutMs: GEMINI_TIMEOUT_MS, temperature: 0.3, parts: `You write spoken emergency guidance for a Rutgers student during a Raritan River flood.
Use ONLY the facts in this JSON. Do not add streets, buildings, distances or times that are not in it.
Rules: 2 to 4 short sentences, under 75 words, plain words, imperative voice. Name the destination and walking time.
Mention at most the first three steps and at most two roads to avoid. Never say the route is safe; say it avoids the flooding we know about.
End with exactly: "If you are in danger, call 9 1 1."
JSON: ${JSON.stringify({ start: g.start, destination: g.dest, minutes: Math.round(g.minutes), meters: Math.round(g.meters), steps: g.steps.slice(0, 5).map((s) => s.say), avoid: g.avoid.slice(0, 3), scenario: g.scenario })}` });
      const problems = checkScript(script, g);
      if (problems.length) return { script: base, by: "template", check: problems, rejected: script };
      const fixes = [];   // the 911 line is fixed text, so the model doesn't get to drop it
      if (!/9\s?1\s?1/.test(script)) { script = `${script.replace(/\s+$/, "")} If you are in danger, call 9 1 1.`; fixes.push("911 line appended"); }
      return { script, by: `gemini (${GEMINI_MODEL})`, check: [], fixes };
    } catch (e) {
      return { script: base, by: "template", check: [`gemini unavailable: ${e.message}`] };
    }
  }

  api.post("/api/guide", async (req, res) => send(res, 200, await guide(await readBody(req))));
  api.post("/api/tts", async (req, res) => {
    if (!ELEVEN_KEY) return send(res, 501, { error: "ELEVENLABS_API_KEY not set" });
    const { text } = await readBody(req);
    if (!text || text.length > 900) return send(res, 400, { error: "text required, max 900 chars" });
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.6, similarity_boost: 0.8 } }), signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`elevenlabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
    send(res, 200, Buffer.from(await r.arrayBuffer()), "audio/mpeg");
  });
}
