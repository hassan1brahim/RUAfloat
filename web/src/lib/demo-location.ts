/** Demo switch (checkbox on "Get me to safety"): when on, every location request reports the Busch Student Center. */
export const DEMO_FIX = { lon: -74.45874, lat: 40.52325, accuracy: 10 };

let on = false;
try { on = localStorage.getItem("demo-loc") === "1"; } catch { /* storage blocked: starts off */ }
export const demoOn = () => on;
export function setDemo(v: boolean) { on = v; try { localStorage.setItem("demo-loc", v ? "1" : "0"); } catch { /* ignore */ } }

const pos = (): GeolocationPosition => ({
  timestamp: Date.now(),
  coords: { latitude: DEMO_FIX.lat, longitude: DEMO_FIX.lon, accuracy: DEMO_FIX.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON() { return this; } },
  toJSON() { return this; },
});
// Wrap the real geolocation so voice features follow the switch too.
const real = navigator.geolocation;
let next = -1;
const wrapped: Geolocation = {
  getCurrentPosition: (ok, err, o) => (on || !real ? void setTimeout(() => ok(pos()), 300) : real.getCurrentPosition(ok, err, o)),
  watchPosition: (ok, err, o) => { if (on || !real) { setTimeout(() => ok(pos()), 300); return next--; } return real.watchPosition(ok, err, o); },
  clearWatch: (id) => { if (id >= 0) real?.clearWatch(id); },
};
Object.defineProperty(navigator, "geolocation", { value: wrapped, configurable: true });
