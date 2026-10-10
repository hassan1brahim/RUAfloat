"use client";
import { useState } from "react";
import type { DispatchPing, DispatchStatus } from "@/lib/api";

const STATUS_LABEL: Record<DispatchStatus, string> = { pending: "pending", acknowledged: "acknowledged", "en-route": "en route", "on-scene": "on scene", cleared: "cleared" };
const STATUS_TAG: Record<DispatchStatus, string> = { pending: "pending", acknowledged: "watch", "en-route": "watch", "on-scene": "watch", cleared: "acknowledged" };
const NEXT_LABEL: Partial<Record<DispatchStatus, string>> = { pending: "Acknowledge", acknowledged: "Mark en route", "en-route": "Mark on scene", "on-scene": "Mark cleared" };

/** Signal-dispatch control: requires naming a unit and confirming before a ping is recorded, then tracks
 * it through pending -> acknowledged -> en-route -> on-scene -> cleared. Used in both the map popups and the
 * side-panel lists so the flow is identical everywhere. */
export default function DispatchControl({ target, kind, lat, lon, dispatches, onSignal, onAdvance }: {
  target: string; kind: "road" | "building"; lat: number; lon: number;
  dispatches: DispatchPing[];
  onSignal: (target: string, kind: "road" | "building", lat: number, lon: number, unit: string) => void;
  onAdvance: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [unit, setUnit] = useState("");
  const existing = dispatches.find((d) => d.target === target && d.status !== "cleared");

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
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          autoFocus
          placeholder="Unit (e.g. RUPD-3)"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          style={{ width: 120, fontSize: 11, background: "#0b1017", border: "1px solid #334155", borderRadius: 4, color: "#e6edf3", padding: "3px 6px" }}
        />
        <button className="btn" disabled={!unit.trim()} onClick={() => { onSignal(target, kind, lat, lon, unit.trim()); setConfirming(false); setUnit(""); }}>Confirm</button>
        <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    );
  }

  return <button className="btn" onClick={() => setConfirming(true)}>Signal dispatch</button>;
}
