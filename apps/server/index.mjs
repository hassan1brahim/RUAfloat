/** HackRU-26 admin API — original implementation (Express) hitting public NOAA/USGS/OSM sources directly.
 * Not a port of any team member's own pipeline; see docs/HACKRU_PLAN.md for how this fits the team's scope. */
import express from "express";
import cors from "cors";
import live from "./routes/live.mjs";
import nwm from "./routes/nwm.mjs";
import map from "./routes/map.mjs";
import sensors from "./routes/sensors.mjs";
import reports from "./routes/reports.mjs";
import cameras from "./routes/cameras.mjs";
import dispatch from "./routes/dispatch.mjs";
import { cached } from "./lib/cache.mjs";
import { fetchRoads, fetchPlacesAndBuildings } from "./lib/overpass.mjs";
import { fetchNwm, fetchLive } from "./lib/noaa.mjs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "6mb" }));

const api = express.Router();
api.use(live);
api.use(nwm);
api.use(map);
api.use(sensors);
api.use(reports);
api.use(cameras);
api.use(dispatch);
app.use("/api", api);

process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e));

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`HackRU-26 admin API on :${PORT}`);
  // Fire-and-forget: Overpass/NOAA are the slow first calls (10-60s). Warm them in the background so the
  // first real dashboard load doesn't eat that latency. Safe no-op if already warm.
  Promise.allSettled([
    cached("osm-roads", 60 * 60_000, fetchRoads),
    cached("osm-places", 60 * 60_000, fetchPlacesAndBuildings),
    cached("nwm", 10 * 60_000, fetchNwm),
    cached("live", 60_000, fetchLive),
  ]).then((results) => console.log("Cache warm-up:", results.map((r) => r.status)));
});
