/** Express doesn't catch rejected promises from async route handlers — an unhandled rejection crashes the
 * whole process. Wrap every async route in this so an upstream failure (NOAA, Overpass, USGS) returns a
 * clean 502 instead of taking the admin dashboard down. */
export const ah = (fn) => (req, res, next) => fn(req, res, next).catch((e) => {
  console.error(`[${req.method} ${req.path}]`, e);
  res.status(502).json({ error: String(e.message || e) });
});
