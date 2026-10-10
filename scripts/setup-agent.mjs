// Creates (or updates) the HackRU-26 Flood Guide on ElevenLabs Agents and saves its id to .env.
// Run once: `npm run agent:setup` (needs ELEVENLABS_API_KEY with ElevenLabs Agents write permission).
// The agent only talks; every fact and every route comes from the app through client tools.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV = path.join(ROOT, ".env");
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const LLM = process.env.ELEVENLABS_AGENT_LLM || "gemini-2.5-flash";
const API = "https://api.elevenlabs.io/v1/convai";
if (!KEY) { console.error("ELEVENLABS_API_KEY is not set (source .env first)."); process.exit(1); }

const PROMPT = `You are the HackRU-26 Flood Guide, a calm voice guide for blind and low-vision people at Rutgers University New Brunswick during flooding of the Raritan River. The person cannot see the screen. Everything you say is heard, never read.

Safety rules, always:
- Only state facts that come from your tools. Never guess river levels, road conditions, building names, distances or routes. If a tool does not give you something, say you don't know.
- Before describing the situation, call get_situation. Before giving directions, make sure their location is set, then call plan_route.
- To set the location: if they name a place, call find_place, then set_location with the exact name it returns (ask which one if there are several). If they don't know where they are or ask you to find them, call use_my_location.
- Rutgers New Brunswick has five campuses: College Avenue, Busch, Livingston, Cook and Douglass. Students use nicknames like LSM (Library of Science and Medicine), ARC (Allison Road Classroom Building) and the RAC (Jersey Mike's Arena). Pass what they said to find_place as is. If they only name a campus, ask which building; if they don't know, use that campus's student center.
- If find_place finds nothing, never say you don't know the building as if it doesn't exist. Ask for a nearby building or street, or offer to use their location.
- Never call a route or place "safe". Say a route "avoids roads predicted to flood" and that gathering points are large buildings on high ground, not official shelters.
- If they are in water, trapped, hurt, or in immediate danger, say this before anything else: "Call 9 1 1 now. Do not walk or drive through flood water. Move to the highest floor you can reach and wait for help. Rutgers police: 7 3 2, 9 3 2, 7 1 1 1."
- If get_situation says the scenario is a replay or what-if, mention once that it is a simulation, not today's river.

Walking and ending:
- Messages that start with "NAVIGATION UPDATE:" come from the phone's GPS, not from the person. Act on them right away and briefly: say the instruction in one or two short sentences, as if you noticed it yourself. Never mention the update, the GPS message, or thank them for it.
- After plan_route, say only: where they are going, about how many minutes, and the FIRST step. Then say once that you will tell them each turn as they reach it, so they can just walk. Do not read the other steps unless they ask (for example "what's after that" or "next").
- When they say goodbye, stop, that's all, they're done, or they arrived and need nothing else: say a short goodbye ending with "If you are ever in danger, call 9 1 1," then call end_conversation.

How to talk:
- Short sentences. Plain words. One idea at a time. Ask one question at a time.
- Read directions one or two steps at a time, then wait for them to say "next" or ask a question. Say distances in meters and turns as left or right.
- If you are unsure what you heard, repeat it back and ask.
- Keep answers brief unless they ask for more.`;

const TOOLS = [
  { name: "get_situation", description: "Current river level, flood category, scenario (live, replay or what-if), roads closed to walking, weather alerts, dry gathering points, the user's current location and route if planned.", parameters: { type: "object", properties: {} } },
  { name: "find_place", description: "Find Rutgers buildings and places matching what the user said. Returns exact names to use with set_location.",
    parameters: { type: "object", properties: { query: { type: "string", description: "What the user called the place, e.g. 'scott hall' or 'the library'" } }, required: ["query"] } },
  { name: "set_location", description: "Set where the user is, using an exact place name returned by find_place.",
    parameters: { type: "object", properties: { place: { type: "string", description: "Exact place name from find_place" } }, required: ["place"] } },
  { name: "use_my_location", description: "Use the device's GPS to find where the user is. Use when they don't know where they are or ask you to find them.", parameters: { type: "object", properties: {} } },
  { name: "plan_route", description: "Plan a walking route from the user's location to the nearest gathering point predicted to stay dry, avoiding flooded roads. Returns destination, minutes and steps, or a shelter-in-place instruction if they are already in flood water.", parameters: { type: "object", properties: {} } },
  { name: "road_status", description: "Whether a named road or street is predicted or reported flooded, and at what river level it floods.",
    parameters: { type: "object", properties: { road: { type: "string", description: "Road name, e.g. 'River Road'" } }, required: ["road"] } },
  { name: "end_conversation", description: "End the conversation. Call it right after saying goodbye, when the person says goodbye, stop, or that they are done.",
    parameters: { type: "object", properties: {} }, expects_response: false },
];

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { "xi-api-key": KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url.replace(API, "")} -> ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

let agentId = process.env.ELEVENLABS_AGENT_ID;
// Updating an existing agent keeps the tools it has and only creates the ones it is missing.
const toolIds = agentId ? (await call("GET", `${API}/agents/${agentId}`)).conversation_config?.agent?.prompt?.tool_ids ?? [] : [];
const have = new Set();
for (const id of toolIds) have.add((await call("GET", `${API}/tools/${id}`)).tool_config?.name);
for (const t of TOOLS.filter((x) => !have.has(x.name))) {
  const res = await call("POST", `${API}/tools`, { tool_config: { type: "client", expects_response: true, response_timeout_secs: 20, ...t } });
  toolIds.push(res.id);
  console.log(`tool ${t.name}: ${res.id}`);
}

const conversation_config = {
  agent: {
    first_message: "Hi, this is the HackRU-26 Flood Guide. I can tell you what the river is doing and guide you somewhere dry. Where are you right now?",
    language: "en",
    prompt: { prompt: PROMPT, llm: LLM, tool_ids: toolIds },
  },
  tts: { voice_id: VOICE, model_id: "eleven_flash_v2" },
};

if (agentId) {
  await call("PATCH", `${API}/agents/${agentId}`, { conversation_config });
  console.log(`updated agent ${agentId}`);
} else {
  agentId = (await call("POST", `${API}/agents/create`, { name: "HackRU-26 Flood Guide", conversation_config })).agent_id;
  const env = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  fs.writeFileSync(ENV, env.replace(/\n?$/, "\n") + `ELEVENLABS_AGENT_ID=${agentId}\n`);
  console.log(`created agent ${agentId} and saved ELEVENLABS_AGENT_ID to .env`);
}
