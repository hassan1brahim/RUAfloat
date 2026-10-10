/** The main admin map feed: live OSM roads/buildings/places fused with NOAA's live flood data and
 * local sensor/report observations. Replaces a prebuilt road-graph + elevation grid with live queries. */
import { Router } from "express";
import { cached } from "../lib/cache.mjs";
import { fetchRoads, fetchPlacesAndBuildings } from "../lib/overpass.mjs";
import { fetchNwm } from "../lib/noaa.mjs";
import { computeRoadRisk, computeBuildingRisk } from "../lib/risk.mjs";
import { readStore } from "../lib/jsonStore.mjs";
import { ah } from "../lib/asyncHandler.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SENSORS_CONFIG = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../sensors.config.json"), "utf8"));

const router = Router();

/** Fetch+cache one source, falling back to an empty-but-valid shape if it has never once succeeded. */
async function softCached(key, ttlMs, compute, emptyFallback) {
  try {
    return await cached(key, ttlMs, compute);
  } catch (e) {
    return { value: emptyFallback, fetchedAt: null, stale: true, error: String(e.message || e) };
  }
}

router.get("/map", ah(async (req, res) => {
  const [roadsR, placesR, nwmR] = await Promise.all([
    softCached("osm-roads", 60 * 60_000, fetchRoads, []),
    softCached("osm-places", 60 * 60_000, fetchPlacesAndBuildings, { places: [], buildings: [] }),
    softCached("nwm", 10 * 60_000, fetchNwm, { rapidOnset: { features: [] }, highWaterArrival: { features: [] }, highWaterProbability: { features: [] }, inundationExtent: { features: [] }, errors: {} }),
  ]);
  const readings = readStore("sensor-readings", {});
  const sensors = SENSORS_CONFIG.map((s) => ({ ...s, latest: (readings[s.id] || []).at(-1) ? { depthCm: readings[s.id].at(-1).depthCm, at: readings[s.id].at(-1).at } : null }));
  const reports = readStore("reports", []);
  const nwm = nwmR.value;

  res.json({
    fetchedAt: new Date().toISOString(),
    freshness: {
      osmRoads: { fetchedAt: roadsR.fetchedAt, stale: roadsR.stale, error: roadsR.error },
      osmPlaces: { fetchedAt: placesR.fetchedAt, stale: placesR.stale, error: placesR.error },
      nwm: { fetchedAt: nwmR.fetchedAt, stale: nwmR.stale, error: nwmR.error },
    },
    places: placesR.value.places,
    roadsAtRisk: computeRoadRisk(roadsR.value, nwm, sensors, reports),
    buildingsAtRisk: computeBuildingRisk(placesR.value.buildings, nwm, sensors, reports),
    nwmSummary: {
      reaches: { rapidOnset: nwm.rapidOnset.features.length, highWaterArrival: nwm.highWaterArrival.features.length, highWaterProbability: nwm.highWaterProbability.features.length },
      errors: nwm.errors || {},
      inundationExtent: nwm.inundationExtent,
    },
  });
}));

export default router;
