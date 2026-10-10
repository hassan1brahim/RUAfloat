// Conversation feature: a short-lived signed URL for the ElevenLabs agent, so the API key never reaches the browser.
import { send } from "../lib/http.mjs";

const KEY = process.env.ELEVENLABS_API_KEY;
const AGENT = process.env.ELEVENLABS_AGENT_ID;

export default function register(api) {
  api.get("/api/agent/session", async (req, res) => {
    if (!KEY || !AGENT) return send(res, 501, { error: "ElevenLabs agent not set up (run npm run agent:setup)" });
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(AGENT)}`, {
      headers: { "xi-api-key": KEY }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`elevenlabs agent ${r.status}: ${(await r.text()).slice(0, 200)}`);
    send(res, 200, { signedUrl: (await r.json()).signed_url });
  });
}
