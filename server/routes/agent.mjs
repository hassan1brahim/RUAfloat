// Conversation feature: a short-lived signed URL for the ElevenLabs agent, so the API key never reaches the browser.
import { send } from "../lib/http.mjs";
import { clientIp, limiter, tooMany } from "../lib/limit.mjs";

const KEY = process.env.ELEVENLABS_API_KEY;
const AGENT = process.env.ELEVENLABS_AGENT_ID;

// Each session spends ElevenLabs credit: a few per person, and a ceiling for everyone together.
const perPerson = limiter(5, 10 * 60e3), overall = limiter(60, 60 * 60e3);

export default function register(api) {
  api.get("/api/agent/session", async (req, res) => {
    if (!KEY || !AGENT) return send(res, 501, { error: "ElevenLabs agent not set up (run npm run agent:setup)" });
    if (!perPerson(clientIp(req)) || !overall("all")) throw tooMany();
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(AGENT)}`, {
      headers: { "xi-api-key": KEY }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`elevenlabs agent ${r.status}: ${(await r.text()).slice(0, 200)}`);
    send(res, 200, { signedUrl: (await r.json()).signed_url });
  });
}
