/** TTL cache that keeps serving the last good value (marked stale) when the upstream source fails,
 * instead of taking the whole panel down. This is the one place every live-data route goes through. */
const store = new Map();

export async function cached(key, ttlMs, compute) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return { value: hit.value, fetchedAt: new Date(hit.at).toISOString(), stale: false };
  try {
    const value = await compute();
    const at = Date.now();
    store.set(key, { at, value });
    return { value, fetchedAt: new Date(at).toISOString(), stale: false };
  } catch (e) {
    if (hit) return { value: hit.value, fetchedAt: new Date(hit.at).toISOString(), stale: true, error: String(e.message || e) };
    throw e;
  }
}

/** Populate a cache entry directly (used to pre-warm slow sources like Overpass before a demo). */
export async function warm(key, ttlMs, compute) {
  return cached(key, ttlMs, compute);
}
