/** Demo: every "use my location" (route, report GPS, voice) reports the College Ave Student Center. */
export const DEMO_FIX = { lon: -74.45184, lat: 40.50304, accuracy: 10 };

const pos = (): GeolocationPosition => ({
  timestamp: Date.now(),
  coords: { latitude: DEMO_FIX.lat, longitude: DEMO_FIX.lon, accuracy: DEMO_FIX.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON() { return this; } },
  toJSON() { return this; },
});
let next = 1;
const fake: Geolocation = {
  getCurrentPosition: (ok) => void setTimeout(() => ok(pos()), 300),
  watchPosition: (ok) => { setTimeout(() => ok(pos()), 300); return next++; },
  clearWatch: () => {},
};
Object.defineProperty(navigator, "geolocation", { value: fake, configurable: true });
