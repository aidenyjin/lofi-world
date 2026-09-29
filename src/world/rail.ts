// The elevated railway: one smooth curve across the whole city, defined in
// world X. It sweeps between the back streets and over the canal (so trains
// sometimes pass high above the camera), and every chunk builds the stretch
// of viaduct that crosses it.

export const RAIL_Y = 16; // top of the deck
export const DECK_H = 1.4;
export const TRACK_OFFSET = 1.05; // each track sits this far from the centreline

export function railZ(x: number): number {
  return -44 + 38 * Math.sin((x / 620) * Math.PI * 2 + 0.9) + 6 * Math.sin((x / 190) * Math.PI * 2);
}

export function railSlope(x: number): number {
  const h = 0.5;
  return (railZ(x + h) - railZ(x - h)) / (2 * h);
}

/** Heading angle for three.js rotation.y so local +X follows the curve. */
export function railYaw(x: number): number {
  return -Math.atan(railSlope(x));
}

/** Step `dist` units along the curve from x (negative = backwards). */
export function railStep(x: number, dist: number): number {
  let remaining = Math.abs(dist);
  const dir = Math.sign(dist);
  let cx = x;
  while (remaining > 0.001) {
    const step = Math.min(1, remaining);
    const dx = step / Math.sqrt(1 + railSlope(cx) ** 2);
    cx += dir * dx;
    remaining -= step;
  }
  return cx;
}

/** Point on a track: centreline shifted sideways by `offset` (+ = left of +X travel). */
export function trackPoint(x: number, offset: number): { x: number; z: number } {
  const s = railSlope(x);
  const len = Math.sqrt(1 + s * s);
  // Perpendicular to the tangent (1, s) in the XZ plane.
  return { x: x - (s / len) * offset, z: railZ(x) + (1 / len) * offset };
}
