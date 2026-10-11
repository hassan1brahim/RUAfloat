/**
 * The device's position, as accurate as it gets in a few seconds.
 * Phones often report a rough Wi-Fi/cell fix first and GPS a moment later, so we watch for a while and keep the
 * most accurate reading instead of taking the first one. Never a cached position: the person may have moved.
 * Laptops have no GPS and guess from Wi-Fi (often 50-500 m off); callers show `accuracy` so the user can correct it.
 */
import { DEMO_FIX } from "./demo-location";

export type Fix = { lon: number; lat: number; accuracy: number };

/** Why the last bestPosition() came back empty, in words a student can act on. */
export let locateError = "";

export function bestPosition(o: { maxWaitMs?: number; goodEnoughM?: number; onProgress?: (f: Fix) => void } = {}): Promise<Fix | null> {
  const { maxWaitMs = 8000, goodEnoughM = 25, onProgress } = o;
  return new Promise((resolve) => {
    locateError = "";
    if (DEMO_FIX) return resolve(DEMO_FIX);   // demo: always College Ave
    if (!window.isSecureContext) { locateError = "Location only works on a secure (https) page. Open the app's main link, or choose your building."; return resolve(null); }
    if (!navigator.geolocation) { locateError = "This browser can't share its location. Choose your building."; return resolve(null); }
    let best: Fix | null = null, done = false;
    const finish = () => {
      if (done) return;
      done = true; navigator.geolocation.clearWatch(id); clearTimeout(timer);
      if (!best && !locateError) locateError = "Finding your location took too long. Try again near a window or outdoors, or choose your building.";
      resolve(best);
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lon: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy };
        if (!best || f.accuracy < best.accuracy) { best = f; onProgress?.(f); }
        if (f.accuracy <= goodEnoughM) finish();
      },
      (e) => {   // denied or unavailable: keep whatever we have (maybe nothing), and say why
        locateError = e.code === 1 ? "Location is blocked for this site. Allow it (iPhone: Settings → Privacy → Location Services → Safari Websites), or choose your building."
          : e.code === 2 ? "Your device couldn't find its position. Choose your building instead." : "";
        finish();
      },
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
