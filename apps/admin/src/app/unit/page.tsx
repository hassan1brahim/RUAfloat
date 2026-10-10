"use client";
import { useEffect, useRef, useState } from "react";
import { api, type DispatchPing, type DispatchStatus } from "@/lib/api";

const NEXT_LABEL: Partial<Record<DispatchStatus, string>> = {
  pending: "Acknowledge",
  acknowledged: "Mark en route",
  "en-route": "Mark on scene",
  "on-scene": "Clear",
};
const STATUS_LABEL: Record<DispatchStatus, string> = {
  pending: "NEW — unacknowledged", acknowledged: "Acknowledged", "en-route": "En route", "on-scene": "On scene", cleared: "Cleared",
};

/** Plays a short two-tone alert beep with the Web Audio API — no audio file to ship. */
function beep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch { /* audio not available, no-op */ }
}

export default function UnitConsole() {
  const [dispatches, setDispatches] = useState<DispatchPing[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const list = await api.dispatches();
        if (!alive) return;
        if (!firstLoad.current) {
          const fresh = list.some((d) => d.status === "pending" && !seenIds.current.has(d.id));
          if (fresh) beep();
        }
        firstLoad.current = false;
        seenIds.current = new Set(list.map((d) => d.id));
        setDispatches(list);
      } catch { /* keep showing last known state */ }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function advance(id: string) {
    const rec = await api.setDispatchStatus(id);
    setDispatches((d) => d.map((x) => (x.id === id ? rec : x)));
  }

  const active = dispatches.filter((d) => d.status !== "cleared");
  const history = dispatches.filter((d) => d.status === "cleared");
  const incoming = active.find((d) => d.status === "pending");

  return (
    <div style={{ minHeight: "100vh", background: "#0b1017", color: "#e6edf3", padding: 20, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 16, letterSpacing: "0.04em", textTransform: "uppercase", color: "#8aa0b8", margin: "0 0 16px" }}>Unit Console</h1>

      {incoming && (
        <div style={{ border: "2px solid #ef4444", borderRadius: 12, padding: 20, marginBottom: 20, background: "#1a0b0b", animation: "pulse 1.2s infinite" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", textTransform: "uppercase", letterSpacing: "0.05em" }}>🚨 New dispatch request</div>
          <div style={{ fontSize: 26, fontWeight: 700, margin: "8px 0" }}>{incoming.target}</div>
          <div style={{ color: "#9fb0c3", marginBottom: 12 }}>{incoming.kind === "road" ? "Road closure" : "Building at risk"} · unit {incoming.unit} · signaled {new Date(incoming.createdAt).toLocaleTimeString()}</div>
          <button onClick={() => advance(incoming.id)} style={btnBig}>Acknowledge</button>
        </div>
      )}

      {active.filter((d) => d.status !== "pending").map((d) => (
        <div key={d.id} style={{ border: "1px solid #1d2733", borderRadius: 10, padding: 16, marginBottom: 12, background: "#111925" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{d.target}</div>
              <div style={{ color: "#9fb0c3", fontSize: 13 }}>{d.kind} · unit {d.unit} · {STATUS_LABEL[d.status]}</div>
            </div>
            {NEXT_LABEL[d.status] && <button onClick={() => advance(d.id)} style={btn}>{NEXT_LABEL[d.status]}</button>}
          </div>
        </div>
      ))}

      {active.length === 0 && <div style={{ color: "#6b7a8c" }}>No active dispatches. Waiting…</div>}

      {history.length > 0 && (
        <>
          <h2 style={{ fontSize: 12, textTransform: "uppercase", color: "#6b7a8c", marginTop: 28 }}>Cleared</h2>
          {history.map((d) => (
            <div key={d.id} style={{ color: "#6b7a8c", fontSize: 13, padding: "4px 0" }}>{d.target} · unit {d.unit} · cleared {new Date(d.history.at(-1)?.at ?? d.createdAt).toLocaleTimeString()}</div>
          ))}
        </>
      )}

      <style>{`@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); } 50% { box-shadow: 0 0 0 10px rgba(239,68,68,0); } }`}</style>
    </div>
  );
}

const btn: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 6, border: "1px solid #334155", background: "#1a2330", color: "#e6edf3", cursor: "pointer" };
const btnBig: React.CSSProperties = { ...btn, fontSize: 16, padding: "12px 20px", background: "#7f1d1d", border: "1px solid #ef4444", color: "#fecaca" };
