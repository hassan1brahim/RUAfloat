"use client";
import type { Camera, CamerasResponse, DispatchPing, MapData, Report, Sensor } from "@/lib/api";
import DispatchControl from "./DispatchControl";
import Freshness from "./Freshness";

const SOURCE_LABEL: Record<string, string> = {
  sensor: "sensor", "report-confirmed": "2 reports", "report-unconfirmed": "1 report", "noaa-extent": "NOAA extent", "noaa-reach": "NOAA reach",
};

export default function RightPanel({
  mapData, dispatches, onSignalDispatch, onAdvanceDispatch, camerasResp, cameras, sensors, reports,
}: {
  mapData: MapData | null;
  dispatches: DispatchPing[];
  onSignalDispatch: (target: string, kind: "road" | "building", lat: number, lon: number, unit: string) => void;
  onAdvanceDispatch: (id: string) => void;
  camerasResp: CamerasResponse | null;
  cameras: Camera[];
  sensors: Sensor[];
  reports: Report[];
}) {
  const roads = mapData?.roadsAtRisk ?? [];
  const buildings = mapData?.buildingsAtRisk ?? [];

  return (
    <div className="col right">
      <div className="card">
        <h2>Closed / watch roads <span className="muted">{roads.length}</span> {mapData && <Freshness fetchedAt={mapData.freshness.osmRoads.fetchedAt} stale={mapData.freshness.osmRoads.stale} />}</h2>
        <ul className="list">
          {roads.length === 0 && <li className="muted">No roads flagged right now.</li>}
          {roads.slice(0, 30).map((r) => {
            const mid = r.coords[Math.floor(r.coords.length / 2)];
            return (
              <li key={r.id} style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{r.name} <span className={`tag ${r.tier}`}>{r.tier}</span>{r.closedBy && <span className="muted" style={{ marginLeft: 4 }}>({SOURCE_LABEL[r.closedBy]})</span>}</span>
                </div>
                {r.evidence[0] && <div className="muted" style={{ margin: "2px 0 6px" }}>{r.evidence[0].text}</div>}
                <DispatchControl target={r.name} kind="road" lat={mid[1]} lon={mid[0]} dispatches={dispatches} onSignal={onSignalDispatch} onAdvance={onAdvanceDispatch} />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card">
        <h2>Buildings at risk <span className="muted">{buildings.length}</span></h2>
        <ul className="list">
          {buildings.length === 0 && <li className="muted">None flagged right now.</li>}
          {buildings.map((b) => (
            <li key={b.id} style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{b.name} <span className={`tag ${b.tier}`}>{b.tier}</span>{b.closedBy && <span className="muted" style={{ marginLeft: 4 }}>({SOURCE_LABEL[b.closedBy]})</span>}</span>
              </div>
              {b.evidence[0] && <div className="muted" style={{ margin: "2px 0 6px" }}>{b.evidence[0].text}</div>}
              <DispatchControl target={b.name} kind="building" lat={b.lat} lon={b.lon} dispatches={dispatches} onSignal={onSignalDispatch} onAdvance={onAdvanceDispatch} />
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>River cameras {camerasResp && <Freshness fetchedAt={camerasResp.fetchedAt} stale={camerasResp.stale} />}</h2>
        <ul className="list" style={{ maxHeight: 220 }}>
          {cameras.map((c) => (
            <li key={c.id} style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{c.name}{c.gauge ? ` · ${c.gauge.stageFt.toFixed(1)} ft (${c.gauge.category})` : ""}</span>
                {c.image && <a className="btn" href={c.image} target="_blank" rel="noopener noreferrer">View latest</a>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Street sensors</h2>
        <ul className="list">
          {sensors.map((s) => (
            <li key={s.id}><span>{s.name}</span><span>{s.latest ? `${s.latest.depthCm} cm` : "no data"}</span></li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Student photo reports <span className="muted">{reports.length}</span></h2>
        <ul className="list">
          {reports.length === 0 && <li className="muted">None submitted yet.</li>}
          {reports.slice(0, 15).map((r) => (
            <li key={r.id} style={{ display: "block" }}>
              <div>{new Date(r.time).toLocaleTimeString()} {r.note ? `· ${r.note}` : ""}</div>
              <div className="muted">{r.depthCm != null ? `Reported ~${r.depthCm} cm` : "No depth given"}{!r.ext && " · no photo (can't corroborate)"}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Dispatch log <span className="muted">{dispatches.length}</span></h2>
        <ul className="list">
          {dispatches.length === 0 && <li className="muted">No units signaled yet.</li>}
          {dispatches.map((d) => (
            <li key={d.id} style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{d.target} <span className="muted">({d.kind})</span></span>
                <span className={`tag ${d.status === "cleared" ? "acknowledged" : d.status === "pending" ? "pending" : "watch"}`}>{d.status}</span>
              </div>
              <div className="muted">{d.unit ? `Unit ${d.unit} · ` : ""}signaled {new Date(d.createdAt).toLocaleTimeString()}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
