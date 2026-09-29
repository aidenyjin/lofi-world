import * as THREE from 'three';

// Time-of-day palettes. Hex values are sRGB and tuned for a pastel,
// sun-bleached look: warm haze in the day, lilac shadows, neon at night.
export interface Palette {
  skyTop: string;
  skyBottom: string;
  haze: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  skyline: string;
  shadowLift: string; // colour that shadows drift toward in the grade
  spriteTint: string; // multiplier for flat cut-out sprites
  nightness: number; // 0 = day, 1 = full night (window glow, bulbs)
}

const golden: Palette = {
  skyTop: '#f7d2b4', skyBottom: '#fff3e3', haze: '#fbe2cf',
  sun: '#ffd49a', sunIntensity: 2.6,
  hemiSky: '#ffe6cc', hemiGround: '#d9a191', hemiIntensity: 1.25,
  skyline: '#b7c2ea', shadowLift: '#7a4f78', spriteTint: '#fff6ea', nightness: 0,
};

const dusk: Palette = {
  skyTop: '#7470b8', skyBottom: '#f6a98c', haze: '#dca2a8',
  sun: '#ff9d70', sunIntensity: 1.5,
  hemiSky: '#c1a6de', hemiGround: '#7d5878', hemiIntensity: 1.0,
  skyline: '#8b82bd', shadowLift: '#4d3a6e', spriteTint: '#f1d6de', nightness: 0.45,
};

const night: Palette = {
  skyTop: '#161b40', skyBottom: '#463a74', haze: '#3a3668',
  sun: '#9fb2ff', sunIntensity: 0.55,
  hemiSky: '#4e5ba6', hemiGround: '#2a2142', hemiIntensity: 0.8,
  skyline: '#2e3366', shadowLift: '#1d1a3c', spriteTint: '#8f93c6', nightness: 1,
};

const dawn: Palette = {
  skyTop: '#9fb6e2', skyBottom: '#ffd4c6', haze: '#f1d5d9',
  sun: '#ffc6a6', sunIntensity: 1.7,
  hemiSky: '#d8d6f2', hemiGround: '#b98f9c', hemiIntensity: 1.1,
  skyline: '#a8b3e0', shadowLift: '#6a5680', spriteTint: '#f6e6ee', nightness: 0.25,
};

const day: Palette = {
  skyTop: '#7fb7ec', skyBottom: '#f2ecf5', haze: '#e8e6f2',
  sun: '#fff1dc', sunIntensity: 2.4,
  hemiSky: '#d4e6ff', hemiGround: '#e3c3b8', hemiIntensity: 1.2,
  skyline: '#9dbde8', shadowLift: '#5b5a8e', spriteTint: '#ffffff', nightness: 0,
};

// Keyframes around the day. t is 0..1; we start at golden hour.
const keys: { t: number; p: Palette }[] = [
  { t: 0.0, p: golden },
  { t: 0.14, p: dusk },
  { t: 0.24, p: night },
  { t: 0.5, p: night },
  { t: 0.6, p: dawn },
  { t: 0.72, p: day },
  { t: 0.9, p: golden },
  { t: 1.0, p: golden },
];

export interface ResolvedPalette {
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  haze: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyline: THREE.Color;
  shadowLift: THREE.Color;
  spriteTint: THREE.Color;
  nightness: number;
}

const colorKeys = [
  'skyTop', 'skyBottom', 'haze', 'sun', 'hemiSky', 'hemiGround', 'skyline', 'shadowLift', 'spriteTint',
] as const;
const numberKeys = ['sunIntensity', 'hemiIntensity', 'nightness'] as const;

export function createResolvedPalette(): ResolvedPalette {
  return {
    skyTop: new THREE.Color(), skyBottom: new THREE.Color(), haze: new THREE.Color(),
    sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
    skyline: new THREE.Color(), shadowLift: new THREE.Color(), spriteTint: new THREE.Color(),
    sunIntensity: 0, hemiIntensity: 0, nightness: 0,
  };
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export function samplePalette(t: number, out: ResolvedPalette): ResolvedPalette {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const f = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
  for (const k of colorKeys) {
    tmpA.set(a.p[k]);
    tmpB.set(b.p[k]);
    out[k].copy(tmpA).lerp(tmpB, f);
  }
  for (const k of numberKeys) out[k] = a.p[k] + (b.p[k] - a.p[k]) * f;
  return out;
}

function smooth(x: number): number {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
}

// Sun (and moon) direction over the day as azimuth/elevation keyframes.
// Azimuth 0 = light coming from behind the camera; positive = from the right.
const sunKeys: { t: number; az: number; el: number }[] = [
  { t: 0.0, az: 0.95, el: 0.5 },
  { t: 0.14, az: 1.25, el: 0.32 },
  { t: 0.2, az: 1.35, el: 0.25 },
  { t: 0.26, az: -0.8, el: 0.85 }, // moon
  { t: 0.54, az: -1.0, el: 0.75 },
  { t: 0.62, az: -1.2, el: 0.4 },
  { t: 0.74, az: -0.3, el: 1.0 },
  { t: 0.9, az: 0.75, el: 0.62 },
  { t: 1.0, az: 0.95, el: 0.5 },
];

const dirA = new THREE.Vector3();
const dirB = new THREE.Vector3();

function azElToDir(az: number, el: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

export function sunDirection(t: number, out: THREE.Vector3): THREE.Vector3 {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < sunKeys.length - 2 && sunKeys[i + 1].t <= t) i++;
  const a = sunKeys[i];
  const b = sunKeys[i + 1];
  const f = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
  azElToDir(a.az, a.el, dirA);
  azElToDir(b.az, b.el, dirB);
  return out.copy(dirA).lerp(dirB, f).normalize();
}

// Building wall colours, pulled from the reference frames.
export const WALLS = [
  '#f7c4ad', '#f0a497', '#c8b5e6', '#a9c9f0', '#f7e7cc', '#f6bcd2',
  '#e6a08a', '#bde2d0', '#f8dea0', '#d6c5ee', '#f5d0b6', '#b4d4f3',
] as const;
export const TRIM = ['#fff1d6', '#fbe7b8', '#f7d7c9', '#e9e4ff'] as const;
export const ROOF = ['#d9c3cf', '#e8cfc0', '#c7c3dc', '#e3d6c4', '#cdb6c4'] as const;
export const FOLIAGE = ['#f29a4a', '#f6b64c', '#ee7d45', '#f7c96b', '#e8a35f'] as const;
export const INK = '#3b2a3a';
