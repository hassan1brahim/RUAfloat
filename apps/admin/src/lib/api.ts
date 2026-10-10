/** Typed client for our own admin API server (apps/server), proxied at /api/* in dev (next.config.mjs). */

export type Live = {
  fetchedAt: string;
  stale: boolean;
  staleError?: string;
  gauge?: {
    name: string; observedFt: number; observedAt: string; floodCategory: string;
    forecastFt: number | null; forecastAt: string | null;
    impacts: { stageFt: number; statement: string }[];
    history: [string, number][]; forecastSeries: [string, number][];
  };
  gaugeError?: string;
  alerts?: { event: string; headline: string; severity: string; instruction?: string }[];
  alertsError?: string;
};

type GeoJsonLike = { type: "FeatureCollection"; features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };

export type Nwm = {
  fetchedAt: string;
  stale: boolean;
  staleError?: string;
  rapidOnset: GeoJsonLike; highWaterArrival: GeoJsonLike; highWaterProbability: GeoJsonLike; inundationExtent: GeoJsonLike;
  errors: Record<string, string>;
};

export type Tier = "closed" | "watch";
export type EvidenceSource = "sensor" | "report-confirmed" | "report-unconfirmed" | "noaa-extent" | "noaa-reach";
export type Evidence = { source: EvidenceSource; text: string };
export type RoadRisk = { id: number; name: string; vehicle: boolean; coords: [number, number][]; tier: Tier; evidence: Evidence[]; closedBy: EvidenceSource | null };
export type BuildingRisk = { id: number; name: string; use: string; lat: number; lon: number; tier: Tier; evidence: Evidence[]; closedBy: EvidenceSource | null };
export type Place = { id: number; name: string; kind: "hospital" | "police" | "fire"; lat: number; lon: number };

export type SourceFreshness = { fetchedAt: string | null; stale: boolean; error?: string };
export type MapData = {
  fetchedAt: string;
  freshness: { osmRoads: SourceFreshness; osmPlaces: SourceFreshness; nwm: SourceFreshness };
  places: Place[];
  roadsAtRisk: RoadRisk[];
  buildingsAtRisk: BuildingRisk[];
  nwmSummary: { reaches: { rapidOnset: number; highWaterArrival: number; highWaterProbability: number }; errors: Record<string, string>; inundationExtent: GeoJsonLike };
};

export type Camera = { id: string; name: string; lat: number | null; lon: number | null; image: string | null; gauge: { stageFt: number; category: string; at: string } | null };
export type CamerasResponse = { fetchedAt: string; stale: boolean; staleError?: string; cameras: Camera[] };
export type Sensor = { id: string; name: string; road: string; lat: number; lon: number; mountCm: number; note?: string; latest: { depthCm: number; at: string } | null; history: { at: string; distanceCm: number; depthCm: number }[] };
export type Report = { id: string; time: string; lat: number; lon: number; note?: string; depthCm: number | null; ext: string | null; reporterId?: string };
export type DispatchStatus = "pending" | "acknowledged" | "en-route" | "on-scene" | "cleared";
export type DispatchPing = {
  id: string; target: string; kind: "road" | "building"; lat: number; lon: number; note?: string; unit: string | null;
  createdAt: string; status: DispatchStatus; history: { status: DispatchStatus; at: string }[];
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export const api = {
  live: () => getJson<Live>("/api/live"),
  nwm: () => getJson<Nwm>("/api/nwm"),
  map: () => getJson<MapData>("/api/map"),
  cameras: () => getJson<CamerasResponse>("/api/cameras"),
  sensors: () => getJson<Sensor[]>("/api/sensors"),
  reports: () => getJson<Report[]>("/api/reports"),
  dispatches: () => getJson<DispatchPing[]>("/api/dispatch"),
  signalDispatch: (body: { target: string; kind: "road" | "building"; lat: number; lon: number; unit: string; note?: string }) =>
    fetch("/api/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<DispatchPing>),
  setDispatchStatus: (id: string, status?: DispatchStatus) =>
    fetch(`/api/dispatch/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).then((r) => r.json() as Promise<DispatchPing>),
};
