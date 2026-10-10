// Street water sensors: ultrasonic distance readings -> water depth -> road status.

/** Depth tiers (cm). NWS: ~15 cm of moving water can knock an adult down; ~30 cm can float a car. */
export const TIERS = { caution: 3, closedWalking: 15, closedVehicles: 30 };

/** A reading older than this no longer counts as an observation. */
export const STALE_MS = 15 * 60e3;

/** Readings kept per sensor for the sparkline. */
export const HISTORY = 60;

/** Water depth from the sensor's distance to the surface; null if the reading is implausible. */
export function depthCm(mountCm, distanceCm) {
  if (!(distanceCm > 0) || distanceCm > mountCm + 50) return null;
  return Math.max(0, Math.round((mountCm - distanceCm) * 10) / 10);
}

/** Road status for one depth. */
export function statusFor(depth) {
  if (depth == null) return "no_reading";
  if (depth >= TIERS.closedVehicles) return "closed_vehicles";
  if (depth >= TIERS.closedWalking) return "closed_walking";
  if (depth >= TIERS.caution) return "caution";
  return "dry";
}

export function createSensors(config, now = () => Date.now()) {
  const history = new Map();

  function addReading(id, body) {
    const s = config.find((c) => c.id === id);
    if (!s) throw Object.assign(new Error("unknown sensor"), { status: 404 });
    const distance = Number(body?.distance_cm);
    const depth = depthCm(s.mount_cm, distance);
    if (depth == null) throw Object.assign(new Error("implausible distance_cm"), { status: 400 });
    const reading = { distance_cm: distance, depth_cm: depth, time: new Date(now()).toISOString() };
    history.set(id, [...(history.get(id) || []), reading].slice(-HISTORY));
    return { id, ...reading, status: statusFor(depth) };
  }

  function list() {
    return config.map((s) => {
      const h = history.get(s.id) || [];
      const r = h.at(-1);
      const fresh = r && now() - Date.parse(r.time) <= STALE_MS;
      return { id: s.id, name: s.name, road: s.road, lat: s.lat, lon: s.lon, mount_cm: s.mount_cm,
        reading: r || null, history: h, stale: !!r && !fresh, status: statusFor(fresh ? r.depth_cm : null) };
    });
  }

  return { addReading, list };
}
