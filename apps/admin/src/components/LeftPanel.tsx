"use client";
import type { Live, MapData } from "@/lib/api";
import Freshness from "./Freshness";

export default function LeftPanel({ live, mapData, errors }: { live: Live | null; mapData: MapData | null; errors: Record<string, string> }) {
  const g = live?.gauge;

  return (
    <div className="col left">
      <div className="card">
        <h2>Raritan River at Bound Brook {live && <Freshness fetchedAt={live.fetchedAt} stale={live.stale} />}</h2>
        <div className="big">{g ? g.observedFt.toFixed(1) : "--.-"} <span style={{ fontSize: 14, color: "#6b7a8c" }}>ft</span></div>
        <div className="muted">category: {g?.floodCategory ?? "--"}</div>
        {g && <div className="muted" style={{ marginTop: 4 }}>Observed {new Date(g.observedAt).toLocaleString()}{g.forecastFt != null ? ` · NWS forecast ${g.forecastFt.toFixed(1)} ft by ${new Date(g.forecastAt!).toLocaleString()}` : ""}</div>}
        {live?.gaugeError && <div className="muted">Gauge unavailable, showing last known reading: {live.gaugeError}</div>}
        {errors.live && <div className="muted">Live feed error: {errors.live}</div>}
        {g && g.impacts.length > 0 && (
          <ul className="list" style={{ marginTop: 8 }}>
            {g.impacts.filter((i) => g.observedFt >= i.stageFt).map((i, idx) => (
              <li key={idx} style={{ display: "block" }}><b>{i.stageFt} ft</b> {i.statement}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>NWS alerts · New Brunswick</h2>
        <ul className="list">
          {live?.alertsError && <li className="muted">Unavailable: {live.alertsError}</li>}
          {live && !live.alertsError && !live.alerts?.length && <li className="muted">No active alerts.</li>}
          {live?.alerts?.map((a, i) => (
            <li key={i} className="alert" style={{ display: "block" }}>
              <b>{a.event}</b><div className="headline">{a.headline}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>NOAA stream model {mapData && <Freshness fetchedAt={mapData.freshness.nwm.fetchedAt} stale={mapData.freshness.nwm.stale} />}</h2>
        {mapData ? (
          <div className="muted">
            Rapid-onset flags: {mapData.nwmSummary.reaches.rapidOnset} · High-water arrivals: {mapData.nwmSummary.reaches.highWaterArrival} · Elevated probability: {mapData.nwmSummary.reaches.highWaterProbability}
            {Object.keys(mapData.nwmSummary.errors || {}).length > 0 && <div>Partial errors: {Object.keys(mapData.nwmSummary.errors).join(", ")}</div>}
            {mapData.freshness.osmRoads.stale && <div>Roads/buildings data is stale (Overpass unreachable): {mapData.freshness.osmRoads.error}</div>}
            <div style={{ marginTop: 6 }}>Roads/buildings colored <span style={{ color: "#fbbf24" }}>amber</span> are near a NOAA-flagged reach (worth the admin&apos;s attention); <span style={{ color: "#ef4444" }}>red</span> means inside NOAA&apos;s live flood extent or confirmed by a sensor/report.</div>
          </div>
        ) : <div className="muted">Loading…</div>}
      </div>
    </div>
  );
}
