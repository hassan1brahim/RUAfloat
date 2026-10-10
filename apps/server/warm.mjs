/** Pre-warm the running server's caches over HTTP — run this a few minutes before a demo/judging so the
 * first real visitor doesn't eat a 10-60s Overpass round trip. Must hit the already-running server
 * (a separate process can't share its in-memory cache), so this just calls its own endpoints.
 * Usage: node apps/server/warm.mjs [port] */
const port = process.argv[2] || process.env.PORT || 8787;
const base = `http://localhost:${port}`;

async function hit(path) {
  const start = Date.now();
  try {
    const r = await fetch(base + path);
    console.log(`${path} -> ${r.status} in ${Date.now() - start}ms`);
  } catch (e) {
    console.log(`${path} -> failed: ${e.message || e}`);
  }
}

await Promise.all([hit("/api/live"), hit("/api/nwm"), hit("/api/map"), hit("/api/cameras")]);
console.log("Warm-up done.");
