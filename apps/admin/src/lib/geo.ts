/** Tiny equirectangular-approximation distance — fine at this scale (a few km), avoids pulling in a geo library. */
export function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const kx = Math.cos((aLat * Math.PI) / 180) * 111_320, ky = 110_540;
  return Math.hypot((aLon - bLon) * kx, (aLat - bLat) * ky);
}
