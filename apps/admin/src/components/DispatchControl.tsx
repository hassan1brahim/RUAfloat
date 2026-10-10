"use client";
import { useMemo, useState } from "react";
import type { DispatchPing, DispatchStatus, Place } from "@/lib/api";
import { metersBetween } from "@/lib/geo";

const STATUS_LABEL: Record<DispatchStatus, string> = { pending: "pending", acknowledged: "acknowledged", "en-route": "en route", "on-scene": "on scene", cleared: "cleared" };
const STATUS_TAG: Record<DispatchStatus, string> = { pending: "pending", acknowledged: "watch", "en-route": "watch", "on-scene": "watch", cleared: "acknowledged" };
const NEXT_LABEL: Partial<Record<DispatchStatus, string>> = { pending: "Acknowledge", acknowledged: "Mark en route", "en-route": "Mark on scene", "on-scene": "Mark cleared" };
const KIND_LABEL: Record<Place["kind"], string> = { police: "Police", fire: "Fire", hospital: "Hospital" };
const CUSTOM = "__custom__";

/** Signal-dispatch control: picks the real nearest police/fire/hospital unit (from the same live OSM data
 * the map renders) rather than free text, with a manual-entry fallback if nothing nearby fits. Tracks the
 * ping through pending -> acknowledged -> en-route -> on-scene -> cleared. Used in both the map popups and
 * the side-panel lists so the flow is identical everywhere. */
export default function DispatchControl({ target, kind, lat, lon, places, dispatches, onSignal, onAdvance }: {
  target: string; kind: "road" | "building"; lat: number; lon: number;
  places: Place[];
  dispatches: DispatchPing[];
  onSignal: (target: string, kind: "road" | "building", lat: number, lon: number, unit: string) => void;
  onAdvance: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const existing = dispatches.find((d) => d.target === target && d.status !== "cleared");

  const nearby = useMemo(
    () => places
      .map((p) => ({ ...p, distanceM: metersBetween(lat, lon, p.lat, p.lon) }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 6),
    [places, lat, lon]
  );

  if (existing) {
    const nextLabel = NEXT_LABEL[existing.status];
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`tag ${STATUS_TAG[existing.status]}`}>{STATUS_LABEL[existing.status]}{existing.unit ? ` · ${existing.unit}` : ""}</span>
        {nextLabel && <button className="btn" onClick={() => onAdvance(existing.id)}>{nextLabel}</button>}
      </div>
    );
  }

  if (confirming) {
    const unit = selected === CUSTOM ? customUnit.trim() : selected;
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <select
          autoFocus
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{ fontSize: 11, background: "#0b1017", border: "1px solid #334155", borderRadius: 4, color: "#e6edf3", padding: "3px 6px", maxWidth: 220 }}
        >
          <option value="" disabled>Nearest units…</option>
          {nearby.map((p) => (
            <option key={p.id} value={p.name}>{KIND_LABEL[p.kind]} · {p.name} ({(p.distanceM / 1000).toFixed(1)} km)</option>
          ))}
          <option value={CUSTOM}>Other (type manually)…</option>
        </select>
        {selected === CUSTOM && (
          <input
            autoFocus
            placeholder="Unit name"
            value={customUnit}
            onChange={(e) => setCustomUnit(e.target.value)}
            style={{ width: 110, fontSize: 11, background: "#0b1017", border: "1px solid #334155", borderRadius: 4, color: "#e6edf3", padding: "3px 6px" }}
          />
        )}
        <button className="btn" disabled={!unit} onClick={() => { onSignal(target, kind, lat, lon, unit); setConfirming(false); setSelected(""); setCustomUnit(""); }}>Confirm</button>
        <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    );
  }

  return <button className="btn" onClick={() => setConfirming(true)}>Signal dispatch</button>;
}
