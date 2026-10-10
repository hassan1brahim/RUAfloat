// Dispatch: admin sends a unit to a flagged road or building; the unit console (/unit.html) moves it to "cleared".
// Records stay on this server; nothing reaches a real station.
import fs from "node:fs";
import path from "node:path";
import { readBody, send } from "../lib/http.mjs";
import { createDispatch, nearestUnits } from "../lib/dispatch.mjs";

export default function register(api, ctx) {
  const d = createDispatch({ liveDir: ctx.liveData });
  ctx.dispatch = d;
  const places = JSON.parse(fs.readFileSync(path.join(ctx.webData, "places.json"), "utf8"));

  api.get("/api/dispatch", async (req, res) => send(res, 200, d.list()));
  api.get("/api/dispatch/units", async (req, res, m, url) => {
    const lon = Number(url.searchParams.get("lon")), lat = Number(url.searchParams.get("lat"));
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return send(res, 400, { error: "lon and lat required" });
    send(res, 200, nearestUnits(places, lon, lat));
  });
  api.post("/api/dispatch", async (req, res) => {
    send(res, 200, d.add(await readBody(req)));
  });
  api.post(/^\/api\/dispatch\/([a-f0-9]{8})\/advance$/, async (req, res, m) => {
    try {
      send(res, 200, d.advance(m[1], (await readBody(req)).from));
    } catch (e) {
      if (e.current) return send(res, 409, { error: e.message, current: e.current });
      throw e;
    }
  });
}
