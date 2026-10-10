/** Live OpenStreetMap data via the public Overpass API — queried fresh per request (cached by the route layer),
 * rather than a prebuilt road-graph/building dataset. Independent of any team member's own data pipeline. */
// The public overpass-api.de instance throttles/504s under repeated heavy queries; fall back to a mirror.
const OVERPASS_MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const UA = "hackru26-admin/0.1 (contact: team)";
const CAMPUS = { s: 40.40, w: -74.62, n: 40.60, e: -74.30 }; // wide area, only used for sparse point lookups (hospitals/police/fire)
const RIVER_CORRIDOR = { s: 40.465, w: -74.50, n: 40.535, e: -74.42 }; // New Brunswick/Highland Park/Rutgers core — roads+buildings query stays here, not the whole region, or the road graph is tens of thousands of segments and the risk fusion blocks the event loop

async function runQuery(ql) {
  let lastError;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
        body: `data=${encodeURIComponent(ql)}`,
        signal: AbortSignal.timeout(50000),
      });
      if (!r.ok) throw new Error(`${url} -> ${r.status}`);
      return await r.json();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

const bboxStr = (b) => `${b.s},${b.w},${b.n},${b.e}`;

/** Walkable + drivable road segments as simple polylines with a name and a vehicle/walk flag. */
export async function fetchRoads() {
  const ql = `[out:json][timeout:55];
    way["highway"]["highway"!~"^(construction|proposed|raceway|motorway_link|service|track)$"](${bboxStr(RIVER_CORRIDOR)});
    out geom;`;
  const data = await runQuery(ql);
  const roads = (data.elements || [])
    .filter((el) => el.type === "way" && el.geometry?.length > 1)
    .map((el) => ({
      id: el.id,
      name: el.tags?.name || el.tags?.highway?.replace(/_/g, " ") || "unnamed road",
      vehicle: !["footway", "path", "steps", "pedestrian", "cycleway", "track"].includes(el.tags?.highway),
      coords: el.geometry.map((g) => [g.lon, g.lat]),
    }));
  // Defense in depth: even a "small" bbox can return a surprising number of segments in a dense area;
  // cap it so the risk-fusion pass (lib/risk.mjs) can never block the event loop for long.
  if (roads.length > 5000) { console.warn(`overpass returned ${roads.length} road segments, capping to 5000`); return roads.slice(0, 5000); }
  return roads;
}

/** Hospitals, police, fire stations, and named Rutgers-area buildings near the river corridor — point locations only. */
export async function fetchPlacesAndBuildings() {
  const ql = `[out:json][timeout:55];
    (
      node["amenity"~"^(hospital|police|fire_station)$"](${bboxStr(CAMPUS)});
      way["amenity"~"^(hospital|police|fire_station)$"](${bboxStr(CAMPUS)});
      way["building"]["name"](${bboxStr(RIVER_CORRIDOR)});
    );
    out center tags;`;
  const data = await runQuery(ql);
  const places = [], buildings = [];
  const kindOf = (a) => (a === "hospital" ? "hospital" : a === "police" ? "police" : a === "fire_station" ? "fire" : null);
  for (const el of data.elements || []) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const kind = kindOf(el.tags?.amenity);
    if (kind) places.push({ id: el.id, name: el.tags?.name || kind, kind, lat, lon });
    else if (el.tags?.building && el.tags?.name) buildings.push({ id: el.id, name: el.tags.name, use: el.tags.building, lat, lon });
  }
  return { places, buildings };
}
