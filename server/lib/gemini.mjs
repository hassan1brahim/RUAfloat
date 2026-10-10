// One Gemini client for every AI use (route script, image checks, voice). Returns text, or parsed JSON when json=true.
export const GEMINI_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

export async function gemini({ parts, json = false, timeoutMs = 20000, maxTokens = 4096, temperature, model = GEMINI_MODEL }) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set");
  const generationConfig = { maxOutputTokens: maxTokens, thinkingConfig: { thinkingLevel: "low" } };
  if (json) generationConfig.responseMimeType = "application/json";
  if (temperature != null) generationConfig.temperature = temperature;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({ contents: [{ parts: typeof parts === "string" ? [{ text: parts }] : parts }], generationConfig }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const c = (await r.json()).candidates?.[0];
  if (c?.finishReason !== "STOP") throw new Error(`gemini stopped early (${c?.finishReason})`);
  const text = (c.content?.parts || []).map((p) => p.text || "").join("").trim();
  return json ? JSON.parse(text) : text;
}
