"use client";
import { useEffect, useRef, useState } from "react";
import { api, type CamerasResponse, type DispatchPing, type DispatchStatus, type Live, type MapData, type Nwm, type Report, type Sensor } from "./api";

/** Polls our own admin API. The server already fuses live roads/buildings/sensors/reports into risk tiers
 * (lib/risk.mjs), so the client just renders what it's given rather than recomputing closures itself. */
export function useAdminData() {
  const [live, setLive] = useState<Live | null>(null);
  const [nwm, setNwm] = useState<Nwm | null>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [camerasResp, setCamerasResp] = useState<CamerasResponse | null>(null);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [dispatches, setDispatches] = useState<DispatchPing[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const poll = (fn: () => Promise<void>, ms: number) => {
      let t: ReturnType<typeof setTimeout>;
      const tick = async () => { await fn(); if (mounted.current) t = setTimeout(tick, ms); };
      tick();
      return () => clearTimeout(t);
    };
    const safely = (key: string, fn: () => Promise<void>) => async () => {
      try { await fn(); if (mounted.current) setErrors((e) => ({ ...e, [key]: "" })); }
      catch (e) { if (mounted.current) setErrors((prev) => ({ ...prev, [key]: String((e as Error).message || e) })); }
    };
    const stops = [
      poll(safely("live", async () => setLive(await api.live())), 60_000),
      poll(safely("nwm", async () => setNwm(await api.nwm())), 10 * 60_000),
      poll(safely("map", async () => setMapData(await api.map())), 20_000),
      poll(safely("cameras", async () => setCamerasResp(await api.cameras())), 5 * 60_000),
      poll(safely("sensors", async () => setSensors(await api.sensors())), 15_000),
      poll(safely("reports", async () => setReports(await api.reports())), 15_000),
      poll(safely("dispatches", async () => setDispatches(await api.dispatches())), 10_000),
    ];
    return () => { mounted.current = false; stops.forEach((s) => s()); };
  }, []);

  async function signalDispatch(target: string, kind: "road" | "building", lat: number, lon: number, unit: string, note?: string) {
    const rec = await api.signalDispatch({ target, kind, lat, lon, unit, note });
    setDispatches((d) => [rec, ...d]);
  }
  async function setDispatchStatus(id: string, status?: DispatchStatus) {
    const rec = await api.setDispatchStatus(id, status);
    setDispatches((d) => d.map((x) => (x.id === id ? rec : x)));
  }

  return { live, nwm, mapData, cameras: camerasResp?.cameras ?? [], camerasResp, sensors, reports, dispatches, errors, signalDispatch, setDispatchStatus };
}
