// Time ElevenLabs speech through /api/tts: first byte, full file, audio length. Needs the API running with ELEVENLABS_API_KEY.
// Usage: npm run tts:time [runs=3]
const API = process.env.API || "http://localhost:8787";
const runs = +(process.argv[2] || 3);
const TEXT = "Walk to the Busch Student Center, about 25 minutes away. Head north on College Avenue and avoid River Road, flooded in this scenario. If you are in danger, call 9 1 1.";

const health = await (await fetch(`${API}/api/health`)).json();
if (!health.elevenlabs) { console.log("ELEVENLABS_API_KEY not set on the server (/api/health elevenlabs: false)"); process.exit(1); }
for (let i = 1; i <= runs; i++) {
  const t0 = performance.now();
  const r = await fetch(`${API}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `${TEXT} (${i})` }) });
  const reader = r.body.getReader();
  let first = null, bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    first ??= performance.now() - t0;
    bytes += value.length;
  }
  const total = performance.now() - t0;
  // mp3_44100_128 = 16 KB per second of audio
  console.log(`run ${i}: HTTP ${r.status} · first byte ${(first / 1000).toFixed(2)} s · full file ${(total / 1000).toFixed(2)} s · ${(bytes / 1024).toFixed(0)} KB ≈ ${(bytes / 16000).toFixed(1)} s of audio`);
}
