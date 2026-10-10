// Small HTTP helpers shared by every route: JSON bodies, responses, upstream fetches, and a TTL cache.
export const UA = "ruafloat/0.1 (Rutgers flood command)";

export function readBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > limit) { reject(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { reject(Object.assign(new Error("invalid JSON"), { status: 400 })); } });
  });
}

export function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

export async function getJson(url, timeoutMs = 10000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url.split("?")[0]} -> ${r.status}`);
  return r.json();
}

const cache = new Map();
export async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
