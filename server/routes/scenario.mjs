// Shared scenario: the admin runs a drill (Ida replay or a What-if level) and every student screen follows it live.
// GET /api/scenario · GET /api/scenario/stream (server-sent events) · POST /api/scenario (admin token).
import { readBody, send } from "../lib/http.mjs";
import { tokenOk } from "./sensors.mjs";

/** Validates a scenario sent by the admin view; anything malformed is refused, never half-applied. */
export function parseScenario(b) {
  if (b?.mode === "live") return { mode: "live" };
  if (b?.mode === "ida" && typeof b.t === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}/.test(b.t)) return { mode: "ida", t: b.t.slice(0, 13) };
  if (b?.mode === "whatif" && Number(b.stage) >= 10 && Number(b.stage) <= 50) return { mode: "whatif", stage: Math.round(Number(b.stage) * 10) / 10 };
  return null;
}

export default function register(api) {
  let state = { mode: "live", at: new Date().toISOString() };
  const clients = new Set();
  const push = () => { const msg = `data: ${JSON.stringify(state)}\n\n`; for (const res of clients) res.write(msg); };
  setInterval(() => { for (const res of clients) res.write(": keepalive\n\n"); }, 25_000).unref();   // proxies drop silent connections; unref: never keeps the process alive on its own

  api.get("/api/scenario", async (req, res) => send(res, 200, state));
  api.get("/api/scenario/stream", async (req, res) => {
    if (clients.size >= 500) return send(res, 503, { error: "too many listeners" });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });
  api.post("/api/scenario", async (req, res) => {
    if (!tokenOk(req.headers["x-admin-token"], process.env.ADMIN_TOKEN || "")) return send(res, 401, { error: "admin token required" });
    const next = parseScenario(await readBody(req, 2_000));
    if (!next) return send(res, 400, { error: "mode live, ida with t, or whatif with stage 10-50 ft" });
    state = { ...next, at: new Date().toISOString() };
    push();
    send(res, 200, state);
  });
}
