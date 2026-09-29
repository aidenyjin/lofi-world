import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../rng';
import type { InkedBuilder } from './geo';

// Procedural rooftop residents built from the same toon primitives and ink
// outlines as the city, so they sit in the world instead of on top of it.
// Every part is tagged with a bone; the character shader (materials.ts) then
// animates heads, arms and bodies on the GPU in time with the music.

export enum Act {
  Idle = 0,
  Read = 1,
  Sip = 2,
  Paint = 3,
  Strum = 4,
  Wave = 5,
  Listen = 6,
  Row = 7,
}

export type Pose = 'stand' | 'sit';

enum Bone {
  Body = 0,
  Head = 1,
  ArmL = 2,
  ArmR = 3,
}

type Species = 'bear' | 'bunny' | 'cat' | 'fox' | 'sheep' | 'frog' | 'raccoon';
const SPECIES: Species[] = ['bear', 'bunny', 'cat', 'fox', 'sheep', 'frog', 'raccoon'];

const FUR: Record<Species, string[]> = {
  bear: ['#b98563', '#f7f1ea', '#8c6a58', '#d9a27a'],
  bunny: ['#f4c6c9', '#fff4ea', '#d9c2b0', '#c8b5e6'],
  cat: ['#f2a066', '#9f98b0', '#fff1d6', '#5e5468'],
  fox: ['#ee8b52', '#e9a36a'],
  sheep: ['#fff4ea'],
  frog: ['#9fd49a', '#8cc59a', '#b5d98a'],
  raccoon: ['#a39cb2', '#b3a8a0'],
};
const SHIRTS = ['#e9786f', '#f6c453', '#7fb3e8', '#b99ae0', '#f39bb5', '#8fd1b5', '#f5a25d', '#fff1d6', '#a9c9f0'];
const PANTS = ['#6d6a8c', '#8fb3e0', '#c8b5e6', '#d9b08a', '#7a8f7a', '#4f5a7a'];
const HATS = ['#e9786f', '#f6c453', '#6fa7e0', '#57b39a', '#b18ad8', '#fff1d6'];
const INKC = '#3b2a3a';
const CREAM = '#fff1d6';

function welded(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g);
  m.computeVertexNormals();
  return m;
}
const SPH = welded(new THREE.IcosahedronGeometry(1, 1));
const SPH0 = welded(new THREE.IcosahedronGeometry(1, 0));
const CONE = new THREE.ConeGeometry(1, 1, 8);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const RING = new THREE.TorusGeometry(1, 0.12, 5, 14);
const capsules = new Map<number, THREE.CapsuleGeometry>();
/** Capsule of radius 1 whose straight part is `ratio` long (scale it uniformly). */
function capsule(ratio: number): THREE.CapsuleGeometry {
  const key = Math.round(ratio * 4) / 4;
  let g = capsules.get(key);
  if (!g) {
    g = new THREE.CapsuleGeometry(1, key, 2, 8);
    capsules.set(key, g);
  }
  return g;
}

const root = new THREE.Matrix4();
const local = new THREE.Matrix4();
const out = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
const tmp = new THREE.Vector3();

export interface CharacterOptions {
  pose: Pose;
  act: Act;
  scale?: number;
  yaw?: number;
}

/**
 * Build one resident with its feet at (x, y, z) into `ink`, which must be
 * rendered with the rigged character materials.
 */
export function buildCharacter(ink: InkedBuilder, rng: Rng, x: number, y: number, z: number, opts: CharacterOptions) {
  const species = rng.pick(SPECIES);
  const fur = rng.pick(FUR[species]);
  const shirt = rng.pick(SHIRTS);
  const pants = rng.pick(PANTS);
  const sit = opts.pose === 'sit';
  const act = opts.act;
  const seed = rng.next();
  const scale = (opts.scale ?? 1.25) * rng.range(0.92, 1.06);
  const yaw = opts.yaw ?? rng.range(-0.35, 0.35);
  root.compose(V.set(x, y, z), q.setFromEuler(e.set(0, yaw, 0)), S.set(scale, scale, scale));
  const rootW = new THREE.Vector3(x, y, z);

  const toWorld = (lx: number, ly: number, lz: number) => tmp.set(lx, ly, lz).applyMatrix4(root).clone();
  const tag = (bone: Bone, px: number, py: number, pz: number) => {
    const p = toWorld(px, py, pz);
    ink.setTag([bone, p.x, p.y, p.z, rootW.x, rootW.y, rootW.z, act, seed]);
  };
  const part = (geo: THREE.BufferGeometry, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: string, rx = 0, ry = 0, rz = 0, outline = true) => {
    local.compose(V.set(lx, ly, lz), q.setFromEuler(e.set(rx, ry, rz)), S.set(sx, sy, sz));
    out.multiplyMatrices(root, local);
    // Tiny details (eyes, noses, hands, feet) don't need round spheres.
    if (geo === SPH && Math.max(sx, sy, sz) < 0.17) geo = SPH0;
    if (outline) ink.geometry(geo, out, color);
    else ink.fill.geometry(geo, out, color);
  };
  const limb = (x0: number, y0: number, z0: number, pitch: number, roll: number, len: number, r: number, color: string) => {
    // Capsule hanging from (x0,y0,z0), rotated like the shader rotates it.
    const dir = new THREE.Vector3(0, -1, 0).applyEuler(new THREE.Euler(pitch, 0, roll));
    const c = new THREE.Vector3(x0, y0, z0).addScaledVector(dir, len / 2);
    part(capsule(len / r - 2 > 0 ? (len - 2 * r) / r : 0.25), c.x, c.y, c.z, r, r, r, color, pitch, 0, roll);
    return new THREE.Vector3(x0, y0, z0).addScaledVector(dir, len);
  };

  const drop = sit ? 0.45 : 0;
  // ---------------------------------------------------------------- body
  tag(Bone.Body, 0, 0, 0);
  if (sit) {
    for (const sx of [-0.2, 0.2]) {
      part(capsule(1.6), sx, 0.2, 0.28, 0.15, 0.15, 0.15, pants, Math.PI / 2);
      part(SPH, sx, 0.22, 0.66, 0.16, 0.13, 0.12, species === 'frog' ? fur : '#6b5a6a');
    }
  } else {
    for (const sx of [-0.2, 0.2]) {
      part(capsule(1.2), sx, 0.36, 0, 0.15, 0.15, 0.15, pants);
      part(SPH, sx, 0.08, 0.07, 0.16, 0.1, 0.22, species === 'frog' ? fur : '#6b5a6a');
    }
  }
  part(SPH, 0, 0.7 - drop * 0.5, 0, 0.46, 0.3, 0.4, pants);
  if (species === 'sheep') {
    // Wool jumper: puffs instead of a shirt
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      part(SPH, Math.cos(a) * 0.36, 1.0 - drop + Math.sin(a * 2) * 0.12, Math.sin(a) * 0.3, 0.26, 0.26, 0.26, fur);
    }
    part(SPH, 0, 1.0 - drop, 0, 0.48, 0.5, 0.4, rng.pick(SHIRTS));
  } else {
    part(SPH, 0, 1.0 - drop, 0, 0.5, 0.55, 0.42, shirt);
    // Collar / scarf
    if (rng.chance(0.25)) part(RING, 0, 1.42 - drop, 0, 0.3, 0.3, 0.45, rng.pick(HATS), Math.PI / 2);
    else part(SPH, 0, 1.38 - drop, 0.18, 0.2, 0.08, 0.1, CREAM, 0, 0, 0, false);
  }
  // Tails
  if (species === 'fox') {
    part(SPH, 0.35, 0.55 - drop * 0.6, -0.45, 0.22, 0.22, 0.55, fur, 0.6, 0.5, 0);
    part(SPH, 0.52, 0.85 - drop * 0.6, -0.72, 0.13, 0.13, 0.2, CREAM, 0.6, 0.5, 0, false);
  } else if (species === 'cat') {
    part(capsule(4), 0.3, 0.75 - drop * 0.6, -0.42, 0.06, 0.06, 0.06, fur, -0.5, 0, -0.6);
  } else if (species === 'raccoon') {
    for (let i = 0; i < 4; i++) part(SPH, 0.28 + i * 0.1, 0.45 - drop * 0.6 + i * 0.1, -0.4 - i * 0.12, 0.16, 0.16, 0.16, i % 2 ? '#4a3a48' : fur);
  } else if (species === 'bunny' || species === 'bear') {
    part(SPH, 0, 0.62 - drop * 0.6, -0.42, 0.14, 0.14, 0.14, species === 'bunny' ? CREAM : fur);
  }

  // Activity props that belong to the body
  if (act === Act.Read) {
    part(BOX, 0, 1.02 - drop, 0.52, 0.52, 0.38, 0.05, rng.pick(HATS), -0.55);
    part(BOX, 0, 1.03 - drop, 0.55, 0.46, 0.34, 0.03, CREAM, -0.55, 0, 0, false);
  } else if (act === Act.Strum) {
    part(SPH, 0.02, 0.95 - drop, 0.42, 0.22, 0.28, 0.08, '#d9a06a', 0, 0, 1.0);
    part(SPH, 0.02, 0.95 - drop, 0.49, 0.07, 0.07, 0.02, '#4a3a48', 0, 0, 0, false);
    part(BOX, -0.33, 1.2 - drop, 0.44, 0.55, 0.06, 0.04, '#8a6a4a', 0, 0, 0.55);
  } else if (act === Act.Paint) {
    // Easel beside the painter
    const ex = 0.9;
    part(BOX, ex - 0.2, 0.7, 0.35, 0.05, 1.45, 0.05, '#c08f6c', 0.12, 0, 0.12);
    part(BOX, ex + 0.2, 0.7, 0.35, 0.05, 1.45, 0.05, '#c08f6c', 0.12, 0, -0.12);
    part(BOX, ex, 1.2, 0.42, 0.62, 0.5, 0.04, CREAM, -0.12);
    part(BOX, ex, 1.2, 0.45, 0.5, 0.18, 0.01, '#a9c9f0', -0.12, 0, 0, false);
    part(BOX, ex - 0.08, 1.32, 0.45, 0.3, 0.12, 0.01, '#f8dea0', -0.12, 0, 0, false);
  }

  // ---------------------------------------------------------------- arms
  const shoulderY = 1.3 - drop;
  const armLen = 0.62;
  const armR: [number, number] = act === Act.Read ? [-1.0, 0.3] : act === Act.Sip ? [-0.9, 0.35] : act === Act.Strum ? [-0.7, -0.25]
    : act === Act.Paint ? [-0.8, 0.5] : act === Act.Row ? [-0.9, 0.1] : [0.05, 0.12];
  const armL: [number, number] = act === Act.Read ? [-1.0, -0.3] : act === Act.Strum ? [-0.95, -0.75] : act === Act.Row ? [-0.9, -0.1]
    : act === Act.Listen && sit ? [-0.6, -0.15] : [0.05, -0.12];
  const sleeve = species === 'sheep' ? fur : shirt;

  tag(Bone.ArmL, -0.44, shoulderY, 0);
  const handL = limb(-0.44, shoulderY, 0, armL[0], armL[1], armLen, 0.12, sleeve);
  part(SPH, handL.x, handL.y, handL.z, 0.12, 0.12, 0.12, fur);

  tag(Bone.ArmR, 0.44, shoulderY, 0);
  const handR = limb(0.44, shoulderY, 0, armR[0], armR[1], armLen, 0.12, sleeve);
  part(SPH, handR.x, handR.y, handR.z, 0.12, 0.12, 0.12, fur);
  if (act === Act.Sip) {
    part(CYL, handR.x - 0.05, handR.y + 0.1, handR.z + 0.08, 0.11, 0.2, 0.11, rng.pick(['#f0a497', '#a9c9f0', CREAM]));
    part(RING, handR.x + 0.07, handR.y + 0.1, handR.z + 0.08, 0.06, 0.06, 0.06, '#f0a497', 0, Math.PI / 2, 0, false);
  } else if (act === Act.Paint) {
    part(CYL, handR.x + 0.05, handR.y + 0.12, handR.z + 0.05, 0.02, 0.35, 0.02, '#c08f6c', 0, 0, -0.5, false);
    part(SPH, handR.x + 0.13, handR.y + 0.27, handR.z + 0.05, 0.04, 0.05, 0.04, '#e9786f', 0, 0, 0, false);
  } else if (act === Act.Row) {
    part(CYL, handR.x, handR.y, handR.z + 0.1, 0.03, 1.4, 0.03, '#c08f6c', 0.9, 0, 0.8, false);
  }

  // ---------------------------------------------------------------- head
  const neckY = 1.45 - drop;
  const hy = 1.88 - drop;
  tag(Bone.Head, 0, neckY, 0);
  const headR = species === 'sheep' ? 0.42 : 0.52;
  const headS: [number, number, number] = species === 'frog' ? [1.15, 0.72, 1.0] : [1, 0.9, 0.92];
  part(SPH, 0, hy, 0.02, headR * headS[0], headR * headS[1], headR * headS[2], species === 'sheep' ? '#f6cfc4' : fur);
  const faceZ = species === 'sheep' ? 0.36 : 0.44;
  const sleepy = act === Act.Listen || act === Act.Read || rng.chance(0.3);
  const eyeY = hy + 0.05;

  switch (species) {
    case 'bear':
      for (const sx of [-1, 1]) part(SPH, sx * 0.34, hy + 0.36, -0.02, 0.15, 0.15, 0.1, fur);
      break;
    case 'bunny':
      for (const sx of [-1, 1]) part(capsule(3), sx * 0.16, hy + 0.66, -0.05, 0.09, 0.09, 0.07, fur, 0, 0, -sx * 0.14);
      break;
    case 'cat':
    case 'fox':
      for (const sx of [-1, 1]) part(CONE, sx * 0.3, hy + 0.42, 0, species === 'fox' ? 0.19 : 0.16, species === 'fox' ? 0.4 : 0.3, 0.12, fur, 0, 0, -sx * 0.28);
      break;
    case 'sheep':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI - Math.PI * 0.05;
        part(SPH, Math.cos(a) * 0.4, hy + 0.12 + Math.sin(a) * 0.32, -0.08, 0.22, 0.22, 0.22, fur);
      }
      for (const sx of [-1, 1]) part(SPH, sx * 0.5, hy - 0.02, 0, 0.18, 0.07, 0.1, '#f6cfc4', 0, 0, sx * 0.4);
      break;
    case 'frog':
      for (const sx of [-1, 1]) {
        part(SPH, sx * 0.3, hy + 0.3, 0.12, 0.18, 0.18, 0.18, fur);
        part(SPH, sx * 0.3, hy + 0.32, 0.28, 0.07, 0.08, 0.04, INKC, 0, 0, 0, false);
      }
      part(BOX, 0, hy - 0.12, 0.48, 0.36, 0.025, 0.02, INKC, 0, 0, 0, false);
      break;
    case 'raccoon':
      for (const sx of [-1, 1]) part(SPH, sx * 0.34, hy + 0.36, -0.02, 0.14, 0.14, 0.09, fur);
      part(SPH, 0, eyeY, 0.36, 0.42, 0.12, 0.14, '#4a3a48', 0, 0, 0, false);
      break;
  }
  if (species !== 'frog') {
    // Eyes: dots, or sleepy lines
    for (const sx of [-1, 1]) {
      part(SPH, sx * 0.18, eyeY, faceZ + (species === 'raccoon' ? 0.06 : 0), 0.055, sleepy ? 0.018 : 0.07, 0.03, species === 'raccoon' ? CREAM : INKC, 0, 0, 0, false);
    }
    // Muzzle and nose
    if (species === 'fox') part(CONE, 0, hy - 0.1, 0.52, 0.16, 0.3, 0.12, CREAM, Math.PI / 2);
    else part(SPH, 0, hy - 0.12, faceZ - 0.04, 0.2, 0.14, 0.14, species === 'sheep' ? '#f9ddd4' : CREAM, 0, 0, 0, false);
    part(SPH, 0, hy - 0.06, faceZ + (species === 'fox' ? 0.22 : 0.1), 0.06, 0.045, 0.04, INKC, 0, 0, 0, false);
  }

  // Accessories
  if (act === Act.Listen || rng.chance(0.08)) {
    part(RING, 0, hy + 0.05, 0.0, headR * 1.08, headR * 1.08, 0.5, '#e9786f', 0, 0, 0, false);
    for (const sx of [-1, 1]) part(CYL, sx * headR * 1.05, hy - 0.02, 0.02, 0.15, 0.1, 0.15, '#e9786f', 0, 0, Math.PI / 2);
  } else if (act === Act.Paint) {
    part(CYL, 0, hy + 0.36, 0, 0.8, 0.03, 0.8, '#f6c453');
    part(SPH, 0, hy + 0.4, 0, 0.36, 0.22, 0.36, '#f6c453');
    part(RING, 0, hy + 0.4, 0, 0.36, 0.36, 0.5, '#6fa7e0', Math.PI / 2, 0, 0, false);
  } else if (species !== 'bunny' && species !== 'sheep' && rng.chance(0.35)) {
    const hat = rng.pick(HATS);
    if (rng.chance(0.5)) {
      part(SPH, 0, hy + 0.3, -0.02, 0.5, 0.3, 0.48, hat); // beanie
      part(RING, 0, hy + 0.22, -0.02, 0.5, 0.48, 0.6, hat, Math.PI / 2, 0, 0, false);
    } else {
      part(CYL, 0, hy + 0.36, 0, 0.62, 0.04, 0.62, hat); // bucket hat
      part(CYL, 0, hy + 0.48, 0, 0.42, 0.24, 0.42, hat);
    }
  }
  if (act === Act.Read && rng.chance(0.6)) {
    for (const sx of [-1, 1]) part(RING, sx * 0.18, eyeY, faceZ + 0.06, 0.1, 0.1, 0.3, INKC, 0, 0, 0, false);
  }
}
