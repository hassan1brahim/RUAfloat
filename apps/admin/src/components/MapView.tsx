"use client";
import { MapContainer, TileLayer, GeoJSON, Polyline, CircleMarker, Popup } from "react-leaflet";
import type { DispatchPing, Camera, Sensor, Report, MapData } from "@/lib/api";
import DispatchControl from "./DispatchControl";
import { PLACE_COLOR, TIER_COLOR } from "./Place";

const CAMPUS_CENTER: [number, number] = [40.4994, -74.4454];

export default function MapView({
  mapData, dispatches, cameras, sensors, reports, onSignalDispatch, onAdvanceDispatch,
}: {
  mapData: MapData | null;
  dispatches: DispatchPing[];
  cameras: Camera[];
  sensors: Sensor[];
  reports: Report[];
  onSignalDispatch: (target: string, kind: "road" | "building", lat: number, lon: number, unit: string) => void;
  onAdvanceDispatch: (id: string) => void;
}) {
  const inundation = mapData?.nwmSummary.inundationExtent;

  return (
    <MapContainer center={CAMPUS_CENTER} zoom={14} style={{ height: "100%", width: "100%" }} preferCanvas>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {inundation && inundation.features.length > 0 && (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <GeoJSON data={inundation as any} style={{ color: "#38bdf8", weight: 1, fillColor: "#1d63d6", fillOpacity: 0.35 }} />
      )}

      {(mapData?.roadsAtRisk ?? []).map((r) => {
        const mid = r.coords[Math.floor(r.coords.length / 2)];
        return (
          <Polyline
            key={r.id}
            positions={r.coords.map(([lon, lat]) => [lat, lon])}
            pathOptions={{ color: TIER_COLOR[r.tier], weight: r.tier === "closed" ? 4 : 3, opacity: 0.9, dashArray: r.tier === "watch" ? "4 4" : undefined }}
          >
            <Popup minWidth={200}>
              <b>{r.name}</b><br />
              Status: <span style={{ textTransform: "uppercase" }}>{r.tier}</span>
              {r.evidence.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{r.evidence.map((e, i) => <li key={i} style={{ fontSize: 11 }}>{e.text}</li>)}</ul>
              )}
              <div style={{ marginTop: 6 }}>
                <DispatchControl target={r.name} kind="road" lat={mid[1]} lon={mid[0]} dispatches={dispatches} onSignal={onSignalDispatch} onAdvance={onAdvanceDispatch} />
              </div>
            </Popup>
          </Polyline>
        );
      })}

      {(mapData?.buildingsAtRisk ?? []).map((b) => (
        <CircleMarker key={b.id} center={[b.lat, b.lon]} radius={7} pathOptions={{ color: TIER_COLOR[b.tier], fillColor: TIER_COLOR[b.tier], fillOpacity: 0.85 }}>
          <Popup minWidth={200}>
            <b>{b.name}</b><br />Status: <span style={{ textTransform: "uppercase" }}>{b.tier}</span>
            {b.evidence.length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{b.evidence.map((e, i) => <li key={i} style={{ fontSize: 11 }}>{e.text}</li>)}</ul>}
            <div style={{ marginTop: 6 }}>
              <DispatchControl target={b.name} kind="building" lat={b.lat} lon={b.lon} dispatches={dispatches} onSignal={onSignalDispatch} onAdvance={onAdvanceDispatch} />
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {(mapData?.places ?? []).map((p) => (
        <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={5} pathOptions={{ color: PLACE_COLOR[p.kind], fillColor: PLACE_COLOR[p.kind], fillOpacity: 0.9 }}>
          <Popup><b>{p.name}</b><br />{p.kind}</Popup>
        </CircleMarker>
      ))}

      {cameras.filter((c) => c.lat != null).map((c) => (
        <CircleMarker key={c.id} center={[c.lat!, c.lon!]} radius={6} pathOptions={{ color: "#38bdf8", fillColor: "#0b1017", fillOpacity: 0.8, weight: 2 }}>
          <Popup><b>{c.name}</b><br />River camera{c.gauge ? ` · ${c.gauge.stageFt.toFixed(1)} ft (${c.gauge.category})` : ""}</Popup>
        </CircleMarker>
      ))}

      {sensors.map((s) => (
        <CircleMarker key={s.id} center={[s.lat, s.lon]} radius={6} pathOptions={{ color: "#c084fc", fillColor: "#0b1017", fillOpacity: 0.8, weight: 2 }}>
          <Popup><b>{s.name}</b><br />{s.road}{s.latest ? ` · ${s.latest.depthCm} cm deep` : " · no readings yet"}</Popup>
        </CircleMarker>
      ))}

      {reports.map((r) => (
        <CircleMarker key={r.id} center={[r.lat, r.lon]} radius={5} pathOptions={{ color: "#f472b6", fillColor: "#f472b6", fillOpacity: 0.7 }}>
          <Popup><b>Student report</b><br />{r.note || "(no note)"}<br />{r.depthCm != null ? `Reported ~${r.depthCm} cm` : "No depth given"}{!r.ext && " · no photo"}</Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
