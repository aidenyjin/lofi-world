import { Rng, hashSeed } from '../rng';
import { Surf } from './surfaces';

// Neighbourhoods give each stretch of the journey its own character: palette,
// building material, roof style, signage and what hangs over the street.
// They come in runs of RUN chunks; each run also picks what fills the
// central corridor the camera travels along.

export type District = 'canal' | 'street' | 'market' | 'park';

export type HoodName = 'oldtown' | 'chinatown' | 'harbour' | 'neon' | 'arts' | 'garden' | 'parkland';

export interface Hood {
  name: HoodName;
  walls: readonly string[];
  trims: readonly string[];
  roofs: readonly string[];
  accents: readonly string[];
  /** Main facade material. */
  surface: number;
  /** Multiplies storey counts. */
  height: number;
  parkChance: number;
  marketChance: number;
  neonChance: number;
  shopChance: number;
  roofStyle: 'flat' | 'pagoda' | 'sawtooth';
  /** What's strung across the streets. */
  festoon: 'bulbs' | 'lanterns' | 'bunting' | 'neon';
  ivy: boolean;
  murals: boolean;
  corridor: [District, number][];
}

export const RUN = 4;

const HOODS: Record<HoodName, Hood> = {
  oldtown: {
    name: 'oldtown',
    walls: ['#f7c4ad', '#f0a497', '#c8b5e6', '#a9c9f0', '#f7e7cc', '#f6bcd2', '#e6a08a', '#bde2d0', '#f8dea0', '#d6c5ee'],
    trims: ['#fff1d6', '#fbe7b8', '#f7d7c9', '#e9e4ff'],
    roofs: ['#d9c3cf', '#e8cfc0', '#c7c3dc', '#e3d6c4'],
    accents: ['#e9786f', '#6fa7e0', '#57b39a', '#f6b94f', '#b18ad8', '#f28fb0'],
    surface: Surf.Plaster, height: 1, parkChance: 0.12, marketChance: 0.08, neonChance: 0.15, shopChance: 0.65,
    roofStyle: 'flat', festoon: 'bulbs', ivy: false, murals: false,
    corridor: [['canal', 0.45], ['street', 0.25], ['market', 0.2], ['park', 0.1]],
  },
  chinatown: {
    name: 'chinatown',
    walls: ['#d9594c', '#c94f45', '#e8c07a', '#6f9a86', '#f0d8b0', '#b8463f', '#e6a45a'],
    trims: ['#f4c95d', '#e8b04a', '#fff1d6'],
    roofs: ['#3f7a5e', '#2f6b56', '#b8463f'],
    accents: ['#d9594c', '#f4c95d', '#3f7a5e', '#e8503a'],
    surface: Surf.Plaster, height: 0.95, parkChance: 0.04, marketChance: 0.18, neonChance: 0.55, shopChance: 0.9,
    roofStyle: 'pagoda', festoon: 'lanterns', ivy: false, murals: false,
    corridor: [['market', 0.5], ['street', 0.4], ['canal', 0.1]],
  },
  harbour: {
    name: 'harbour',
    walls: ['#b7654f', '#a45a48', '#c9785c', '#8f5a4f', '#c98a6a', '#9c6d5e'],
    trims: ['#e9dccb', '#d9c6b2', '#f1e5df'],
    roofs: ['#8d8398', '#9f98ad', '#7a7488'],
    accents: ['#5b6fb0', '#e9786f', '#f6b94f', '#57907a'],
    surface: Surf.Brick, height: 0.75, parkChance: 0.14, marketChance: 0.04, neonChance: 0.05, shopChance: 0.3,
    roofStyle: 'sawtooth', festoon: 'bunting', ivy: false, murals: false,
    corridor: [['canal', 0.8], ['street', 0.2]],
  },
  neon: {
    name: 'neon',
    walls: ['#4a4470', '#3d3a5c', '#5a3d5c', '#2f3550', '#4f5a7a', '#6b4f7a'],
    trims: ['#8a7fb8', '#6b5c8a', '#a9a2cf'],
    roofs: ['#3b3552', '#4a4466'],
    accents: ['#ff8fb1', '#8fe3ff', '#b6a2ff', '#9dffc8', '#ffe08a'],
    surface: Surf.Plaster, height: 1.25, parkChance: 0.03, marketChance: 0.1, neonChance: 0.85, shopChance: 0.85,
    roofStyle: 'flat', festoon: 'neon', ivy: false, murals: false,
    corridor: [['street', 0.6], ['market', 0.3], ['canal', 0.1]],
  },
  arts: {
    name: 'arts',
    walls: ['#f28fb0', '#8fd1b5', '#f6c453', '#7fb3e8', '#b99ae0', '#f5a25d', '#fff1d6'],
    trims: ['#fff1d6', '#3b2a3a', '#fbe7b8'],
    roofs: ['#e3d6c4', '#d9c3cf'],
    accents: ['#e9786f', '#6fa7e0', '#57b39a', '#f6b94f', '#b18ad8'],
    surface: Surf.Plaster, height: 0.9, parkChance: 0.1, marketChance: 0.12, neonChance: 0.2, shopChance: 0.7,
    roofStyle: 'flat', festoon: 'bunting', ivy: false, murals: true,
    corridor: [['street', 0.4], ['market', 0.3], ['canal', 0.3]],
  },
  garden: {
    name: 'garden',
    walls: ['#f7e7cc', '#e8dcc4', '#d9e8d0', '#f0d8c8', '#e0d4ec', '#f6efe0'],
    trims: ['#fff8ea', '#e9e4ff', '#d8c8b0'],
    roofs: ['#b98a6a', '#a8785c', '#c49a7a'],
    accents: ['#57b39a', '#8bc36a', '#f28fb0', '#6fa7e0'],
    surface: Surf.Stone, height: 0.85, parkChance: 0.3, marketChance: 0.06, neonChance: 0.02, shopChance: 0.5,
    roofStyle: 'flat', festoon: 'bulbs', ivy: true, murals: false,
    corridor: [['park', 0.4], ['canal', 0.4], ['street', 0.2]],
  },
  parkland: {
    name: 'parkland',
    walls: ['#f7e7cc', '#f0c2a4', '#d6c5ee', '#bde2d0'],
    trims: ['#fff1d6', '#fbe7b8'],
    roofs: ['#b98a6a', '#d9c3cf'],
    accents: ['#57b39a', '#f6b94f', '#6fa7e0'],
    surface: Surf.Plaster, height: 0.7, parkChance: 0.72, marketChance: 0.04, neonChance: 0.0, shopChance: 0.4,
    roofStyle: 'flat', festoon: 'bulbs', ivy: true, murals: false,
    corridor: [['park', 1]],
  },
};

const NAMES: HoodName[] = ['oldtown', 'chinatown', 'harbour', 'neon', 'arts', 'garden', 'parkland'];

/** Each cycle of 7 runs visits every neighbourhood once, in a seeded order. */
function hoodForRun(seed: number, run: number): HoodName {
  const cycle = Math.floor(run / NAMES.length);
  const order = NAMES.slice();
  const rng = new Rng(hashSeed(seed, cycle, 0xc1c));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (cycle === 0) {
    // Always begin in the old town on the canal.
    const k = order.indexOf('oldtown');
    [order[0], order[k]] = [order[k], order[0]];
  }
  return order[((run % NAMES.length) + NAMES.length) % NAMES.length];
}

function weighted<T>(rng: Rng, items: [T, number][]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rng.next() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export interface Area {
  hood: Hood;
  district: District;
  /** True for the first chunk of a run (where gates go). */
  runStart: boolean;
}

const cache = new Map<string, Area>();

export function areaAt(seed: number, index: number): Area {
  const run = Math.floor(index / RUN);
  const key = `${seed}:${run}`;
  let a = cache.get(key);
  if (!a) {
    if (run === 0) {
      a = { hood: HOODS.oldtown, district: 'canal', runStart: false };
    } else {
      const rng = new Rng(hashSeed(seed, run, 0x40d));
      const hood = HOODS[hoodForRun(seed, run)];
      a = { hood, district: weighted(rng, hood.corridor), runStart: false };
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, a);
  }
  const start = index - run * RUN === 0;
  return start === a.runStart ? a : { ...a, runStart: start };
}

export function districtAt(seed: number, index: number): District {
  return areaAt(seed, index).district;
}
