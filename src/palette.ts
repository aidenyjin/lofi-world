import * as THREE from 'three';

// Time-of-day palettes. Hex values are sRGB, tuned for a bright, hazy,
// cosy illustrated look: a spring-blue day with lilac shadows, a warm autumn
// sunset (the trees turn orange with it), then a soft night.
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
  autumn: number; // 0 = spring foliage, 1 = autumn orange
}

// Spring day: pale blue sky washing to near-white at the horizon, lilac-blue
// shade (the ambient light is what colours the shadows), low contrast.
const spring: Palette = {
  skyTop: '#7fbcf0', skyBottom: '#f6f4fb', haze: '#eef1fb',
  sun: '#fff5e6', sunIntensity: 1.9,
  hemiSky: '#cdd4ff', hemiGround: '#f3d3e2', hemiIntensity: 1.65,
  skyline: '#b8d2f3', shadowLift: '#8f8ad8', spriteTint: '#ffffff', nightness: 0, autumn: 0,
};

// Sunset: the orange autumn look, backlit and glowing.
const sunset: Palette = {
  skyTop: '#f4b68e', skyBottom: '#fff1dc', haze: '#fbe2c8',
  sun: '#ffc98c', sunIntensity: 2.0,
  hemiSky: '#ffd9c2', hemiGround: '#e9a896', hemiIntensity: 1.5,
  skyline: '#e2bcc8', shadowLift: '#b0709a', spriteTint: '#fff2e2', nightness: 0.08, autumn: 1,
};

const dusk: Palette = {
  skyTop: '#8a84c8', skyBottom: '#f6b49a', haze: '#e0aeb4',
  sun: '#ff9d70', sunIntensity: 1.2,
  hemiSky: '#c9b2e6', hemiGround: '#8d6888', hemiIntensity: 1.1,
  skyline: '#9a90c8', shadowLift: '#5a4880', spriteTint: '#f1d6de', nightness: 0.45, autumn: 0.8,
};

const night: Palette = {
  skyTop: '#1f2654', skyBottom: '#534683', haze: '#463f78',
  sun: '#a9bbff', sunIntensity: 0.55,
  hemiSky: '#5c68b4', hemiGround: '#352a52', hemiIntensity: 0.9,
  skyline: '#3a4078', shadowLift: '#26214a', spriteTint: '#8f93c6', nightness: 1, autumn: 0.3,
};

const dawn: Palette = {
  skyTop: '#a4c2ec', skyBottom: '#ffdcd2', haze: '#f3dde4',
  sun: '#ffd0b4', sunIntensity: 1.5,
  hemiSky: '#dcdcf6', hemiGround: '#c49fb0', hemiIntensity: 1.35,
  skyline: '#b2bfe6', shadowLift: '#7d6a98', spriteTint: '#f6e6ee', nightness: 0.25, autumn: 0,
};

// Keyframes around the day. t is 0..1; the journey starts on a spring day.
const keys: { t: number; p: Palette }[] = [
  { t: 0.0, p: spring },
  { t: 0.36, p: spring },
  { t: 0.46, p: sunset },
  { t: 0.54, p: sunset },
  { t: 0.62, p: dusk },
  { t: 0.7, p: night },
  { t: 0.86, p: night },
  { t: 0.93, p: dawn },
  { t: 1.0, p: spring },
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
  autumn: number;
}

const colorKeys = [
  'skyTop', 'skyBottom', 'haze', 'sun', 'hemiSky', 'hemiGround', 'skyline', 'shadowLift', 'spriteTint',
] as const;
const numberKeys = ['sunIntensity', 'hemiIntensity', 'nightness', 'autumn'] as const;

export function createResolvedPalette(): ResolvedPalette {
  return {
    skyTop: new THREE.Color(), skyBottom: new THREE.Color(), haze: new THREE.Color(),
    sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
    skyline: new THREE.Color(), shadowLift: new THREE.Color(), spriteTint: new THREE.Color(),
    sunIntensity: 0, hemiIntensity: 0, nightness: 0, autumn: 0,
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
  { t: 0.0, az: 0.9, el: 0.95 }, // spring day: high, from behind and to the right
  { t: 0.36, az: 1.3, el: 0.7 },
  { t: 0.46, az: 2.2, el: 0.3 }, // sunset: low and ahead, backlighting the street
  { t: 0.54, az: 2.45, el: 0.18 },
  { t: 0.62, az: 2.6, el: 0.08 },
  { t: 0.68, az: -0.8, el: 0.85 }, // moon
  { t: 0.86, az: -1.0, el: 0.75 },
  { t: 0.93, az: -1.2, el: 0.35 }, // dawn
  { t: 1.0, az: 0.9, el: 0.95 },
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
export const FOLIAGE = ['#9fd18a', '#b6dd8e', '#86c38a', '#c7e39a', '#a5d6a0'] as const;
export const INK = '#3b2a3a';
