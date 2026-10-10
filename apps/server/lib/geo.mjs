/** Small original geometry helpers — point-in-polygon and nearest-distance checks for fusing OSM roads/buildings
 * against NOAA's live flood-extent polygon and flagged stream reaches. No prebuilt elevation model involved. */

export function metersBetween([lon1, lat1], [lon2, lat2]) {
  const kx = Math.cos((lat1 * Math.PI) / 180) * 111320, ky = 110540;
  return Math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * ky);
}

function distanceToSegmentM(p, a, b) {
  const kx = Math.cos((p[1] * Math.PI) / 180) * 111320, ky = 110540;
  const px = p[0] * kx, py = p[1] * ky, ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky;
  const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L)) : 0;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Shortest distance (metres) from a point to any segment of a line/multiline feature. */
export function distanceToLineFeatureM(pt, geometry) {
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
  let best = Infinity;
  for (const line of lines) for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, distanceToSegmentM(pt, line[i], line[i + 1]));
  return best;
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True if pt is inside a Polygon or MultiPolygon GeoJSON geometry (ignores holes — fine for flood extent use). */
export function pointInPolygonFeature(pt, geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polys.some((rings) => rings.length > 0 && pointInRing(pt, rings[0]));
}

/** True if any point along a road's coordinate list falls inside the given polygon features. */
export function lineCrossesAnyPolygon(coords, features) {
  return coords.some((pt) => features.some((f) => pointInPolygonFeature(pt, f.geometry)));
}

/** Nearest distance (metres) from a point to any of a set of line features (e.g. flagged stream reaches). */
export function nearestLineDistanceM(pt, features) {
  let best = Infinity;
  for (const f of features) best = Math.min(best, distanceToLineFeatureM(pt, f.geometry));
  return best;
}
