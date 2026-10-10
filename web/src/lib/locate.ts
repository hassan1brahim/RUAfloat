/**
 * The device's position, as accurate as it gets in a few seconds.
 * Phones often report a rough Wi-Fi/cell fix first and GPS a moment later, so we watch for a while and keep the
 * most accurate reading instead of taking the first one. Never a cached position: the person may have moved.
 * Laptops have no GPS and guess from Wi-Fi (often 50-500 m off); callers show `accuracy` so the user can correct it.
 */
export type Fix = { lon: number; lat: number; accuracy: number };

export function bestPosition(o: { maxWaitMs?: number; goodEnoughM?: number; onProgress?: (f: Fix) => void } = {}): Promise<Fix | null> {
  const { maxWaitMs = 8000, goodEnoughM = 25, onProgress } = o;
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let best: Fix | null = null, done = false;
    const finish = () => { if (done) return; done = true; navigator.geolocation.clearWatch(id); clearTimeout(timer); resolve(best); };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lon: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy };
        if (!best || f.accuracy < best.accuracy) { best = f; onProgress?.(f); }
        if (f.accuracy <= goodEnoughM) finish();
      },
      () => finish(),   // denied or unavailable: whatever we have (maybe nothing)
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );
    const timer = setTimeout(finish, maxWaitMs);
  });
}

/** Polygon approximating a circle of `radiusM` metres, for drawing the accuracy ring. */
export function circle(lon: number, lat: number, radiusM: number, steps = 48) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110570;
  const ring = Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return [lon + (radiusM * Math.cos(a)) / kx, lat + (radiusM * Math.sin(a)) / ky];
  });
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } };
}
