/** Small shared helpers and the one convention everything uses: river rise = Bound Brook stage - 17 ft. */

/** Bound Brook stage treated as "no rise" (Ida's pre-storm reading was 17.42 ft; Oct 2026 baseflow ~16.9). */
export const BASE_FT = 17.0;
export const CATS = [
  { k: "major", ft: 33 }, { k: "moderate", ft: 30 }, { k: "minor", ft: 28 }, { k: "action", ft: 26 },
] as const;

/** Escape text for innerHTML: anything from a user, an AI or an upstream API goes through this. */
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const fmtFt = (ft: number) => `${ft.toFixed(1)} ft`;
/** Rise in decimetres (the flood grid's unit). */
export const riseDmOf = (ft: number) => Math.max(0, Math.round((ft - BASE_FT) * 3.048));
export const catOf = (ft: number) => CATS.find((c) => ft >= c.ft)?.k ?? "normal";
export const et = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const metersBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180) * 111320, (a.lat - b.lat) * 110570);
export const getJson = <T>(url: string): Promise<T> => fetch(url).then((r) => r.json() as Promise<T>);
export const postJson = <T>(url: string, body: unknown): Promise<T> =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);
