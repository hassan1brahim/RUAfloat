// Detection feature: USGS river cameras + AI check, student photo reports.
import fs from "node:fs";
import { readBody, send } from "../lib/http.mjs";
import { createDetect } from "../lib/detect.mjs";
import { adminOk } from "./sensors.mjs";
import { clientIp, limiter, tooMany } from "../lib/limit.mjs";

// Each report runs a Gemini photo check: a few per person, a ceiling for everyone.
const perPerson = limiter(5, 10 * 60e3), overall = limiter(120, 60 * 60e3);

export default function register(api, ctx) {
  const d = createDetect({ liveDir: ctx.liveData });
  ctx.detect = d;
  api.get("/api/cameras", async (req, res) => send(res, 200, await d.cameras()));
  api.post("/api/cameras/check", async (req, res) => { const { id, file } = await readBody(req); send(res, 200, await d.checkCamera(id, file)); });
  api.get("/api/reports", async (req, res) => send(res, 200, d.listReports()));
  api.post("/api/reports", async (req, res) => {
    if (!perPerson(clientIp(req)) || !overall("all")) throw tooMany();
    send(res, 200, await d.addReport(await readBody(req, 6_000_000)));
  });
  api.post(/^\/api\/reports\/([a-f0-9]{8})\/review$/, async (req, res, m) => {
    if (!adminOk(req)) return send(res, 401, { error: "admin token required" });
    send(res, 200, d.review(m[1], (await readBody(req)).verdict));
  });
  api.get(/^\/api\/reports\/([a-f0-9]{8})\/photo$/, async (req, res, m) => {
    const ph = d.photo(m[1]);
    if (!ph) return send(res, 404, { error: "no such report" });
    res.writeHead(200, { "Content-Type": ph.type });
    fs.createReadStream(ph.path).pipe(res);
  });
}
