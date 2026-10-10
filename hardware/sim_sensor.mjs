// Fake sensor for demos and for testing without hardware: water rises to a peak, holds, then drains.
// Usage: SENSOR_TOKEN=... npm run sensor:sim -- [peak_cm=45] [seconds=60] [sensor=river-rd-low] [mount_cm=250]
const [peak = 45, seconds = 60, id = "river-rd-low", mount = 250] = process.argv.slice(2).map((v, i) => (i === 2 ? v : +v));
const API = process.env.API || "http://localhost:8787";
const TOKEN = process.env.SENSOR_TOKEN;
if (!TOKEN) { console.error("set SENSOR_TOKEN (same value as the server)"); process.exit(1); }

const steps = Math.max(6, Math.round(seconds / 2));
for (let i = 0; i <= steps; i++) {
  const p = i / steps; // rise for 40%, hold for 30%, drain for 30%
  const depth = p < 0.4 ? (p / 0.4) * peak : p < 0.7 ? peak : ((1 - p) / 0.3) * peak;
  const distance_cm = Math.round((mount - depth + (Math.random() - 0.5) * 2) * 10) / 10;
  const r = await fetch(`${API}/api/sensors/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "x-sensor-token": TOKEN }, body: JSON.stringify({ distance_cm }) });
  const j = await r.json();
  console.log(new Date().toLocaleTimeString(), `depth ${j.depth_cm ?? "?"} cm`, r.status, j.status ?? j.error);
  await new Promise((res) => setTimeout(res, (seconds * 1000) / steps));
}
