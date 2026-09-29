import { Rng, hashSeed } from '../rng';

// The railway: one smooth curve across the whole city, defined in world X.
// It sweeps between the back streets and over the canal on a viaduct, and
// where the curve swings deep into the back blocks (z < LOW_Z) it dips down:
// either running at street level in a fenced cutting, or into a tunnel.
// Stations sit along the line; trains stop at every one.

export const RAIL_Y = 15; // top of the deck when elevated
export const GROUND_Y = 0.25; // track bed height at street level
export const DECK_H = 1.2;
export const TRACK_OFFSET = 0.85; // each track sits this far from the centreline
export const RAMP = 70; // length of a ramp between elevated and street level

/** Back-block band where the line may leave the viaduct (no busy roads there). */
const LOW_Z = -63;

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
    cx += dir * (step / Math.sqrt(1 + railSlope(cx) ** 2));
    remaining -= step;
  }
  return cx;
}

/** Point on a track: centreline shifted sideways by `offset`. */
export function trackPoint(x: number, offset: number): { x: number; z: number } {
  const s = railSlope(x);
  const len = Math.sqrt(1 + s * s);
  return { x: x - (s / len) * offset, z: railZ(x) + (1 / len) * offset };
}

// ---------------------------------------------------------------------------
// Low sections and stations are found by scanning the curve in blocks, once.

export interface LowSection {
  x0: number; // where the ramp down starts
  x1: number; // where the ramp back up ends
  tunnel: boolean;
}

export interface Station {
  x: number; // centre of the platforms (world X)
  elevated: boolean;
  name: number; // index into the station name list
}

const BLOCK = 2000;
const lowCache = new Map<number, LowSection[]>();
const stationCache = new Map<number, Station[]>();
let seed = 1;

export function setRailSeed(s: number) {
  seed = s;
  lowCache.clear();
  stationCache.clear();
  yCache.clear();
}

/** Low sections overlapping [block*BLOCK, (block+1)*BLOCK). */
function lowSections(block: number): LowSection[] {
  let list = lowCache.get(block);
  if (list) return list;
  list = [];
  // Scan a margin either side so sections crossing block edges are found.
  const start = block * BLOCK - 800;
  const end = (block + 1) * BLOCK + 800;
  let inside = false;
  let a = 0;
  for (let x = start; x <= end; x += 2) {
    const deep = railZ(x) < LOW_Z;
    if (deep && !inside) {
      inside = true;
      a = x;
    } else if (!deep && inside) {
      inside = false;
      if (x - a > RAMP * 2 + 40) {
        const rng = new Rng(hashSeed(seed, Math.round(a), 0x7a1));
        list.push({ x0: a + 8, x1: x - 8, tunnel: rng.chance(0.45) });
      }
    }
  }
  lowCache.set(block, list);
  return list;
}

export function lowSectionAt(x: number): LowSection | null {
  for (const s of lowSections(Math.floor(x / BLOCK))) if (x >= s.x0 && x <= s.x1) return s;
  return null;
}

const yCache = new Map<number, number>();

/** Height of the top of the track bed at x. */
export function railY(x: number): number {
  const key = Math.round(x * 4);
  const hit = yCache.get(key);
  if (hit !== undefined) return hit;
  const s = lowSectionAt(x);
  let y = RAIL_Y;
  if (s) {
    const into = Math.min(x - s.x0, s.x1 - x);
    const t = Math.min(1, into / RAMP);
    const e = t * t * (3 - 2 * t);
    y = RAIL_Y + (GROUND_Y - RAIL_Y) * e;
  }
  if (yCache.size > 20000) yCache.clear();
  yCache.set(key, y);
  return y;
}

/** Is the track at x hidden in a tunnel (the flat part of a tunnel section)? */
export function inTunnel(x: number): boolean {
  const s = lowSectionAt(x);
  if (!s || !s.tunnel) return false;
  return x > s.x0 + RAMP && x < s.x1 - RAMP;
}

export interface Portal {
  x: number;
  /** Which way (along X) the tunnel runs from this mouth. */
  into: 1 | -1;
}

/** Tunnel portals (world X) near a range, for building the portal structures. */
export function portalsIn(x0: number, x1: number): Portal[] {
  const out: Portal[] = [];
  for (let b = Math.floor(x0 / BLOCK); b <= Math.floor(x1 / BLOCK); b++) {
    for (const s of lowSections(b)) {
      if (!s.tunnel) continue;
      for (const [p, into] of [[s.x0 + RAMP, 1], [s.x1 - RAMP, -1]] as const) {
        if (p >= x0 && p < x1 && !out.some((o) => o.x === p)) out.push({ x: p, into });
      }
    }
  }
  return out;
}

/** Length of the covered shed behind each tunnel mouth, where trains dive below the street. */
export const SHED = 14;

/**
 * Height a train runs at: the track, except inside a tunnel, where it dips
 * under the ground inside the portal shed so it never has to vanish.
 */
export function trainY(x: number): number {
  const s = lowSectionAt(x);
  if (!s || !s.tunnel) return railY(x);
  const a = s.x0 + RAMP, b = s.x1 - RAMP;
  if (x <= a || x >= b) return railY(x);
  const t = Math.min(1, Math.min(x - a, b - x) / SHED);
  return GROUND_Y - 5.5 * t * t * (3 - 2 * t);
}

export const STATION_LEN = 44;

/** Stations in [block*BLOCK, ...): one roughly every 320 units, where the line is level. */
function stations(block: number): Station[] {
  let list = stationCache.get(block);
  if (list) return list;
  list = [];
  const rng = new Rng(hashSeed(seed, block, 0x57a));
  for (let x = block * BLOCK + 120; x < (block + 1) * BLOCK - 60; x += rng.range(260, 380)) {
    // Nudge to a spot where the whole platform is at one level and not in a tunnel.
    let placed = false;
    for (let dx = 0; dx < 120 && !placed; dx += 8) {
      const cx = x + dx;
      const ends = [cx - STATION_LEN / 2, cx, cx + STATION_LEN / 2];
      const ys = ends.map(railY);
      const level = Math.max(...ys) - Math.min(...ys) < 0.05;
      const hidden = ends.some(inTunnel);
      const slope = Math.max(...ends.map((e) => Math.abs(railSlope(e))));
      if (level && !hidden && slope < 0.45) {
        list.push({ x: cx, elevated: ys[1] > 5, name: Math.floor(rng.next() * 1000) });
        placed = true;
      }
    }
  }
  stationCache.set(block, list);
  return list;
}

export function stationsIn(x0: number, x1: number): Station[] {
  const out: Station[] = [];
  for (let b = Math.floor(x0 / BLOCK); b <= Math.floor(x1 / BLOCK); b++) {
    for (const s of stations(b)) if (s.x + STATION_LEN / 2 >= x0 && s.x - STATION_LEN / 2 < x1) out.push(s);
  }
  return out;
}

/** Next station strictly ahead of x in direction dir (1 = +X). */
export function nextStation(x: number, dir: 1 | -1): Station | null {
  const b = Math.floor(x / BLOCK);
  const cands = [...stations(b - 1), ...stations(b), ...stations(b + 1)];
  let best: Station | null = null;
  for (const s of cands) {
    const d = (s.x - x) * dir;
    if (d > 0.01 && (!best || d < (best.x - x) * dir)) best = s;
  }
  return best;
}

export const STATION_NAMES = [
  'Lantern Row', 'Old Port', 'Peach Hill', 'Canal Street', 'Moonlight', 'Harbour Gate', 'Paper Mill', 'Tea Garden',
  'Sunset Quay', 'Vinyl Lane', 'Willow Park', 'Market Cross', 'Clock Tower', 'Neon Yard', 'Blossom', 'Lighthouse',
];
