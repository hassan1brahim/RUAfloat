// Voice assistant brain: (1) turn free speech into an intent, (2) explain the app's facts in plain words.
// Both are grounded: the model only sees facts the app computed, and a guard rejects any number or
// street/place name in the answer that is not in those facts. Failures fall back to rules/templates.
import { gemini } from "./gemini.mjs";

const MODEL = process.env.GEMINI_ASSIST_MODEL || "gemini-3.5-flash-lite";
const INTENTS = ["where_to_go", "set_location", "use_my_location", "status", "road_status", "repeat", "next_step", "help", "stop", "emergency", "other"];

export function createAssist() {
  const ask = (prompt, timeoutMs = 6000) => gemini({ parts: prompt, json: true, timeoutMs, maxTokens: 2048, model: MODEL });

  /** Keyword fallback, so the assistant still works without the model. */
  function rules(text, places, roads) {
    const t = text.toLowerCase();
    const place = places.find((p) => t.includes(p.toLowerCase()));
    const road = roads.find((r) => t.includes(r.toLowerCase()));
    if (/\b(911|emergency|help me|drowning|sinking|swept away|(i'?m|i am|we'?re|car is|car'?s) (stuck|trapped|in (the )?water)|water (is )?(up to|over|above) my)\b/.test(t)) return { intent: "emergency" };
    if (/\bstop|quiet|be quiet|pause\b/.test(t)) return { intent: "stop" };
    if (/\brepeat|say (that|it) again|again\b|^(what|huh|sorry|pardon)\W*$/.test(t)) return { intent: "repeat" };
    if (/\b(next|now what|what now|then what|keep going)\b/.test(t)) return { intent: "next_step" };
    if (/\b(my location|where i am|where am i|use gps|locate me)\b/.test(t)) return { intent: "use_my_location" };
    if (road && /flood|closed|open|safe|water|walk|drive|cross|take/.test(t)) return { intent: "road_status", road };
    if (place && /\b(i'?m|i am|at|near)\b/.test(t) && !/\bwhere|\bgo\b|route|direction/.test(t)) return { intent: "set_location", place };
    if (/\bwhere|\bgo\b|evacuat|shelter|safe|route|direction|get out/.test(t)) return { intent: "where_to_go", place };
    if (/\briver|status|flood|warning|alert|forecast|what'?s happening|situation/.test(t)) return { intent: "status" };
    if (/\bhelp|what can (you|i)|commands?\b/.test(t)) return { intent: "help" };
    return { intent: "other" };
  }

  /** Names sharing a word with what was said, best overlap first: the model only sees plausible candidates. */
  function candidates(text, names, max) {
    const words = new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
    const stop = new Set(["street", "road", "avenue", "lane", "drive", "the", "and", "center", "hall", "place"]);
    return names.map((n) => [n, (n.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => words.has(w) && !stop.has(w)).length])
      .filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n);
  }

  async function intent({ text, places = [], roads = [] }) {
    text = String(text || "").slice(0, 300);
    const allPlaces = places, allRoads = roads;
    places = candidates(text, allPlaces, 25);
    roads = candidates(text, allRoads, 25);
    try {
      const j = await ask(`A blind student is talking to a flood-safety voice assistant at Rutgers New Brunswick. Classify what they said.
Return JSON only: {"intent": one of ${JSON.stringify(INTENTS)}, "place": exact name from PLACES or null, "road": exact name from ROADS or null}.
- where_to_go: asks where to go / how to get somewhere safe (may also name where they are).
- set_location: tells where they are. use_my_location: wants GPS. status: river/flood/weather situation.
- road_status: asks about one road. emergency: in danger, trapped, in water, needs 911.
PLACES: ${JSON.stringify(places)}
ROADS: ${JSON.stringify(roads)}
They said: ${JSON.stringify(text)}`, 4000);
      if (!INTENTS.includes(j.intent)) throw new Error("bad intent");
      if (j.place && !places.includes(j.place)) j.place = null;
      if (j.road && !roads.includes(j.road)) j.road = null;
      return { ...j, by: "gemini" };
    } catch (e) {
      return { ...rules(text, places.length ? places : allPlaces, roads.length ? roads : allRoads), by: "rules", note: String(e.message || e) };
    }
  }

  /** Numbers and capitalised names in the answer must appear in the facts. */
  function guard(answer, facts) {
    const factText = JSON.stringify(facts).toLowerCase();
    const problems = [];
    for (const n of answer.match(/\d+(?:\.\d+)?/g) || []) if (!factText.includes(n) && !["9", "1", "911"].includes(n)) problems.push(`number ${n} not in facts`);
    for (const name of answer.match(/\b(?:[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|of|and))*\s+(?:Street|Road|Avenue|Lane|Drive|Hall|Center|Park|Place|Route))\b/g) || [])
      if (!factText.includes(name.toLowerCase())) problems.push(`name "${name}" not in facts`);
    if (/\b(completely safe|guaranteed|no risk)\b/i.test(answer)) problems.push("overclaims safety");
    return problems;
  }

  async function explain({ question, facts, fallback }) {
    try {
      const j = await ask(`You are a calm voice assistant helping a BLIND student during possible flooding at Rutgers New Brunswick.
Answer their question in 2 to 4 short spoken sentences, using ONLY the FACTS JSON. Do not add numbers, places, roads or times that are not in FACTS.
Say clearly what to do if action is needed. Never say anything is completely safe. If danger is possible, mention calling 9 1 1.
Return JSON only: {"answer": string}.
FACTS: ${JSON.stringify(facts)}
QUESTION: ${JSON.stringify(String(question || "").slice(0, 300))}`);
      const answer = String(j.answer || "").trim();
      const problems = guard(answer, facts);
      if (!answer || problems.length) return { answer: fallback, by: "template", check: problems.length ? problems : ["empty answer"] };
      return { answer, by: `gemini (${MODEL})`, check: [] };
    } catch (e) {
      return { answer: fallback, by: "template", check: [String(e.message || e)] };
    }
  }

  return { intent, explain };
}
