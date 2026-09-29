import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, hashSeed } from '../rng';
import { FOLIAGE } from '../palette';
import { GeoBuilder, InkedBuilder } from './geo';
import type { Materials } from './materials';
import type { UVRect } from './textures';
import { windowColor } from './windows';
import { areaAt, RUN, type District, type Hood, type HoodName } from './hoods';
import { Surf } from './surfaces';
import { railZ, railSlope, railYaw, trackPoint, railY, inTunnel, portalsIn, stationsIn, STATION_LEN, STATION_NAMES, DECK_H, TRACK_OFFSET } from './rail';

// The city is generated in chunks along +X (the direction the camera drifts).
// Each chunk is a strip of blocks receding into the distance:
//
//   z -12 .. -19   the canal, crossed by a stone bridge at every avenue
//   row 1..4       blocks separated by streets, the elevated train over the last
//
// The camera travels along +X down the canal, so each chunk index is built
// twice: the main bank, and a mirrored far bank (different seed) reflected
// across the canal's centre line so both sides have facades facing the water.
//
// An avenue runs toward the horizon at the start of every chunk (x 0..4).

export const CHUNK_W = 36;

export { districtAt, type District } from './hoods';


const BLOCK_DEPTH = 16;
const STREET = 5;
const ROWS = 5;
const ROW_HEIGHTS: [number, number][] = [
  [3, 7], [5, 11], [7, 13], [8, 16], [12, 26],
];
const FLOOR = 2.6;

export const rowFront = (row: number) => 2 - row * (BLOCK_DEPTH + STREET);
/** The canal runs in front of row 1. */
export const CANAL_Z0 = rowFront(1); // far wall side (-19)
export const CANAL_Z1 = rowFront(1) + STREET + 2; // near wall side (-12)
export const CANAL_Z = (CANAL_Z0 + CANAL_Z1) / 2;
export const WATER_Y = -0.7;
/** The tram street (in front of row 2) and the bus street (in front of row 3). */
export const TRAM_STREET = rowFront(2) + STREET / 2;
export const BUS_STREET = rowFront(3) + STREET / 2;
const AVENUE_W = 4;
const WALK = 0.9; // sidewalk width

const RUST = '#b86f62';
const WOOD = '#c08f6c';
const METAL = '#b9b3cc';
const CONCRETE = '#cbbfd4';
const TRUNK = '#7b5a57';
const STONE = '#cdb9b0';
const ASPHALT = '#a99fb4';
const PAVEMENT = '#e4d4d2';
const KERB = '#f1e5df';
const ACCENTS = ['#e9786f', '#6fa7e0', '#57b39a', '#f6b94f', '#b18ad8', '#f28fb0', '#d96a58'] as const;
const FRUIT = ['#f29a4a', '#e9544f', '#f5d45a', '#8bc36a', '#b56ad0', '#ffb38a'] as const;
const FLOWERS = ['#f28fb0', '#fff1d6', '#f5d45a', '#e9786f', '#b18ad8'] as const;
type StallKind = 'produce' | 'flowers' | 'fish' | 'bakery' | 'books' | 'records' | 'clothes' | 'food' | 'dumplings' | 'lanterns' | 'tea' | 'gadgets' | 'plants' | 'nets';
type Canopy = 'striped' | 'solid' | 'umbrella' | 'tent' | 'cart';
const STALLS: Record<HoodName, StallKind[]> = {
  oldtown: ['produce', 'flowers', 'bakery', 'books', 'food', 'produce'],
  chinatown: ['dumplings', 'lanterns', 'produce', 'tea', 'food', 'dumplings'],
  harbour: ['fish', 'fish', 'food', 'nets', 'produce'],
  neon: ['gadgets', 'food', 'records', 'clothes', 'dumplings'],
  arts: ['records', 'books', 'clothes', 'flowers', 'food', 'plants'],
  garden: ['flowers', 'plants', 'bakery', 'produce', 'tea'],
  parkland: ['flowers', 'food', 'produce', 'plants', 'bakery'],
};
const CANOPIES: Record<HoodName, Canopy[]> = {
  oldtown: ['striped', 'striped', 'solid', 'umbrella', 'cart'],
  chinatown: ['solid', 'tent', 'cart', 'umbrella'],
  harbour: ['striped', 'solid', 'cart'],
  neon: ['solid', 'cart', 'tent'],
  arts: ['umbrella', 'striped', 'tent', 'cart'],
  garden: ['striped', 'umbrella', 'tent'],
  parkland: ['umbrella', 'cart', 'striped', 'tent'],
};
const BLOSSOM = ['#f7b8cf', '#f4a6c0', '#fbd3e0', '#f29fb8'] as const;
const MAPLE = ['#e9786f', '#f29a4a', '#d96a58', '#f6b94f'] as const;
const CAR_COLORS = ['#f0a497', '#a9c9f0', '#f8dea0', '#bde2d0', '#c8b5e6', '#fff1d6'] as const;

// Shared unit geometries, reused for every instance via matrices.
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const CONE = new THREE.ConeGeometry(1, 1, 14);
const CONE8 = new THREE.ConeGeometry(1, 1, 8);
// Welded (indexed) spheres: ~6x fewer vertices than raw icosahedra and
// smooth normals, which the toon ramp turns into soft painted blobs.
function welded(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g);
  m.computeVertexNormals();
  return m;
}
const BLOB = welded(new THREE.IcosahedronGeometry(1, 1));
const BULB = welded(new THREE.IcosahedronGeometry(1, 0));
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const TORUS = new THREE.TorusGeometry(1, 0.18, 6, 16);
const VAULT = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true, -Math.PI / 2, Math.PI);
const BOX1 = new THREE.BoxGeometry(1, 1, 1);
const WHEEL = new THREE.TorusGeometry(0.28, 0.035, 5, 12);
const SIGN_PLANE = new THREE.PlaneGeometry(1, 1);
/**
 * Hip roof over a w×d rectangle, base at y = 0: four sloped faces meeting in a
 * ridge along the longer side (a pyramid when square). Built to size rather than
 * by scaling a rotated cone, which skews into a rhombus on non-square footprints.
 */
function hipRoof(w: number, d: number, rise: number): THREE.BufferGeometry {
  const long = Math.max(w, d), short = Math.min(w, d);
  const hw = long / 2, hd = short / 2, k = hw - hd;
  const A = [-hw, 0, hd], B = [hw, 0, hd], C = [hw, 0, -hd], D = [-hw, 0, -hd];
  const R1 = [-k, rise, 0], R2 = [k, rise, 0];
  const tris = [A, B, R2, A, R2, R1, C, D, R1, C, R1, R2, B, C, R2, D, A, R1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  if (d > w) g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Fill and ink hull for a hip roof whose eaves sit at (x, y, z). */
function hipRoofInked(ink: InkedBuilder, x: number, y: number, z: number, w: number, d: number, rise: number, color: string) {
  const fill = hipRoof(w, d, rise);
  const hull = hipRoof(w + 0.24, d + 0.24, rise + 0.16);
  ink.surface = Surf.Tiles;
  ink.fill.geometry(fill, mat(x, y, z, 1, 1, 1), color);
  ink.surface = Surf.Plain;
  ink.outline.geometry(hull, mat(x, y - 0.04, z, 1, 1, 1), 0x000000);
  fill.dispose();
  hull.dispose();
}

/** Keeps rooftop (and park) props from overlapping: each claims a footprint. */
class Occupancy {
  private rects: [number, number, number, number][] = [];
  constructor(private area: { x0: number; x1: number; z0: number; z1: number }) {}

  /** Claim a w×d footprint centred at (x, z) if it's free and inside the area. */
  reserve(x: number, z: number, w: number, d: number): boolean {
    const r: [number, number, number, number] = [x - w / 2, x + w / 2, z - d / 2, z + d / 2];
    const a = this.area;
    if (r[0] < a.x0 - 0.01 || r[1] > a.x1 + 0.01 || r[2] < a.z0 - 0.01 || r[3] > a.z1 + 0.01) return false;
    for (const o of this.rects) if (r[0] < o[1] + 0.2 && r[1] > o[0] - 0.2 && r[2] < o[3] + 0.2 && r[3] > o[2] - 0.2) return false;
    this.rects.push(r);
    return true;
  }

  /** Find a free spot for a w×d footprint (optionally in the back half). */
  place(rng: Rng, w: number, d: number, back = false): { x: number; z: number } | null {
    const a = this.area;
    const zMax = back ? (a.z0 + a.z1) / 2 + d / 2 : a.z1 - d / 2;
    for (let i = 0; i < 10; i++) {
      if (a.x1 - a.x0 < w || zMax - (a.z0 + d / 2) < 0) return null;
      const x = rng.range(a.x0 + w / 2, a.x1 - w / 2);
      const z = rng.range(a.z0 + d / 2, Math.max(a.z0 + d / 2, zMax));
      if (this.reserve(x, z, w, d)) return { x, z };
    }
    return null;
  }
}

/** Where viaduct pillars stand (world X), every 12 units offset off the avenues. */
function pillarXs(x0: number, x1: number): number[] {
  const out: number[] = [];
  for (let wx = Math.ceil((x0 - 6) / 12) * 12 + 6; wx < x1; wx += 12) out.push(wx);
  return out;
}
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const eul = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();

function mat(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0): THREE.Matrix4 {
  q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
  return m4.compose(v.set(x, y, z), q, s.set(sx, sy, sz));
}

function matE(x: number, y: number, z: number, sx: number, sy: number, sz: number, rx: number, ry = 0, rz = 0): THREE.Matrix4 {
  q.setFromEuler(eul.set(rx, ry, rz));
  return m4.compose(v.set(x, y, z), q, s.set(sx, sy, sz));
}

/** All the per-material builders one chunk writes into. */
interface Builders {
  ink: InkedBuilder;
  lit: GeoBuilder;
  dark: GeoBuilder;
  bulbs: GeoBuilder;
  glow: GeoBuilder;
  signs: GeoBuilder;
  neon: GeoBuilder;
  flags: GeoBuilder;
  water: GeoBuilder;
  glass: GeoBuilder;
  emissive: GeoBuilder;
  wires: THREE.Vector3[][];
}

/**
 * Draw a small car into `ink` at (x, y, z) pointing along +X rotated by rotY.
 * Shared with the moving traffic so parked and driving cars match.
 */
export function buildCar(ink: InkedBuilder, lights: GeoBuilder | null, x: number, y: number, z: number, rotY: number, color: string, van = false) {
  const c = Math.cos(rotY), sn = Math.sin(rotY);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * sn, z - lx * sn + lz * c];
  const L = van ? 2.6 : 2.3;
  let [px, pz] = at(0, 0);
  ink.box(px, y + 0.45, pz, L, 0.55, 1.15, color, rotY);
  if (van) {
    [px, pz] = at(-0.25, 0);
    ink.box(px, y + 1.0, pz, 1.9, 0.65, 1.1, color, rotY);
  } else {
    [px, pz] = at(-0.15, 0);
    ink.box(px, y + 0.95, pz, 1.25, 0.5, 1.02, color, rotY);
  }
  // Windows band
  [px, pz] = at(van ? -0.25 : -0.15, 0);
  ink.fill.box(px, y + (van ? 1.08 : 0.97), pz, van ? 1.92 : 1.27, 0.26, 1.04, '#5d6a9c', rotY);
  for (const [wx, wz] of [[0.75, 0.55], [-0.75, 0.55], [0.75, -0.55], [-0.75, -0.55]]) {
    [px, pz] = at(wx, wz);
    q.setFromEuler(eul.set(Math.PI / 2, rotY, 0, 'YXZ'));
    ink.fill.geometry(CYL, m4.compose(v.set(px, y + 0.2, pz), q, s.set(0.22, 0.14, 0.22)), '#4a3a48');
    eul.order = 'XYZ';
  }
  if (lights) {
    for (const hz of [0.35, -0.35]) {
      [px, pz] = at(L / 2 + 0.01, hz);
      lights.geometry(BULB, mat(px, y + 0.5, pz, 0.09, 0.07, 0.09), '#ffffff');
    }
  }
}

export class CityChunk {
  readonly group = new THREE.Group();
  /** World-space chimney tops (smoke emitters). */
  readonly chimneys: THREE.Vector3[] = [];
  /** World-space fountain spouts. */
  readonly fountains: THREE.Vector3[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(
    readonly index: number,
    private worldSeed: number,
    private mats: Materials,
    readonly mirrored = false,
  ) {
    this.group.position.x = index * CHUNK_W;
    const area = areaAt(worldSeed, index);
    this.district = area.district;
    this.hood = area.hood;
    this.runStart = area.runStart;
    if (mirrored) {
      // Reflect across z = CANAL_Z (three.js flips face winding for us).
      this.group.scale.z = -1;
      this.group.position.z = 2 * CANAL_Z;
    }
    this.generate();
  }

  /** Local z to world z (the far bank is mirrored). */
  private wz(z: number) {
    return this.mirrored ? 2 * CANAL_Z - z : z;
  }

  /** Mirrored facades would show sign text backwards; flip those UVs. */
  private signUV(uv: UVRect): UVRect {
    return this.mirrored ? [uv[2], uv[1], uv[0], uv[3]] : uv;
  }

  readonly district: District = 'canal';
  readonly hood: Hood;
  private runStart = false;

  /** Things sticking out of each row's street facade (local x ranges), so kerbside trees and lamps can dodge them. */
  private frontage = new Map<number, [number, number][]>();
  private kerbQueue: { row: number; x: number; half: number; fn: (x: number) => void }[] = [];
  private curRow = 0;

  private blockFront(x0: number, x1: number, row = this.curRow) {
    let list = this.frontage.get(row);
    if (!list) this.frontage.set(row, (list = []));
    list.push([Math.min(x0, x1), Math.max(x0, x1)]);
  }

  /** Queue a kerbside item; it's placed after the buildings, nudged clear of awnings and balconies. */
  private kerb(row: number, x: number, half: number, fn: (x: number) => void) {
    this.kerbQueue.push({ row, x, half, fn });
  }

  private flushKerb() {
    for (const k of this.kerbQueue) {
      const list = this.frontage.get(k.row) ?? [];
      for (const off of [0, 0.9, -0.9, 1.8, -1.8, 2.7, -2.7]) {
        const x = k.x + off;
        if (x - k.half < AVENUE_W + 0.6 || x + k.half > CHUNK_W - 0.3) continue;
        if (list.some(([a, c]) => x + k.half > a && x - k.half < c)) continue;
        k.fn(x);
        list.push([x - k.half, x + k.half]);
        this.frontage.set(k.row, list);
        break;
      }
    }
    this.kerbQueue.length = 0;
  }

  private get x0() {
    return this.group.position.x;
  }

  private generate() {
    const rng = new Rng(hashSeed(this.worldSeed, this.index, this.mirrored ? 0x6d : 0x51));
    const b: Builders = {
      ink: new InkedBuilder(0.08),
      lit: new GeoBuilder(),
      dark: new GeoBuilder(),
      bulbs: new GeoBuilder(),
      glow: new GeoBuilder(),
      signs: new GeoBuilder(),
      neon: new GeoBuilder(),
      flags: new GeoBuilder(),
      water: new GeoBuilder(),
      glass: new GeoBuilder(),
      emissive: new GeoBuilder(),
      wires: [],
    };

    this.ground(b);
    this.corridor(rng, b);
    this.streets(rng, b);

    const lastRow = this.mirrored ? ROWS - 2 : ROWS - 1;
    // One landmark per neighbourhood run, midway through it, on the main bank.
    let wantLandmark = !this.mirrored && this.index > 0 && ((this.index % RUN) + RUN) % RUN === 2;
    for (let row = 1; row <= lastRow; row++) {
      const zFront = rowFront(row);
      let x = AVENUE_W;
      while (x < CHUNK_W - 2.5) {
        const w = Math.min(rng.range(4.5, 9), CHUNK_W - x);
        if (w < 3) break;
        const split = rng.chance(0.45);
        const depths = split ? [rng.range(6, 9)] : [BLOCK_DEPTH];
        if (split) depths.push(BLOCK_DEPTH - depths[0]);
        let z = zFront;
        depths.forEach((d, i) => {
          const lotCx = x + w / 2;
          const lotCz = z - d / 2;
          const facesStreet = i === 0;
          const roll = rng.next();
          const rail = this.railLimit(x, x + w, z - d, z);
          if (rail !== null && rail < 4.5 + FLOOR) {
            this.railside(rng, b, lotCx, lotCz, w, d);
            z -= d;
            return;
          }
          if (wantLandmark && row === 2 && facesStreet && w >= 6 && rail === null && this.railLimit(x - 3, x + w + 3, z - d - 3, z + 3) === null) {
            wantLandmark = false;
            this.landmark(rng, b, lotCx, lotCz, w, d);
          } else if (row >= 1 && row <= 3 && facesStreet && roll < this.hood.marketChance && w > 5) {
            this.market(rng, b, lotCx, lotCz, w, d);
          } else if (row < 4 && roll < this.hood.marketChance + this.hood.parkChance) {
            if (this.hood.name === 'harbour') this.yard(rng, b, lotCx, lotCz, w, d);
            else this.park(rng, b, lotCx, lotCz, w, d);
          } else {
            this.building(rng, b, row, lotCx, lotCz, w - rng.range(0.1, 0.6), d - rng.range(0.1, 0.5), facesStreet);
          }
          z -= d;
        });
        x += w;
      }
    }

    this.flushKerb();
    this.powerLines(rng, b);
    if (!this.mirrored) this.viaduct(rng, b);
    this.flush(b);
  }

  private flush(b: Builders) {
    const m = this.mats;
    this.addMesh(b.ink.fill.build(), m.toon, true);
    this.addMesh(b.ink.outline.build(), m.ink, false);
    const opt: [GeoBuilder, THREE.Material, boolean?][] = [
      [b.lit, m.windows], [b.dark, m.windowDark], [b.bulbs, m.bulb],
      [b.signs, m.signs], [b.neon, m.neon], [b.flags, m.flags, true], [b.water, m.water],
      [b.glow, m.glow], [b.glass, m.glass], [b.emissive, m.emissive],
    ];
    for (const [builder, material, shadow] of opt) if (!builder.empty) this.addMesh(builder.build(), material, !!shadow);
    if (b.wires.length) {
      const segs: number[] = [];
      for (const line of b.wires) {
        for (let i = 0; i < line.length - 1; i++) {
          segs.push(line[i].x, line[i].y, line[i].z, line[i + 1].x, line[i + 1].y, line[i + 1].z);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      this.disposables.push(g);
      this.group.add(new THREE.LineSegments(g, m.wire));
    }
  }

  private addMesh(geo: THREE.BufferGeometry, material: THREE.Material, shadows: boolean) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (material === this.mats.glow || material === this.mats.glass) mesh.renderOrder = 2;
    this.group.add(mesh);
    this.disposables.push(geo);
  }

  // =========================================================================
  // Ground, streets and the canal

  private ground(b: Builders) {
    const { fill } = b.ink;
    // One slab per bank; the mirrored chunk supplies the far one.
    const backDepth = CANAL_Z0 + 112;
    fill.surface = Surf.Paving;
    fill.box(CHUNK_W / 2, -0.3, CANAL_Z0 - backDepth / 2, CHUNK_W + 0.02, 0.6, backDepth, PAVEMENT);
    fill.surface = Surf.Plain;
  }

  /**
   * The corridor between the two banks (z CANAL_Z0..CANAL_Z1). The main bank
   * builds the shared middle; each bank builds the features on its own half,
   * which the mirror then turns to face the other side.
   */
  private corridor(rng: Rng, b: Builders) {
    const d = this.district;
    if (d === 'canal') {
      if (this.mirrored) this.canalLanterns(rng, b);
      else this.canal(rng, b);
      return;
    }
    const { ink } = b;
    const zc = CANAL_Z;
    const width = CANAL_Z1 - CANAL_Z0;
    const half0 = CANAL_Z0; // this bank's edge
    if (!this.mirrored) {
      ink.surface = d === 'park' ? Surf.Grass : Surf.Paving;
      ink.fill.box(CHUNK_W / 2, -0.3, zc, CHUNK_W + 0.02, 0.6, width, PAVEMENT);
      ink.surface = Surf.Plain;
      if (this.runStart && this.hood.name === 'chinatown') this.gate(b, 6);
      // Festoons and bunting across, shared by both sides
      const across = d === 'market' ? 5 : d === 'street' ? 2 : 1;
      for (let i = 0; i < across; i++) {
        const x = ((i + rng.range(0.2, 0.8)) / across) * CHUNK_W;
        const a = new THREE.Vector3(x, rng.range(6.2, 7.2), CANAL_Z1 - 0.1);
        const c = new THREE.Vector3(x + rng.range(-2, 2), a.y, CANAL_Z0 + 0.1);
        this.festoon(rng, b, a, c, 0.75, d === 'market' ? i % 2 === 0 : rng.chance(0.5));
      }
    }
    if (d === 'street') {
      if (!this.mirrored) {
        ink.surface = Surf.Asphalt;
        ink.fill.quad(CHUNK_W / 2, 0.01, zc, CHUNK_W + 0.02, 4, 'py', ASPHALT);
        ink.surface = Surf.Plain;
        for (let x = 0.6; x < CHUNK_W; x += 2.4) ink.fill.quad(x, 0.02, zc, 1.1, 0.12, 'py', '#f3e7c9');
        for (let z = zc - 1.8; z < zc + 1.9; z += 0.5) ink.fill.quad(AVENUE_W + 0.9, 0.02, z, 1.3, 0.26, 'py', '#f6eee0');
      }
      ink.surface = Surf.Paving;
      ink.fill.box(CHUNK_W / 2, 0.08, half0 + 0.75, CHUNK_W + 0.02, 0.16, 1.5, PAVEMENT);
      ink.surface = Surf.Plain;
      ink.fill.box(CHUNK_W / 2, 0.17, half0 + 1.44, CHUNK_W + 0.02, 0.04, 0.12, KERB);
      const lampX = rng.range(3, 8);
      for (let x = lampX; x < CHUNK_W - 1; x += 9) this.kerb(1, x, 0.3, (kx) => this.lampPost(b, kx, half0 + 1.3, 0.16, true));
      for (let x = lampX + 4.5; x < CHUNK_W - 1; x += 9) {
        if (!rng.chance(0.7)) continue;
        const sc = rng.range(0.85, 1.0);
        const tr = new Rng(rng.int(0, 1e9));
        this.kerb(1, x, 0.8, (kx) => this.streetTree(tr, b, kx, 0.16, half0 + 1.0, sc));
      }
      for (let x = AVENUE_W + 2; x < CHUNK_W - 1; x += rng.range(4, 7)) if (rng.chance(0.5)) this.furniture(rng, b, x, half0 + 0.5);
    } else if (d === 'market') {
      if (!this.mirrored) {
        for (let x = 0.5; x < CHUNK_W; x += 1.0) ink.fill.quad(x, 0.004, zc, 0.04, width, 'py', '#d8c6c4');
        ink.fill.quad(CHUNK_W / 2, 0.005, zc, CHUNK_W, 1.2, 'py', '#e8d2c0');
      }
      for (let x = rng.range(1.5, 3); x < CHUNK_W - 1.5; x += rng.range(2.7, 3.3)) {
        if (x > AVENUE_W - 1 && x < AVENUE_W + 1.2) continue;
        this.stall(rng, b, x, half0 + 1.0, 2.2);
      }
    } else {
      // Park avenue: lawn, gravel walk, a row of trees and benches per side.
      if (!this.mirrored) {
        ink.fill.quad(CHUNK_W / 2, 0.004, zc, CHUNK_W + 0.02, width, 'py', '#b9d8a8');
        ink.fill.quad(CHUNK_W / 2, 0.006, zc, CHUNK_W + 0.02, 1.8, 'py', '#eadccb');
        const fx = rng.range(12, CHUNK_W - 12);
        ink.geometry(CYL, mat(fx, 0.25, zc, 1.3, 0.5, 1.3), STONE);
        b.water.geometry(CYL, mat(fx, 0.48, zc, 1.15, 0.02, 1.15), '#ffffff');
        ink.geometry(CYL, mat(fx, 0.8, zc, 0.16, 1.0, 0.16), STONE);
        ink.geometry(CYL, mat(fx, 1.3, zc, 0.55, 0.1, 0.55), STONE);
        this.fountains.push(new THREE.Vector3(fx + this.x0, 1.4, zc));
      }
      ink.box(CHUNK_W / 2, 0.3, half0 + 0.35, CHUNK_W + 0.02, 0.6, 0.6, '#8fb98a', 0, false);
      for (let x = 1; x < CHUNK_W; x += 1.3) ink.fill.geometry(BLOB, mat(x, 0.7, half0 + 0.4, 0.3, 0.24, 0.3), rng.pick(FLOWERS));
      for (let x = rng.range(1, 3); x < CHUNK_W - 1; x += 5) {
        const sc = rng.range(0.9, 1.05);
        const tr = new Rng(rng.int(0, 1e9));
        this.kerb(1, x, 0.8, (kx) => this.streetTree(tr, b, kx, 0, half0 + 1.2, sc));
      }
      for (let x = rng.range(4, 6); x < CHUNK_W - 2; x += 10) {
        ink.box(x, 0.45, half0 + 2.1, 1.6, 0.1, 0.5, WOOD);
        ink.box(x, 0.8, half0 + 1.85, 1.6, 0.4, 0.08, WOOD);
        this.kerb(1, x + 2.5, 0.3, (kx) => this.lampPost(b, kx, half0 + 1.9, 0, false));
      }
    }
  }

  /** A paifang gate spanning the corridor at the start of Chinatown. */
  private gate(b: Builders, x: number) {
    const { ink } = b;
    const z0 = CANAL_Z0 + 0.4, z1 = CANAL_Z1 - 0.4;
    for (const z of [z0, z1, z0 + 1.4, z1 - 1.4]) {
      const main = z === z0 || z === z1;
      ink.box(x, main ? 4.2 : 3.2, z, 0.5, main ? 8.4 : 6.4, 0.5, '#c94f45');
      ink.box(x, 0.3, z, 0.8, 0.6, 0.8, '#8d8398');
    }
    ink.box(x, 7.0, CANAL_Z, 0.6, 0.5, z1 - z0 + 1.2, '#c94f45');
    ink.box(x, 6.2, CANAL_Z, 0.4, 0.3, z1 - z0, '#3f7a5e');
    // Tiled roof over the top beam
    hipRoofInked(ink, x, 7.25, CANAL_Z, 2.0, z1 - z0 + 2.4, 1.1, '#3f7a5e');
    for (const z of [z0 - 0.9, z1 + 0.9]) ink.geometry(CONE8, matE(x, 7.8, z, 0.16, 0.6, 0.16, z < CANAL_Z ? -0.6 : 0.6), '#f4c95d');
    // Sign board, readable from both directions
    const uv = this.mats.atlas.cjkWide[0];
    ink.box(x, 5.4, CANAL_Z, 0.2, 1.1, 3.6, '#f4c95d');
    b.signs.quad(x + 0.12, 5.4, CANAL_Z, 3.3, 0.85, 'px', '#ffffff', uv);
    b.signs.quad(x - 0.12, 5.4, CANAL_Z, 3.3, 0.85, 'nx', '#ffffff', uv);
    // Lanterns under the beam
    for (const z of [CANAL_Z - 1.2, CANAL_Z + 1.2]) b.emissive.geometry(BLOB, mat(x, 6.3, z, 0.3, 0.38, 0.3), '#e8503a');
    // Stone guardian lions on plinths, greeting whoever comes up the street
    for (const z of [z0 + 0.9, z1 - 0.9]) this.lion(b, x - 1.3, z);
  }

  private lion(b: Builders, x: number, z: number) {
    const { ink } = b;
    const stone = '#d8cfc6';
    ink.box(x, 0.45, z, 0.9, 0.9, 0.8, '#8d8398');
    ink.fill.geometry(BLOB, mat(x + 0.05, 1.25, z, 0.38, 0.4, 0.3), stone); // body
    ink.geometry(BLOB, mat(x - 0.2, 1.75, z, 0.32, 0.34, 0.34), stone); // mane
    ink.fill.geometry(BLOB, mat(x - 0.42, 1.72, z, 0.16, 0.16, 0.2), stone); // muzzle
    for (const dz of [-0.13, 0.13]) {
      ink.fill.geometry(BLOB, mat(x - 0.5, 1.8, z + dz, 0.04, 0.04, 0.04), '#3b2a3a'); // eyes
      ink.fill.geometry(BLOB, mat(x - 0.3, 0.98, z + dz, 0.1, 0.1, 0.1), stone); // paws
    }
    ink.fill.geometry(BLOB, mat(x - 0.45, 1.05, z, 0.14, 0.14, 0.14), '#e6dbd0'); // ball under a paw
  }

  private canal(rng: Rng, b: Builders) {
    const { ink } = b;
    ink.surface = Surf.Stone;
    const wallT = 0.4;
    const nearWall = CANAL_Z1 - wallT / 2;
    const farWall = CANAL_Z0 + wallT / 2;
    // Stone walls and coping, continuous across chunks (no outline seams).
    for (const wz of [nearWall, farWall]) {
      ink.fill.box(CHUNK_W / 2, -0.55, wz, CHUNK_W + 0.02, 1.3, wallT, STONE);
      ink.fill.box(CHUNK_W / 2, 0.14, wz, CHUNK_W + 0.02, 0.12, wallT + 0.12, KERB);
      // Mossy waterline
      ink.fill.quad(CHUNK_W / 2, WATER_Y + 0.12, wz + (wz === nearWall ? -wallT / 2 - 0.01 : wallT / 2 + 0.01), CHUNK_W + 0.02, 0.24, wz === nearWall ? 'nz' : 'pz', '#9fb59a');
    }
    ink.surface = Surf.Plain;
    // The water surface itself is one reflective plane (water.ts).
    // End walls where the canal meets another district, with steps up.
    for (const [nx, ex] of [[this.index - 1, 0.2], [this.index + 1, CHUNK_W - 0.2]] as const) {
      if (areaAt(this.worldSeed, nx).district === 'canal') continue;
      ink.fill.box(ex, -0.55, CANAL_Z, 0.4, 1.3, CANAL_Z1 - CANAL_Z0, STONE);
      ink.fill.box(ex, 0.14, CANAL_Z, 0.52, 0.12, CANAL_Z1 - CANAL_Z0, KERB);
      const dir = ex < 1 ? 1 : -1;
      for (let k = 0; k < 4; k++) ink.box(ex + dir * (0.45 + k * 0.35), -0.1 - k * 0.16, CANAL_Z, 0.35, 0.16, 2.4, STONE, 0, false);
    }

    // Stone bridge carrying the avenue across.
    this.bridge(b, AVENUE_W / 2, 3.4, true);
    // Sometimes a little footbridge mid-chunk.
    const foot = rng.chance(0.4) ? rng.range(12, CHUNK_W - 6) : null;
    if (foot !== null) this.bridge(b, foot, 1.6, false);
    const underBridge = (x: number, half: number) => x - half < AVENUE_W / 2 + 1.7 + 0.4 || (foot !== null && Math.abs(x - foot) < half + 0.8 + 0.4);

    // Moored boats, clear of the bridges and of each other, then mooring posts between them.
    const moored: [number, number][] = [];
    const boats = rng.int(1, 3);
    for (let i = 0; i < boats; i++) {
      const bx = rng.range(7, CHUNK_W - 4);
      const near = rng.chance(0.5);
      if (underBridge(bx, 1.7) || moored.some(([mx, side]) => side === +near && Math.abs(mx - bx) < 3.6)) continue;
      moored.push([bx, +near]);
      buildBoat(ink, b.bulbs, bx, near ? CANAL_Z1 - 1.05 : CANAL_Z0 + 1.05, rng.pick(ACCENTS), rng.chance(0.4));
    }
    for (let x = 5; x < CHUNK_W - 1; x += rng.range(3, 6)) {
      const near = rng.chance(0.5);
      if (underBridge(x, 0.2) || moored.some(([mx, side]) => side === +near && Math.abs(mx - x) < 1.9)) continue;
      const side = near ? nearWall - 0.35 : farWall + 0.35;
      ink.geometry(CYL6, mat(x, WATER_Y + 0.55, side, 0.1, 1.2, 0.1), '#8a6a60');
      ink.fill.geometry(CYL6, mat(x, WATER_Y + 1.1, side, 0.12, 0.1, 0.12), '#f1e5df');
    }

    this.canalLanterns(rng, b);

    // String lights and bunting over the water.
    const lines = rng.int(0, 2);
    for (let i = 0; i < lines; i++) {
      const x = rng.range(6, CHUNK_W - 4);
      const a = new THREE.Vector3(x, rng.range(6.2, 7.2), CANAL_Z1 + 0.1);
      const c = new THREE.Vector3(x + rng.range(-3, 3), a.y + rng.range(-0.4, 0.4), CANAL_Z0 - 0.1);
      if (rng.chance(0.5)) this.sagLine(a, c, 0.8, b.wires, b.bulbs, 0.1);
      else this.bunting(rng, b, a, c, 0.9);
    }
  }

  /** Lanterns on the canal-side walls of row 1 with reflections on the water. */
  private canalLanterns(rng: Rng, b: Builders) {
    const { ink } = b;
    for (let x = 6; x < CHUNK_W - 2; x += rng.range(6, 10)) {
      const z = CANAL_Z0 + 0.05;
      ink.box(x, 2.6, z + 0.25, 0.08, 0.5, 0.5, '#4a3a48', 0, false);
      ink.box(x, 2.3, z + 0.45, 0.28, 0.4, 0.28, '#4a3a48');
      b.bulbs.geometry(BULB, mat(x, 2.28, z + 0.45, 0.13, 0.16, 0.13), '#ffffff');
      b.glow.quad(x, WATER_Y + 0.02, z + 1.6, 1.1, 3.4, 'py', '#ffffff');
    }
  }

  private bridge(b: Builders, cx: number, width: number, avenue: boolean) {
    const { ink } = b;
    const z0 = CANAL_Z1 + 0.6;
    const z1 = CANAL_Z0 - 0.6;
    const span = z0 - z1;
    const rise = avenue ? 0.9 : 1.2;
    const n = 9;
    const hAt = (t: number) => 0.12 + Math.sin(t * Math.PI) * rise;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const za = z0 - span * t0, zb = z0 - span * t1;
      const ya = hAt(t0), yb = hAt(t1);
      const len = Math.hypot(za - zb, ya - yb);
      const ang = Math.atan2(yb - ya, za - zb);
      const zm = (za + zb) / 2, ym = (ya + yb) / 2;
      ink.boxRot(P.set(cx, ym - 0.2, zm), eul.set(ang, 0, 0), S.set(width, 0.4, len + 0.04), STONE, false);
      ink.fill.geometry(BOX1, matE(cx, ym + 0.005, zm, width - 0.3, 0.02, len + 0.04, ang), avenue ? ASPHALT : '#e8d6cc');
      // Parapets
      for (const side of [-1, 1]) {
        ink.boxRot(P.set(cx + side * (width / 2 - 0.1), ym + 0.3, zm), eul.set(ang, 0, 0), S.set(0.2, 0.6, len + 0.04), KERB, i === 0 || i === n - 1);
      }
    }
    // Lamps on the bridge ends.
    for (const side of [-1, 1]) {
      const lx = cx + side * (width / 2 - 0.1);
      this.lampPost(b, lx, z0 + 0.1, 0.15, false);
    }
  }

  private streets(rng: Rng, b: Builders) {
    const { ink } = b;
    const roadX0 = WALK * 0.8;
    const roadX1 = AVENUE_W - WALK * 0.8;
    // Streets across the chunk (skip row 1: that's the canal).
    for (const row of [2, 3, 4]) {
      const zF = rowFront(row);
      const roadZ0 = zF + WALK, roadZ1 = zF + STREET - WALK;
      ink.surface = Surf.Asphalt;
      ink.fill.quad(CHUNK_W / 2, 0.01, (roadZ0 + roadZ1) / 2, CHUNK_W + 0.02, roadZ1 - roadZ0, 'py', ASPHALT);
      ink.surface = Surf.Plain;
      // Sidewalks with kerbs (gap where the avenue crosses)
      for (const [za, zb] of [[zF, roadZ0], [roadZ1, zF + STREET]]) {
        const zc = (za + zb) / 2;
        ink.surface = Surf.Paving;
        ink.fill.box(roadX0 / 2, 0.08, zc, roadX0, 0.16, zb - za, PAVEMENT);
        ink.surface = Surf.Plain;
        ink.surface = Surf.Paving;
        ink.fill.box((roadX1 + CHUNK_W) / 2, 0.08, zc, CHUNK_W - roadX1 + 0.02, 0.16, zb - za, PAVEMENT);
        ink.surface = Surf.Plain;
        const kz = za === zF ? zb - 0.06 : za + 0.06;
        ink.fill.box((roadX1 + CHUNK_W) / 2, 0.17, kz, CHUNK_W - roadX1 + 0.02, 0.04, 0.12, KERB);
      }
      const cz = zF + STREET / 2;
      if (row === 2 && !this.mirrored) {
        // Tram tracks set into the road, with overhead wires on bracket poles.
        for (const tz of [cz - 0.75, cz + 0.75]) {
          for (const r of [-0.36, 0.36]) ink.fill.box(CHUNK_W / 2, 0.025, tz + r, CHUNK_W + 0.02, 0.03, 0.09, '#8d8398');
          b.wires.push([new THREE.Vector3(0, 5.3, tz), new THREE.Vector3(CHUNK_W, 5.3, tz)]);
        }
        for (let x = 6; x < CHUNK_W; x += 12) {
          ink.box(x, 2.9, zF + STREET - 0.3, 0.14, 5.8, 0.14, '#6b5c78');
          ink.box(x, 5.55, cz + 0.3, 0.08, 0.08, 4.0, '#6b5c78', 0, false);
        }
        if (rng.chance(0.5)) this.shelter(rng, b, rng.range(8, CHUNK_W - 4), zF + STREET - 0.55, 'TRAM');
      } else {
        // Dashed centre line
        for (let x = AVENUE_W + 0.8; x < CHUNK_W - 0.5; x += 2.4) ink.fill.quad(x, 0.02, cz, 1.1, 0.12, 'py', '#f3e7c9');
        if (row === 3 && !this.mirrored && rng.chance(0.55)) this.shelter(rng, b, rng.range(8, CHUNK_W - 4), zF + STREET - 0.55, 'BUS');
      }
      // Zebra crossing next to the avenue (painted rainbow in the arts quarter)
      const rainbow = this.hood.name === 'arts';
      let stripe = 0;
      for (let z = roadZ0 + 0.25; z < roadZ1 - 0.1; z += 0.5) ink.fill.quad(AVENUE_W + 0.9, 0.02, z, 1.3, 0.26, 'py', rainbow ? ACCENTS[stripe++ % ACCENTS.length] : '#f6eee0');

      if (row === 4) continue; // barely visible; keep it light
      // Lamps and trees along the far kerb (in front of the row's facades)
      const lampX = rng.range(6, 10);
      for (let x = lampX; x < CHUNK_W - 1; x += 9) this.kerb(row, x, 0.3, (kx) => this.lampPost(b, kx, zF + 0.72, 0.16, true));
      for (let x = lampX + 4.5; x < CHUNK_W - 1; x += 9) {
        if (!rng.chance(0.6)) continue;
        const sc = rng.range(0.85, 1.05);
        const tr = new Rng(rng.int(0, 1e9));
        this.kerb(row, x, 0.8, (kx) => this.streetTree(tr, b, kx, 0.16, zF + 0.7, sc));
      }
      // Furniture on the near kerb
      for (let x = AVENUE_W + 2; x < CHUNK_W - 1; x += rng.range(3, 6)) this.furniture(rng, b, x, zF + STREET - 0.45);
      // Bunting or lights across the street
      if (rng.chance(0.55)) {
        const x = rng.range(8, CHUNK_W - 4);
        const a = new THREE.Vector3(x, rng.range(4.8, 6.2), zF + 0.1);
        const c = new THREE.Vector3(x + rng.range(-4, 4), a.y + rng.range(-0.5, 0.5), zF + STREET - 0.1);
        this.festoon(rng, b, a, c, 0.65, rng.chance(0.5));
      }
    }

    // The avenue: road, sidewalks, parked cars and lamps between the streets.
    const segments: [number, number][] = [];
    for (let row = 1; row < ROWS; row++) segments.push([rowFront(row) - BLOCK_DEPTH, rowFront(row)]);
    ink.surface = Surf.Asphalt;
    ink.fill.quad(AVENUE_W / 2, 0.012, (CANAL_Z0 - 110) / 2, roadX1 - roadX0, CANAL_Z0 + 110, 'py', ASPHALT);
    ink.surface = Surf.Plain;
    for (const [za, zb] of segments) {
      const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      const zc = (z0 + z1) / 2, len = z1 - z0;
      ink.surface = Surf.Paving;
      ink.fill.box(roadX0 / 2, 0.08, zc, roadX0, 0.16, len, PAVEMENT);
      ink.surface = Surf.Plain;
      ink.surface = Surf.Paving;
      ink.fill.box((roadX1 + AVENUE_W) / 2, 0.08, zc, AVENUE_W - roadX1, 0.16, len, PAVEMENT);
      ink.surface = Surf.Plain;
      if (len > 8 && rng.chance(0.7)) {
        const cz = rng.range(z0 + 2, z1 - 2);
        buildCar(ink, null, roadX0 + 0.62, 0.01, cz, Math.PI / 2, rng.pick(CAR_COLORS), rng.chance(0.25));
      }
    }
  }

  /** A glass bus / tram shelter with a bench, roof and lit sign. */
  private shelter(rng: Rng, b: Builders, x: number, z: number, label: 'BUS' | 'TRAM') {
    const { ink } = b;
    const y = 0.16;
    ink.box(x, y + 2.45, z - 0.15, 2.6, 0.12, 1.1, '#6b5c78');
    for (const px of [-1.2, 1.2]) ink.box(x + px, y + 1.2, z - 0.55, 0.08, 2.4, 0.08, '#6b5c78', 0, false);
    b.glass.box(x, y + 1.3, z - 0.6, 2.4, 1.9, 0.04, '#ffffff');
    ink.box(x, y + 0.45, z - 0.35, 2.0, 0.08, 0.4, WOOD);
    b.emissive.box(x + 1.05, y + 2.1, z + 0.25, 0.5, 0.5, 0.06, label === 'BUS' ? '#ffb38a' : '#ffe08a');
    ink.fill.box(x + 1.05, y + 1.2, z + 0.25, 0.06, 1.8, 0.06, '#6b5c78');
    void rng;
  }

  private lampPost(b: Builders, x: number, z: number, y = 0, overRoad: boolean) {
    const { ink } = b;
    const h = 3.3;
    ink.geometry(CYL6, mat(x, y + h / 2, z, 0.07, h, 0.07), '#4a3a48');
    const armZ = overRoad ? 0.55 : 0;
    if (overRoad) ink.box(x, y + h - 0.05, z + armZ / 2, 0.06, 0.06, armZ, '#4a3a48', 0, false);
    ink.box(x, y + h - 0.12, z + armZ, 0.34, 0.34, 0.34, '#4a3a48');
    ink.fill.geometry(CONE8, mat(x, y + h + 0.14, z + armZ, 0.3, 0.22, 0.3), '#4a3a48');
    b.bulbs.geometry(BULB, mat(x, y + h - 0.16, z + armZ, 0.16, 0.18, 0.16), '#ffffff');
    b.glow.quad(x, y + 0.2, z + armZ + 0.4, 4, 4, 'py', '#ffffff');
    const hood = this.hood.name;
    if (hood === 'garden' || hood === 'parkland' || hood === 'oldtown') {
      // Hanging flower basket on the post
      ink.fill.geometry(CYL8, mat(x, y + 2.3, z - 0.28, 0.24, 0.2, 0.24), '#8f5a4f');
      ink.fill.box(x, y + 2.52, z - 0.14, 0.04, 0.04, 0.3, '#4a3a48');
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ink.fill.geometry(BLOB, mat(x + Math.cos(a) * 0.2, y + 2.38 - (k % 2) * 0.12, z - 0.28 + Math.sin(a) * 0.2, 0.12, 0.12, 0.12), FLOWERS[(k + Math.round(x)) % FLOWERS.length]);
      }
    } else if (hood === 'chinatown') {
      b.emissive.geometry(BLOB, mat(x, y + 2.4, z - 0.25, 0.17, 0.22, 0.17), '#e8503a');
    }
  }

  private furniture(rng: Rng, b: Builders, x: number, z: number, y = 0.16) {
    const { ink } = b;
    const r = rng.next();
    if (r < 0.2) {
      // Bench
      ink.box(x, y + 0.42, z, 1.5, 0.1, 0.45, WOOD);
      ink.box(x, y + 0.72, z + 0.2, 1.5, 0.35, 0.08, WOOD);
      ink.box(x - 0.6, y + 0.2, z, 0.08, 0.4, 0.4, '#4a3a48', 0, false);
      ink.box(x + 0.6, y + 0.2, z, 0.08, 0.4, 0.4, '#4a3a48', 0, false);
    } else if (r < 0.32) {
      // Fire hydrant
      ink.geometry(CYL, mat(x, y + 0.3, z, 0.14, 0.6, 0.14), '#e9544f');
      ink.fill.geometry(BLOB, mat(x, y + 0.62, z, 0.15, 0.12, 0.15), '#e9544f');
    } else if (r < 0.44) {
      // Post box
      ink.box(x, y + 0.5, z, 0.45, 1.0, 0.4, '#6fa7e0');
      ink.fill.quad(x, y + 0.75, z - 0.21, 0.3, 0.05, 'nz', '#4a3a48');
    } else if (r < 0.6) {
      // Planter with flowers
      ink.box(x, y + 0.25, z, 1.2, 0.5, 0.5, '#b77a64');
      for (let i = 0; i < 5; i++) ink.fill.geometry(BLOB, mat(x - 0.45 + i * 0.22, y + 0.6, z + rng.range(-0.1, 0.1), 0.14, 0.12, 0.14), rng.pick(FLOWERS));
    } else if (r < 0.7) {
      // Bin
      ink.geometry(CYL, mat(x, y + 0.35, z, 0.22, 0.7, 0.22), '#8fb0a0');
    } else if (r < 0.8) {
      // Bicycle (two wheels and a frame)
      for (const wx of [-0.45, 0.45]) ink.fill.geometry(WHEEL, mat(x + wx, y + 0.3, z, 1, 1, 1), '#4a3a48');
      ink.fill.box(x, y + 0.45, z, 0.9, 0.05, 0.05, rng.pick(ACCENTS));
      ink.fill.box(x + 0.1, y + 0.55, z, 0.05, 0.3, 0.05, rng.pick(ACCENTS));
    } else if (rng.chance(0.3)) {
    }
  }

  /** Whatever this neighbourhood strings across its streets. */
  private festoon(rng: Rng, b: Builders, a: THREE.Vector3, c: THREE.Vector3, sag: number, alt: boolean) {
    switch (this.hood.festoon) {
      case 'lanterns':
        this.lanternLine(b, a, c, sag);
        break;
      case 'neon':
        if (alt) this.neonLine(rng, b, a, c, sag);
        else this.sagLine(a, c, sag, b.wires, b.bulbs, 0.1);
        break;
      case 'bunting':
        if (alt) this.bunting(rng, b, a, c, sag);
        else this.sagLine(a, c, sag, b.wires, b.bulbs, 0.1);
        break;
      default:
        if (alt) this.sagLine(a, c, sag, b.wires, b.bulbs, 0.1);
        else this.bunting(rng, b, a, c, sag);
    }
  }

  /** Red paper lanterns with gold caps. */
  private lanternLine(b: Builders, a: THREE.Vector3, c: THREE.Vector3, sag: number) {
    const n = 9;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(c, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      pts.push(p);
      if (i > 0 && i < n) {
        b.emissive.geometry(BLOB, mat(p.x, p.y - 0.42, p.z, 0.22, 0.28, 0.22), i % 3 === 0 ? '#f4c95d' : '#e8503a');
        b.ink.fill.geometry(CYL8, mat(p.x, p.y - 0.12, p.z, 0.1, 0.06, 0.1), '#c9a23a');
        b.ink.fill.geometry(CYL8, mat(p.x, p.y - 0.72, p.z, 0.1, 0.06, 0.1), '#c9a23a');
        b.ink.fill.box(p.x, p.y - 0.06, p.z, 0.02, 0.12, 0.02, '#3b2a3a');
      }
    }
    b.wires.push(pts);
  }

  /** Glowing neon tubes in candy colours strung on a wire. */
  private neonLine(rng: Rng, b: Builders, a: THREE.Vector3, c: THREE.Vector3, sag: number) {
    const n = 12;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(c, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      pts.push(p);
    }
    b.wires.push(pts);
    const col = rng.pick(['#ff8fb1', '#8fe3ff', '#b6a2ff', '#9dffc8', '#ffe08a']);
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const mid = p0.clone().lerp(p1, 0.5);
      const len = p0.distanceTo(p1);
      const dir = p1.clone().sub(p0).normalize();
      q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      b.emissive.geometry(BOX1, m4.compose(mid.setY(mid.y - 0.08), q, s.set(len * 0.9, 0.07, 0.07)), col);
    }
  }

  private bunting(rng: Rng, b: Builders, a: THREE.Vector3, c: THREE.Vector3, sag: number) {
    const pts: THREE.Vector3[] = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(c, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      pts.push(p);
    }
    b.wires.push(pts);
    const palette = rng.chance(0.5) ? ['#f28fb0', '#f8dea0', '#a9c9f0', '#bde2d0'] : ['#e9786f', '#fff1d6', '#6fa7e0'];
    const dir = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      dir.subVectors(p1, p0);
      const mid = p0.clone().lerp(p1, 0.5);
      const tip = mid.clone();
      tip.y -= 0.45;
      b.flags.tri(p0.clone(), p1.clone().lerp(p0, 0.1), tip, palette[i % palette.length], [0, 0, 1]);
    }
  }

  // =========================================================================
  // Lots: buildings, markets, parks

  private building(rng: Rng, b: Builders, row: number, cx: number, cz: number, w: number, d: number, facesStreet: boolean) {
    const { ink } = b;
    const hood = this.hood;
    const [hMin, hMax] = ROW_HEIGHTS[row];
    let floors = Math.max(1, Math.round((rng.range(hMin, hMax) * hood.height) / FLOOR));
    // Railway arches: keep buildings under the viaduct and its ramps low.
    const railCap = this.railLimit(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2);
    if (railCap !== null) floors = Math.min(floors, Math.max(1, Math.floor((railCap - 4.5) / FLOOR)));
    const h = floors * FLOOR + 0.6;
    const wall = rng.pick(hood.walls);
    const trim = rng.pick(hood.trims);
    const roof = rng.pick(hood.roofs);
    const accent = rng.pick(hood.accents);
    const front = cz + d / 2;
    const detailed = row <= 3;
    this.curRow = facesStreet ? row : -1;

    ink.surface = hood.surface === Surf.Plaster && rng.chance(0.2) ? Surf.Brick : hood.surface;
    ink.box(cx, h / 2, cz, w, h, d, wall);
    ink.surface = Surf.Plain;
    // Plinth band and cornice
    ink.fill.box(cx, 0.35, cz, w + 0.08, 0.7, d + 0.08, trim);
    ink.box(cx, h - 0.15, cz, w + 0.35, 0.35, d + 0.35, trim);
    // Storey string courses on taller buildings
    if (floors >= 3 && rng.chance(0.5)) for (let f = 1; f < floors; f++) ink.fill.box(cx, f * FLOOR + 0.05, cz, w + 0.06, 0.1, d + 0.06, trim);
    const pt = 0.28;
    const ph = 0.55;
    const roofStyle = hood.roofStyle !== 'flat' && rng.chance(0.7) ? hood.roofStyle : 'flat';
    ink.surface = Surf.Gravel;
    ink.fill.box(cx, h + 0.02, cz, w - 0.2, 0.06, d - 0.2, roof);
    ink.surface = Surf.Plain;
    if (roofStyle !== 'pagoda') {
      ink.box(cx, h + ph / 2, front - pt / 2, w, ph, pt, wall);
      ink.box(cx, h + ph / 2, cz - d / 2 + pt / 2, w, ph, pt, wall);
      ink.box(cx - w / 2 + pt / 2, h + ph / 2, cz, pt, ph, d - 2 * pt, wall);
      ink.box(cx + w / 2 - pt / 2, h + ph / 2, cz, pt, ph, d - 2 * pt, wall);
    }

    const shop = facesStreet && row >= 1 && row <= 3 && rng.chance(hood.shopChance);
    // Row 1 faces the corridor: market stalls stand where an awning would go.
    const stallsInFront = row === 1 && this.district === 'market';
    if (shop) this.shopfront(rng, b, cx, front, w, accent, row !== 1 || this.district === 'street', !stallsInFront);
    // Decide what hangs off the upper facade first, so nothing shares the same spot.
    const escape = floors >= 3 && rng.chance(0.25);
    const fw = Math.min(w * 0.55, 4);
    const fx = cx + rng.range(-w / 2 + fw / 2 + 0.3, w / 2 - fw / 2 - 0.3);
    const blade = detailed && floors >= 2 && facesStreet && rng.chance(hood.neonChance);
    let bladeX = cx + (rng.chance(0.5) ? -1 : 1) * (w / 2 - 0.35);
    if (blade && escape && Math.abs(bladeX - fx) < fw / 2 + 0.6) bladeX = 2 * cx - bladeX;
    const keepOut: [number, number][] = [];
    if (escape) keepOut.push([fx - fw / 2 - 0.3, fx + fw / 2 + 0.3]);
    if (blade) keepOut.push([bladeX - 0.9, bladeX + 0.9]);
    this.windows(rng, b, cx, cz, w, d, floors, trim, accent, shop, detailed, keepOut);
    if (facesStreet) for (const [a, c] of keepOut) this.blockFront(a, c);

    if (this.hood.ivy && rng.chance(0.55)) this.ivy(rng, b, cx, front, w, h);
    if (this.hood.murals && floors >= 2 && rng.chance(0.55)) this.mural(rng, b, cx, cz, w, d, h);
    if (this.hood.festoon === 'neon' && rng.chance(0.6)) {
      // Neon strip tracing the cornice
      const col = rng.pick(this.hood.accents);
      b.emissive.box(cx, h - 0.4, front + 0.05, w - 0.2, 0.08, 0.06, col);
      if (floors >= 3) b.emissive.box(cx, FLOOR * 2 + 0.1, front + 0.05, w - 0.2, 0.06, 0.06, rng.pick(this.hood.accents));
    }
    if (escape) this.fireEscape(b, fx, fw, front, floors);
    if (blade) this.neonBlade(rng, b, bladeX, front, floors);

    this.rooftop(rng, b, roofStyle, cx, cz, w, d, h, wall, trim);
  }

  private shopfront(rng: Rng, b: Builders, cx: number, front: number, w: number, accent: string, cafe: boolean, awning = true) {
    const { ink } = b;
    const z = front + 0.02;
    const china = this.hood.name === 'chinatown';
    const winW = Math.min(w * 0.55, 4.2);
    const doorX = cx + (rng.chance(0.5) ? 1 : -1) * (winW / 2 + 0.6);
    // Display window with warm light and a trim frame (layers well apart so they never z-fight)
    ink.fill.quad(cx, 1.3, z + 0.01, winW + 0.3, 1.7, 'pz', '#4a3a48');
    b.lit.quad(cx, 1.3, z + 0.06, winW, 1.45, 'pz', windowColor(rng.next(), 'lit', true));
    for (let mx = cx - winW / 2 + winW / 3; mx < cx + winW / 2 - 0.1; mx += winW / 3) ink.fill.quad(mx, 1.3, z + 0.1, 0.06, 1.45, 'pz', '#4a3a48');
    ink.fill.quad(doorX, 1.05, z + 0.01, 0.95, 2.1, 'pz', china ? '#b8463f' : '#4a3a48');
    b.dark.quad(doorX, 1.05, z + 0.06, 0.75, 1.95, 'pz', '#f7e6d0');
    const aw = Math.min(w - 0.4, winW + 1.8);
    if (awning) {
      // Striped awning, kept shallow so it stays over the sidewalk
      const stripes = Math.max(3, Math.round(aw / 0.45));
      const sw = aw / stripes;
      const tilt = 0.42;
      const reach = 0.85;
      const second = china ? '#f4c95d' : this.hood.name === 'neon' ? '#2f3550' : '#fff4e6';
      for (let i = 0; i < stripes; i++) {
        const sx = cx - aw / 2 + sw * (i + 0.5);
        ink.boxRot(P.set(sx, 2.6, z + reach / 2), eul.set(tilt, 0, 0), S.set(sw + 0.005, 0.07, reach + 0.05), i % 2 ? second : accent, false);
      }
      ink.outline.geometry(BOX1, matE(cx, 2.6, z + reach / 2, aw + 0.16, 0.2, reach + 0.2, tilt), 0x000000);
      // Scalloped valance
      for (let i = 0; i < stripes; i++) {
        const sx = cx - aw / 2 + sw * (i + 0.5);
        ink.fill.geometry(CYL8, matE(sx, 2.38, z + reach * 0.9, sw * 0.5, 0.04, 0.18, Math.PI / 2), i % 2 ? second : accent);
      }
      this.blockFront(cx - aw / 2 - 0.1, cx + aw / 2 + 0.1);
    }
    // Shop board above the awning (Chinatown: red and gold hanzi boards)
    if (china) {
      const bw = Math.min(w - 0.6, 3.4);
      ink.box(cx, 3.3, z + 0.05, bw + 0.2, bw / 4 + 0.2, 0.1, '#3b2a2a', 0, false);
      b.signs.quad(cx, 3.3, z + 0.14, bw, bw / 4, 'pz', '#ffffff', this.signUV(rng.pick(this.mats.atlas.cjkWide)));
      // A pair of red lanterns either side of the door
      for (const sx of [-0.62, 0.62]) {
        ink.fill.box(doorX + sx, 2.35, z + 0.2, 0.04, 0.04, 0.4, '#3b2a2a');
        b.emissive.geometry(BLOB, mat(doorX + sx, 2.05, z + 0.38, 0.2, 0.26, 0.2), '#e8503a');
        ink.fill.geometry(CYL8, mat(doorX + sx, 1.77, z + 0.38, 0.1, 0.05, 0.1), '#f4c95d');
      }
    } else {
      const board = rng.pick(this.mats.atlas.small);
      ink.box(cx, 3.2, z + 0.05, 1.7, 0.9, 0.1, '#4a3a48', 0, false);
      b.signs.quad(cx, 3.2, z + 0.14, 1.6, 0.8, 'pz', '#ffffff', this.signUV(board));
    }
    if (this.hood.name === 'neon' && rng.chance(0.5)) {
      // Glowing vending machines beside the shop
      const vx = cx + (doorX > cx ? -1 : 1) * (aw / 2 + 0.45);
      if (Math.abs(vx - cx) < w / 2 - 0.35) {
        ink.box(vx, 0.95, z + 0.33, 0.7, 1.9, 0.6, rng.pick(['#e9786f', '#6fa7e0', '#fff1d6']));
        b.emissive.quad(vx, 1.15, z + 0.64, 0.55, 1.1, 'pz', rng.pick(['#bfe8ff', '#ffd9ec', '#fff4c9']));
        this.blockFront(vx - 0.45, vx + 0.45);
      }
    }

    if (cafe && rng.chance(0.55)) {
      // Café table and chairs under the awning
      const tx = cx + rng.range(-winW / 2 + 0.4, winW / 2 - 0.4);
      const tz = front + 0.45;
      ink.geometry(CYL, mat(tx, 0.62, tz, 0.3, 0.05, 0.3), '#fff1d6');
      ink.fill.geometry(CYL6, mat(tx, 0.38, tz, 0.04, 0.45, 0.04), '#4a3a48');
      for (const sx of [-0.45, 0.45]) {
        ink.box(tx + sx, 0.46, tz, 0.3, 0.06, 0.3, WOOD, 0, false);
        ink.fill.box(tx + sx * 1.3, 0.7, tz, 0.04, 0.5, 0.3, WOOD);
      }
      if (rng.chance(0.5)) ink.fill.geometry(CYL8, mat(tx, 0.72, tz, 0.06, 0.14, 0.06), rng.pick(FLOWERS));
    }
  }

  private windows(
    rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number, floors: number,
    trim: string, accent: string, shop: boolean, detailed: boolean, keepOut: [number, number][] = [],
  ) {
    const { ink } = b;
    const litChance = rng.range(0.25, 0.6);
    const shutters = detailed && rng.chance(0.35);
    const balconies = detailed && floors >= 2 && rng.chance(0.3);
    const flowerBoxes = detailed && rng.chance(0.45);
    const china = this.hood.name === 'chinatown';
    const arched = rng.chance(china ? 0.5 : 0.25);
    const ww = 0.85;
    const wh = 1.25;
    const place = (facing: 'pz' | 'px' | 'nx', span: number) => {
      const cols = Math.max(1, Math.floor((span - 0.8) / 1.9));
      const gap = span / cols;
      for (let f = shop && facing === 'pz' ? 1 : 0; f < floors; f++) {
        const y = f * FLOOR + 1.55;
        for (let c = 0; c < cols; c++) {
          if (rng.chance(0.06)) continue;
          const o = -span / 2 + gap * (c + 0.5);
          const isLit = rng.chance(litChance);
          const glass = windowColor(rng.next(), isLit ? (rng.chance(0.08) ? 'tv' : 'lit') : 'dark');
          const target = b.lit;
          if (facing === 'pz') {
            const z = cz + d / 2;
            const x = cx + o;
            const clear = !keepOut.some(([a, c2]) => x + ww / 2 + 0.5 > a && x - ww / 2 - 0.5 < c2);
            ink.fill.quad(x, y, z + 0.02, ww + 0.3, wh + 0.3, 'pz', trim);
            target.quad(x, y + 0.02, z + 0.07, ww, wh, 'pz', glass);
            if (arched) ink.fill.geometry(CYL8, matE(x, y + wh / 2 + 0.1, z + 0.04, (ww + 0.3) / 2, 0.02, 0.35, Math.PI / 2), trim);
            // Curtains in lit rooms
            if (isLit && detailed && rng.chance(0.5)) {
              const cc = china ? '#e8503a' : rng.pick(['#f28fb0', '#a9c9f0', '#f8dea0', '#bde2d0']);
              ink.fill.quad(x - ww / 2 + 0.14, y + 0.02, z + 0.11, 0.22, wh, 'pz', cc);
              ink.fill.quad(x + ww / 2 - 0.14, y + 0.02, z + 0.11, 0.22, wh, 'pz', cc);
            }
            if (!detailed) continue;
            ink.fill.box(x, y - wh / 2 - 0.12, z + 0.12, ww + 0.4, 0.08, 0.24, trim);
            if (shutters && clear) {
              ink.fill.quad(x - ww / 2 - 0.3, y, z + 0.05, 0.36, wh + 0.1, 'pz', accent);
              ink.fill.quad(x + ww / 2 + 0.3, y, z + 0.05, 0.36, wh + 0.1, 'pz', accent);
            }
            if (!clear) continue;
            if (balconies && f >= 1 && c % 2 === 0) {
              this.balcony(rng, b, x, f * FLOOR + 0.2, z, ww + 0.9);
              this.blockFront(x - (ww + 0.9) / 2 - 0.1, x + (ww + 0.9) / 2 + 0.1);
            } else if (china && f >= 1 && rng.chance(0.25)) {
              // A small paper lantern hanging beside the window
              ink.fill.box(x + ww / 2 + 0.3, y + wh / 2 + 0.05, z + 0.2, 0.04, 0.04, 0.4, '#3b2a2a');
              b.emissive.geometry(BLOB, mat(x + ww / 2 + 0.3, y + wh / 2 - 0.3, z + 0.38, 0.15, 0.2, 0.15), '#e8503a');
            } else if (flowerBoxes && rng.chance(0.3)) {
              ink.box(x, y - wh / 2 - 0.3, z + 0.2, ww + 0.1, 0.26, 0.3, '#b77a64');
              for (let k = 0; k < 4; k++) ink.fill.geometry(BLOB, mat(x - 0.35 + k * 0.23, y - wh / 2 - 0.1, z + 0.22, 0.12, 0.12, 0.12), rng.pick(k % 2 ? FLOWERS : FOLIAGE));
            }
          } else {
            const sgn = facing === 'px' ? 1 : -1;
            const x = cx + (sgn * w) / 2;
            ink.fill.quad(x + sgn * 0.02, y, cz + o, ww + 0.3, wh + 0.3, facing, trim);
            target.quad(x + sgn * 0.07, y + 0.02, cz + o, ww, wh, facing, glass);
          }
        }
      }
    };
    place('pz', w);
    if (detailed) {
      place('px', d);
      place('nx', d);
    }
  }

  /** Ivy climbing the facade in soft green clumps. */
  private ivy(rng: Rng, b: Builders, cx: number, front: number, w: number, h: number) {
    const { ink } = b;
    const patches = rng.int(1, 3);
    ink.surface = Surf.Foliage;
    for (let p = 0; p < patches; p++) {
      const px = cx + rng.range(-w / 2 + 0.5, w / 2 - 0.5);
      const top = rng.range(h * 0.35, h * 0.95);
      for (let y = 0.3; y < top; y += 0.45) {
        const spread = 0.4 + (1 - y / top) * 0.6;
        for (let k = 0; k < 2; k++) {
          const r = rng.range(0.25, 0.45);
          ink.fill.geometry(BLOB, mat(px + rng.range(-spread, spread), y, front + 0.08, r, r, 0.14), rng.pick(['#6f9a6a', '#8bb87a', '#5f8a5c', '#9fc48a']));
        }
      }
    }
    ink.surface = Surf.Plain;
  }

  /** A big painted mural on a side wall (arts district). */
  private mural(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number, h: number) {
    const side = rng.chance(0.5) ? 'nx' : 'px';
    const size = Math.min(d - 1, h - 1.2, 7);
    const x = cx + (side === 'px' ? w / 2 + 0.07 : -w / 2 - 0.07);
    b.signs.quad(x, 0.7 + size / 2, cz + rng.range(-(d - size) / 2 + 0.3, (d - size) / 2 - 0.3), size, size, side, '#ffffff', this.signUV(rng.pick(this.mats.atlas.murals)));
  }

  private balcony(rng: Rng, b: Builders, x: number, y: number, z: number, bw: number) {
    const { ink } = b;
    const china = this.hood.name === 'chinatown';
    const rail = china ? '#c94f45' : '#4a3a48';
    ink.box(x, y, z + 0.4, bw, 0.12, 0.8, china ? '#e8c07a' : CONCRETE);
    ink.box(x, y + 0.55, z + 0.78, bw, 0.05, 0.05, rail, 0, false);
    if (china) {
      // Lattice panel instead of bars
      ink.fill.box(x, y + 0.3, z + 0.78, bw, 0.4, 0.03, '#b8463f');
      for (let k = 1; k < 6; k++) ink.fill.box(x - bw / 2 + (bw * k) / 6, y + 0.3, z + 0.8, 0.04, 0.4, 0.02, '#f4c95d');
      ink.fill.box(x, y + 0.3, z + 0.8, bw, 0.04, 0.02, '#f4c95d');
    } else for (let k = 0; k <= 6; k++) ink.fill.box(x - bw / 2 + (bw * k) / 6, y + 0.3, z + 0.78, 0.035, 0.5, 0.035, rail);
    if (rng.chance(0.6)) {
      const px = x + rng.range(-bw / 3, bw / 3);
      ink.geometry(CYL, mat(px, y + 0.2, z + 0.4, 0.14, 0.28, 0.14), '#d98a6a');
      ink.fill.geometry(BLOB, mat(px, y + 0.5, z + 0.4, 0.26, 0.3, 0.26), rng.pick(['#8bc36a', '#9fd49a', ...FOLIAGE]));
    }
  }

  /** A vertical sign projecting out from the facade, readable along the street. */
  private neonBlade(rng: Rng, b: Builders, x: number, front: number, floors: number) {
    const china = this.hood.name === 'chinatown';
    const uv: UVRect = rng.pick(china ? this.mats.atlas.cjkTall : this.mats.atlas.tall);
    const h = Math.min(china ? 3.6 : 3.2, (floors - 1) * FLOOR);
    const y = FLOOR + 0.5 + h / 2;
    const depth = h / 4 + 0.1; // atlas signs are 1:4
    const zc = front + 0.2 + depth / 2;
    // Wall brackets, the box, then the sign on both faces
    for (const by of [y - h / 2 + 0.2, y + h / 2 - 0.2]) b.ink.fill.box(x, by, front + 0.1, 0.06, 0.06, 0.25, '#3b2a45');
    b.ink.box(x, y, zc, 0.12, h + 0.2, depth + 0.1, china ? '#b8463f' : '#3b2a45');
    const target = china ? b.signs : b.neon;
    target.quad(x + 0.09, y, zc, depth - 0.05, h, 'px', '#ffffff', this.signUV(uv));
    target.quad(x - 0.09, y, zc, depth - 0.05, h, 'nx', '#ffffff', this.signUV(uv));
  }

  private fireEscape(b: Builders, fx: number, fw: number, front: number, floors: number) {
    const { ink } = b;
    for (let f = 1; f < floors; f++) {
      const y = f * FLOOR + 0.2;
      ink.box(fx, y, front + 0.5, fw, 0.1, 1, RUST);
      ink.box(fx, y + 0.5, front + 1, fw, 0.06, 0.06, RUST, 0, false);
      for (let rx = -fw / 2; rx <= fw / 2 + 0.01; rx += fw / 4) {
        ink.box(fx + rx, y + 0.25, front + 1, 0.05, 0.5, 0.05, RUST, 0, false);
      }
      if (f < floors - 1) {
        ink.box(fx + fw * 0.15, y + FLOOR / 2, front + 0.55, 0.12, FLOOR * 1.08, 0.4, RUST, 0, false);
      }
    }
  }

  private rooftop(rng: Rng, b: Builders, style: 'flat' | 'pagoda' | 'sawtooth', cx: number, cz: number, w: number, d: number, h: number, wall: string, trim: string) {
    const { ink } = b;
    const roofY = h + 0.05;
    if (style === 'pagoda') {
      this.pagodaRoof(rng, b, cx, cz, w, d, h);
      return;
    }
    if (style === 'sawtooth') {
      this.sawtoothRoof(rng, b, cx, cz, w, d, roofY);
      return;
    }
    const front = cz + d / 2;
    const usable = { x0: cx - w / 2 + 0.55, x1: cx + w / 2 - 0.55, z0: cz - d / 2 + 0.55, z1: front - 0.55 };
    const occ = new Occupancy(usable);
    const floors = Math.round((h - 0.6) / FLOOR);

    if (rng.chance(0.14) && w > 4.5) {
      const bw = Math.min(w - 1, 5.5);
      if (occ.reserve(cx, usable.z0 + 1.2, bw + 0.4, 0.9)) this.billboard(rng, b, cx, roofY, usable.z0 + 1.2, w);
    }
    if (floors >= 3 && rng.chance(0.3)) {
      const p = occ.place(rng, 2.3, 2.3, true);
      if (p) this.waterTower(b, p.x, roofY, p.z);
    }
    const garden = rng.chance(0.3);
    if (garden) {
      for (let i = 0; i < rng.int(1, 2); i++) {
        const p = occ.place(rng, 1.7, 1.7);
        if (!p) continue;
        ink.box(p.x, roofY + 0.3, p.z, 1.4, 0.6, 1.4, '#b77a64');
        this.tree(rng, b, p.x, roofY + 0.6, p.z, rng.range(0.5, 0.7));
      }
      if (w > 4) {
        const y0 = roofY + 2.8;
        const pA = new THREE.Vector3(usable.x0 + 0.1, y0, usable.z0 + 0.3);
        const pB = new THREE.Vector3(usable.x1 - 0.1, y0, usable.z1 - 0.3);
        if (occ.reserve(pA.x, pA.z, 0.3, 0.3) && occ.reserve(pB.x, pB.z, 0.3, 0.3)) {
          ink.box(pA.x, roofY + 1.4, pA.z, 0.12, 2.8, 0.12, WOOD);
          ink.box(pB.x, roofY + 1.4, pB.z, 0.12, 2.8, 0.12, WOOD);
          this.sagLine(pA, pB, 0.6, b.wires, b.bulbs, 0.09);
        }
      }
    } else if (w > 5.5 && d > 5 && rng.chance(0.12)) {
      const gw = Math.min(3, w - 2), gd = 2, gh = 1.6;
      const p = occ.place(rng, gw + 0.3, gd + 0.3);
      if (p) {
        const { x: gx, z: gz } = p;
        b.glass.box(gx, roofY + gh / 2, gz, gw, gh, gd, '#ffffff');
        for (const fx of [-gw / 2, 0, gw / 2]) ink.fill.box(gx + fx, roofY + gh / 2, gz + gd / 2, 0.06, gh, 0.06, '#f1e5df');
        ink.fill.box(gx, roofY + gh, gz, gw + 0.1, 0.08, gd + 0.1, '#f1e5df');
        for (let k = 0; k < 4; k++) ink.fill.geometry(BLOB, mat(gx - gw / 2 + 0.4 + (k * (gw - 0.8)) / 3, roofY + 0.35, gz, 0.3, 0.35, 0.3), '#8bc36a');
      }
    }
    if (rng.chance(0.4)) {
      const p = occ.place(rng, 2.4, 2.6, true);
      if (p) {
        ink.box(p.x, roofY + 1.15, p.z, 2, 2.3, 2.2, wall);
        ink.box(p.x, roofY + 2.35, p.z, 2.3, 0.15, 2.5, trim);
        b.dark.quad(p.x, roofY + 0.85, p.z + 1.11, 0.9, 1.7, 'pz', '#6a5a7a');
      }
    }
    if (w > 4.5 && rng.chance(0.15)) {
      const n = Math.min(4, Math.floor((usable.x1 - usable.x0) / 1.4));
      const p = occ.place(rng, n * 1.4, 1.3, true);
      if (p) {
        for (let i = 0; i < n; i++) {
          const px = p.x - (n * 1.4) / 2 + 0.7 + i * 1.4;
          ink.boxRot(P.set(px, roofY + 0.45, p.z), eul.set(-0.5, 0, 0), S.set(1.25, 0.06, 1.0), '#5b6fb0');
          ink.fill.box(px, roofY + 0.2, p.z - 0.2, 0.06, 0.4, 0.06, METAL);
        }
      }
    }
    if (!garden && rng.chance(0.15)) {
      const p = occ.place(rng, 2.8, 2.8);
      if (p) {
        ink.fill.geometry(CYL6, mat(p.x, roofY + 1.0, p.z, 0.04, 2.0, 0.04), '#4a3a48');
        ink.geometry(CONE8, mat(p.x, roofY + 2.05, p.z, 1.2, 0.45, 1.2), rng.pick(ACCENTS));
        ink.geometry(CYL, mat(p.x, roofY + 0.6, p.z, 0.4, 0.05, 0.4), '#fff1d6');
        for (const cxo of [-0.75, 0.75]) ink.box(p.x + cxo, roofY + 0.35, p.z, 0.4, 0.06, 0.4, WOOD, 0, false);
      }
    }
    if (!garden && rng.chance(0.16) && w > 4 && occ.reserve(cx, cz, w - 1.1, 0.7)) this.laundry(rng, b, usable, roofY, cz);
    for (let i = 0; i < (rng.chance(0.5) ? rng.int(1, 3) : 0); i++) {
      const p = occ.place(rng, 1.3, 1.1);
      if (!p) break;
      ink.box(p.x, roofY + 0.4, p.z, 1.1, 0.8, 0.9, METAL);
      ink.fill.geometry(CYL, mat(p.x, roofY + 0.81, p.z, 0.35, 0.02, 0.35), '#6d6883');
    }
    if (rng.chance(0.15)) {
      const p = occ.place(rng, 1.1, 1.1);
      if (p) {
        ink.fill.box(p.x, roofY + 0.4, p.z, 0.08, 0.8, 0.08, METAL);
        ink.geometry(CONE, matE(p.x, roofY + 0.95, p.z + 0.1, 0.5, 0.18, 0.5, 2.3), '#eeeaf5');
      }
    }
    if (rng.chance(0.25)) {
      for (let i = 0; i < rng.int(1, 3); i++) {
        const p = occ.place(rng, 1.3, 1.0);
        if (!p) break;
        ink.box(p.x, roofY + 0.12, p.z, 1.1, 0.2, 0.8, trim);
        b.dark.quad(p.x, roofY + 0.23, p.z, 0.9, 0.6, 'py', '#bcd8ff');
      }
    }
    if (rng.chance(0.4)) {
      const p = occ.place(rng, 0.9, 0.9);
      if (p) {
        ink.surface = Surf.Brick;
        ink.box(p.x, roofY + 0.9, p.z, 0.6, 1.8, 0.6, '#c9826e');
        ink.surface = Surf.Plain;
        ink.box(p.x, roofY + 1.85, p.z, 0.75, 0.15, 0.75, '#e1a08a');
        if (rng.chance(0.6)) this.chimneys.push(new THREE.Vector3(p.x + this.x0, roofY + 2.0, this.wz(p.z)));
      }
    }
    if (rng.chance(0.18)) {
      const p = occ.place(rng, 1.6, 0.5, true);
      if (p) {
        ink.box(p.x, roofY + 2.2, p.z, 0.1, 4.4, 0.1, METAL);
        ink.box(p.x, roofY + 3.6, p.z, 1.4, 0.08, 0.08, METAL);
        ink.box(p.x, roofY + 4.1, p.z, 0.9, 0.08, 0.08, METAL);
      }
    }
  }

  /** Glazed tile hip roof with flared, upturned eaves (Chinatown). */
  private pagodaRoof(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number, h: number) {
    const { ink } = b;
    const tile = rng.pick(this.hood.roofs);
    const tiers = w > 5 && rng.chance(0.4) ? 2 : 1;
    let tw = w + 0.9, td = d + 0.9, ty = h + 0.05;
    for (let t = 0; t < tiers; t++) {
      ink.box(cx, ty + 0.1, cz, tw, 0.2, td, '#b8463f');
      // Square pyramid over the footprint; its ink hull is a slightly larger copy.
      const rise = Math.min(2.2, 0.35 * Math.min(tw, td) + 0.6);
      hipRoofInked(ink, cx, ty + 0.2, cz, tw, td, rise, tile);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        ink.geometry(CONE8, matE(cx + (sx * tw) / 2, ty + 0.35, cz + (sz * td) / 2, 0.12, 0.45, 0.12, sz * 0.5, 0, -sx * 0.5), '#f4c95d');
      }
      // Gold ridge along the longer side
      const ridge = Math.abs(tw - td) + 0.3;
      if (tw >= td) ink.box(cx, ty + 0.2 + rise, cz, ridge, 0.16, 0.16, '#f4c95d');
      else ink.box(cx, ty + 0.2 + rise, cz, 0.16, 0.16, ridge, '#f4c95d');
      if (t === 0 && tiers === 2) {
        ink.box(cx, ty + 1.1, cz, tw * 0.5, 1.8, td * 0.5, '#d9594c');
        tw *= 0.6;
        td *= 0.6;
        ty += 2.0;
      }
    }
  }

  /** North-light sawtooth roof for warehouses (harbour). */
  private sawtoothRoof(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number, y: number) {
    const { ink } = b;
    const teeth = Math.max(2, Math.floor(d / 2.6));
    const td = d / teeth;
    const col = rng.pick(this.hood.roofs);
    for (let i = 0; i < teeth; i++) {
      const zc = cz - d / 2 + td * (i + 0.5);
      ink.boxRot(P.set(cx, y + 0.7, zc + td * 0.1), eul.set(-0.62, 0, 0), S.set(w, 0.12, td * 1.15), col);
      b.dark.quad(cx, y + 0.7, zc - td * 0.42, w - 0.3, 1.2, 'nz', '#bcd8ff');
    }
    if (rng.chance(0.5)) {
      // Chimney stack with smoke
      const chx = cx + rng.range(-w / 3, w / 3);
      ink.surface = Surf.Brick;
      ink.geometry(CYL, mat(chx, y + 3, cz - d / 3, 0.45, 6, 0.45), '#a45a48');
      ink.surface = Surf.Plain;
      this.chimneys.push(new THREE.Vector3(chx + this.x0, y + 6.1, this.wz(cz - d / 3)));
    }
  }

  private laundry(rng: Rng, b: Builders, usable: { x0: number; x1: number }, roofY: number, cz: number) {
    const { ink } = b;
    const y0 = roofY + 1.9;
    const pA = new THREE.Vector3(usable.x0 + 0.2, y0, cz);
    const pB = new THREE.Vector3(usable.x1 - 0.2, y0, cz);
    ink.box(pA.x, roofY + 0.95, pA.z, 0.1, 1.9, 0.1, WOOD);
    ink.box(pB.x, roofY + 0.95, pB.z, 0.1, 1.9, 0.1, WOOD);
    this.sagLine(pA, pB, 0.35, b.wires);
    const cloths = ['#ffffff', '#f2a7c3', '#8fb8ea', '#f5d489', '#a9d7c2'];
    for (let lx = pA.x + 0.6; lx < pB.x - 0.6; lx += rng.range(0.7, 1.2)) {
      const t = (lx - pA.x) / (pB.x - pA.x);
      const sag = Math.sin(t * Math.PI) * 0.35;
      const cw = rng.range(0.4, 0.7);
      const ch = rng.range(0.5, 0.9);
      const top = new THREE.Vector3(lx, y0 - sag, cz);
      // Cloth as two flag triangles so it sways in the wind.
      const col = rng.pick(cloths);
      b.flags.tri(top.clone().setX(lx - cw / 2), top.clone().setX(lx + cw / 2), top.clone().setX(lx + cw / 2).setY(top.y - ch), col, [0, 0, 1]);
      b.flags.tri(top.clone().setX(lx - cw / 2), top.clone().setX(lx + cw / 2).setY(top.y - ch), top.clone().setX(lx - cw / 2).setY(top.y - ch), col, [0, 1, 1]);
    }
  }

  private waterTower(b: Builders, x: number, y: number, z: number) {
    const { ink } = b;
    const legH = 1.6;
    for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      ink.box(x + lx, y + legH / 2, z + lz, 0.14, legH, 0.14, TRUNK);
    }
    ink.box(x, y + legH, z, 1.9, 0.12, 1.9, TRUNK);
    ink.geometry(CYL, mat(x, y + legH + 1.2, z, 1.05, 2.3, 1.05), WOOD);
    ink.geometry(CONE, mat(x, y + legH + 2.75, z, 1.2, 0.8, 1.2), '#9c6f5a');
    for (const hy of [0.5, 1.4]) ink.fill.geometry(CYL, mat(x, y + legH + hy, z, 1.08, 0.06, 1.08), '#7a5850');
  }

  private billboard(rng: Rng, b: Builders, cx: number, y: number, z: number, w: number) {
    const { ink } = b;
    const uv = rng.pick(this.mats.atlas.wide);
    const bw = Math.min(w - 1, 5.5);
    const bh = bw / 4;
    const lift = 1.1;
    ink.box(cx - bw * 0.35, y + lift / 2, z, 0.14, lift, 0.14, METAL);
    ink.box(cx + bw * 0.35, y + lift / 2, z, 0.14, lift, 0.14, METAL);
    ink.box(cx, y + lift + bh / 2, z - 0.1, bw + 0.2, bh + 0.2, 0.15, '#6b5c78');
    b.signs.quad(cx, y + lift + bh / 2, z + 0.0, bw, bh, 'pz', '#ffffff', this.signUV(uv));
    // Spotlights that light the board at night
    for (const sx of [-0.3, 0.3]) b.bulbs.geometry(BULB, mat(cx + sx * bw, y + lift - 0.1, z + 0.35, 0.1, 0.1, 0.1), '#ffffff');
  }

  /** Foliage colours for this neighbourhood: cherry blossom in the parks, maples in the garden quarter. */
  private leaves(rng: Rng): readonly string[] {
    const h = this.hood.name;
    if (h === 'parkland' && rng.chance(0.55)) return BLOSSOM;
    if (h === 'garden' && rng.chance(0.3)) return MAPLE;
    if (h === 'chinatown' && rng.chance(0.3)) return BLOSSOM;
    return FOLIAGE;
  }

  /** A slim, clipped street tree that fits a narrow sidewalk (canopy stays within ~0.6 of the trunk). */
  private streetTree(rng: Rng, b: Builders, x: number, y: number, z: number, scale: number) {
    const { ink } = b;
    const trunkH = 2.4 * scale;
    ink.surface = Surf.Bark;
    ink.geometry(CYL, mat(x, y + trunkH / 2, z, 0.1 * scale, trunkH, 0.1 * scale), TRUNK);
    ink.surface = Surf.Plain;
    // Tree pit grate
    ink.fill.quad(x, y + 0.01, z, 0.9, 0.9, 'py', '#8d8398');
    ink.surface = Surf.Foliage;
    const pal = this.leaves(rng);
    const blobs = rng.int(2, 3);
    for (let i = 0; i < blobs; i++) {
      const r = (0.62 - i * 0.12) * scale;
      ink.geometry(BLOB, mat(x + rng.range(-0.15, 0.15), y + trunkH + (0.1 + i * 0.6) * scale, z + rng.range(-0.08, 0.08), r * 1.15, r, r * 0.95), rng.pick(pal));
    }
    ink.surface = Surf.Plain;
  }

  private tree(rng: Rng, b: Builders, x: number, y: number, z: number, scale: number) {
    const { ink } = b;
    const trunkH = 2.2 * scale;
    ink.surface = Surf.Bark;
    ink.geometry(CYL, mat(x, y + trunkH / 2, z, 0.18 * scale, trunkH, 0.18 * scale), TRUNK);
    ink.surface = Surf.Foliage;
    const FOLIAGE = this.leaves(rng);
    const color = rng.pick(FOLIAGE);
    const blobs = rng.int(3, 5);
    for (let i = 0; i < blobs; i++) {
      const r = rng.range(0.8, 1.25) * scale;
      const a = (i / blobs) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const off = i === 0 ? 0 : 0.8 * scale;
      ink.geometry(
        BLOB,
        mat(x + Math.cos(a) * off, y + trunkH + 0.4 * scale + rng.range(-0.3, 0.5) * scale, z + Math.sin(a) * off * 0.7, r, r * 0.85, r),
        i === 0 ? color : rng.pick(FOLIAGE),
      );
    }
    ink.surface = Surf.Plain;
  }

  private park(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number) {
    const { ink } = b;
    ink.surface = Surf.Grass;
    ink.fill.box(cx, 0.15, cz, w - 0.4, 0.3, d - 0.4, '#b9d8a8');
    ink.surface = Surf.Plain;
    const hood = this.hood.name;
    const occ = new Occupancy({ x0: cx - w / 2 + 0.4, x1: cx + w / 2 - 0.4, z0: cz - d / 2 + 0.4, z1: cz + d / 2 - 0.5 });
    // Gravel paths in a cross (kept clear of props)
    ink.fill.quad(cx, 0.31, cz, 1.0, d - 0.6, 'py', '#eadccb');
    ink.fill.quad(cx, 0.311, cz, w - 0.6, 1.0, 'py', '#eadccb');
    ink.box(cx, 0.35, cz + d / 2 - 0.3, w - 0.2, 0.3, 0.3, CONCRETE);
    // The centre of the cross: fountain, sculpture, or bandstand
    const centre = rng.next();
    if (w > 4.5 && d > 4.5 && centre < 0.55 && occ.reserve(cx, cz, 3.0, 3.0)) {
      ink.geometry(CYL, mat(cx, 0.55, cz, 1.4, 0.5, 1.4), STONE);
      b.water.geometry(CYL, mat(cx, 0.78, cz, 1.25, 0.02, 1.25), '#ffffff');
      ink.geometry(CYL, mat(cx, 1.1, cz, 0.18, 1.1, 0.18), STONE);
      ink.geometry(CYL, mat(cx, 1.65, cz, 0.6, 0.12, 0.6), STONE);
      this.fountains.push(new THREE.Vector3(cx + this.x0, 1.75, this.wz(cz)));
    } else if (hood === 'arts' && w > 4 && occ.reserve(cx, cz, 2.2, 2.2)) {
      this.sculpture(rng, b, cx, 0.3, cz);
    } else if ((hood === 'parkland' || hood === 'oldtown') && w > 6 && d > 6 && occ.reserve(cx, cz, 4.2, 4.2)) {
      this.bandstand(rng, b, cx, cz);
    }
    // Paths are reserved after the centrepiece so trees stay off them
    occ.reserve(cx, cz, 1.2, d);
    occ.reserve(cx, cz, w, 1.2);
    const green = hood === 'parkland' || hood === 'garden';
    if (green && w > 5 && d > 5 && rng.chance(0.5)) {
      // Lily pond with a little gazebo, each in its own quadrant
      const pond = occ.place(rng, 3.9, 3.0, true);
      if (pond) {
        ink.surface = Surf.Stone;
        ink.geometry(CYL, mat(pond.x, 0.32, pond.z, 1.9, 0.16, 1.4), STONE);
        ink.surface = Surf.Plain;
        b.water.geometry(CYL, mat(pond.x, 0.41, pond.z, 1.75, 0.02, 1.28), '#ffffff');
        for (let k = 0; k < 5; k++) ink.fill.geometry(CYL8, mat(pond.x + rng.range(-1.2, 1.2), 0.43, pond.z + rng.range(-0.8, 0.8), 0.2, 0.01, 0.2), '#8bc36a');
      }
      const gz = occ.place(rng, 3.3, 3.3);
      if (gz) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ink.box(gz.x + Math.cos(a) * 1.1, 1.3, gz.z + Math.sin(a) * 1.1, 0.1, 2.0, 0.1, '#fff1d6', 0, false);
        }
        ink.geometry(CYL8, mat(gz.x, 0.4, gz.z, 1.3, 0.2, 1.3), '#e8dcc4');
        ink.surface = Surf.Tiles;
        ink.geometry(CONE8, mat(gz.x, 2.8, gz.z, 1.6, 1.1, 1.6), rng.pick(['#57907a', '#b98a6a', '#8a7fd0']));
        ink.surface = Surf.Plain;
      }
    }
    // Flower beds in the garden quarter
    if (hood === 'garden' || hood === 'parkland') {
      for (let k = 0; k < 3; k++) {
        const bed = occ.place(rng, 1.6, 0.9);
        if (!bed) break;
        ink.box(bed.x, 0.42, bed.z, 1.6, 0.25, 0.9, '#b77a64');
        for (let f = 0; f < 6; f++) ink.fill.geometry(BLOB, mat(bed.x - 0.6 + (f % 3) * 0.6, 0.62, bed.z + (f < 3 ? -0.2 : 0.2), 0.2, 0.16, 0.2), rng.pick(FLOWERS));
      }
    }
    // Trees: canopies need ~2.4 units of room
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      const sc = rng.range(1.0, 1.35);
      const spot = occ.place(rng, 2.2 * sc, 2.0 * sc);
      if (spot) this.tree(rng, b, spot.x, 0.3, spot.z, sc);
    }
    // Bench facing the path, with a lamp
    const bench = occ.reserve(cx + 1.4, cz + d / 2 - 1.3, 1.8, 0.8);
    if (bench) {
      ink.box(cx + 1.4, 0.75, cz + d / 2 - 1.2, 1.6, 0.12, 0.6, WOOD);
      ink.box(cx + 1.4, 1.1, cz + d / 2 - 1.5, 1.6, 0.5, 0.1, WOOD);
    }
    if (occ.reserve(cx - 0.9, cz + d / 2 - 1.2, 0.4, 0.4) || bench) this.lampPost(b, cx - 0.9, cz + d / 2 - 1.2, 0.3, false);
  }

  /** One landmark per neighbourhood run, standing tall behind the first row so it reads from the corridor. */
  private landmark(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number) {
    const { ink } = b;
    // Paved forecourt
    ink.surface = Surf.Paving;
    ink.fill.box(cx, 0.06, cz, w - 0.2, 0.12, d - 0.2, '#ead9c8');
    ink.surface = Surf.Plain;
    const tz = cz - 1; // stand a little back from the street
    switch (this.hood.name) {
      case 'oldtown': return this.clockTower(rng, b, cx, tz, Math.min(w - 1.5, 4.6));
      case 'chinatown': return this.pagodaTower(rng, b, cx, tz, Math.min(w - 1.2, 6));
      case 'harbour': return this.lighthouse(b, cx, tz);
      case 'neon': return this.screenTower(rng, b, cx, tz, Math.min(w - 1.5, 5));
      case 'arts': {
        this.sculpture(rng, b, cx - 1.2, 0.12, tz + 2);
        // A giant ring sculpture you can see from far away
        ink.box(cx + 1, 0.6, tz - 2, 2.4, 1.2, 1.2, '#fff1d6');
        q.setFromEuler(eul.set(0, Math.PI / 2, 0));
        ink.geometry(TORUS, m4.compose(v.set(cx + 1, 5.6, tz - 2), q, s.set(4.2, 4.2, 5)), rng.pick(['#f28fb0', '#f6c453', '#7fb3e8']));
        return;
      }
      case 'garden': return this.glasshouse(rng, b, cx, tz, Math.min(w - 1, 8), Math.min(d - 3, 11));
      case 'parkland': return this.ferrisWheel(rng, b, cx, tz);
    }
  }

  private clockTower(rng: Rng, b: Builders, x: number, z: number, tw: number) {
    const { ink } = b;
    const H = 24;
    ink.surface = Surf.Brick;
    ink.box(x, H / 2, z, tw, H, tw, '#c9785c');
    ink.surface = Surf.Plain;
    ink.fill.box(x, 0.4, z, tw + 0.3, 0.8, tw + 0.3, STONE);
    for (let y = 5; y < H - 4; y += 5) ink.fill.box(x, y, z, tw + 0.12, 0.25, tw + 0.12, '#f1e5df');
    // Tall slit windows
    for (let y = 3; y < H - 6; y += 5) b.lit.quad(x, y + 1.2, z + tw / 2 + 0.07, 0.6, 1.8, 'pz', windowColor(rng.next(), rng.chance(0.4) ? 'lit' : 'dark'));
    // Clock stage
    ink.box(x, H + 1.6, z, tw + 0.5, 3.2, tw + 0.5, '#f1e5df');
    const faces: ['pz' | 'px' | 'nx', number, number][] = [['pz', x, z + tw / 2 + 0.26], ['px', x + tw / 2 + 0.26, z], ['nx', x - tw / 2 - 0.26, z]];
    for (const [f, fx, fz] of faces) {
      const rot = f === 'pz' ? Math.PI / 2 : 0;
      const face = f === 'pz' ? matE(fx, H + 1.6, fz + 0.02, 1.1, 0.06, 1.1, rot) : matE(fx + (f === 'px' ? 0.02 : -0.02), H + 1.6, fz, 1.1, 0.06, 1.1, 0, 0, Math.PI / 2);
      ink.geometry(CYL, face, '#3b2a3a');
      b.emissive.geometry(CYL, f === 'pz' ? matE(fx, H + 1.6, fz + 0.06, 0.95, 0.04, 0.95, rot) : matE(fx + (f === 'px' ? 0.06 : -0.06), H + 1.6, fz, 0.95, 0.04, 0.95, 0, 0, Math.PI / 2), '#fff4c9');
      // Hands at ten past ten
      const n = f === 'pz' ? 0.1 : f === 'px' ? 0.1 : -0.1;
      if (f === 'pz') {
        ink.fill.geometry(BOX1, matE(x - 0.15, H + 1.7, fz + n, 0.07, 0.5, 0.04, 0, 0, 0.9), '#3b2a3a');
        ink.fill.geometry(BOX1, matE(x + 0.15, H + 1.9, fz + n, 0.05, 0.75, 0.04, 0, 0, -0.5), '#3b2a3a');
      } else {
        ink.fill.box(fx + n, H + 1.8, z, 0.04, 0.6, 0.06, '#3b2a3a');
      }
    }
    // Spire
    ink.surface = Surf.Tiles;
    ink.geometry(CONE8, mat(x, H + 5.2, z, tw * 0.62, 4, tw * 0.62), '#5b6fb0');
    ink.surface = Surf.Plain;
    ink.fill.box(x, H + 7.6, z, 0.06, 1.2, 0.06, '#f6b94f');
    ink.fill.box(x, H + 7.5, z, 0.6, 0.05, 0.05, '#f6b94f');
  }

  private pagodaTower(rng: Rng, b: Builders, x: number, z: number, base: number) {
    const { ink } = b;
    const tiers = 5;
    let y = 0.12;
    ink.box(x, y + 0.4, z, base + 1, 0.8, base + 1, '#e8c07a');
    y += 0.8;
    for (let t = 0; t < tiers; t++) {
      const bw = base * (1 - t * 0.14);
      const bh = t === 0 ? 3.2 : 2.4;
      ink.box(x, y + bh / 2, z, bw, bh, bw, t % 2 ? '#c94f45' : '#d9594c');
      // Windows / doors on each face
      b.lit.quad(x, y + bh * 0.5, z + bw / 2 + 0.07, bw * 0.3, bh * 0.5, 'pz', windowColor(rng.next(), 'lit'));
      for (const f of ['px', 'nx'] as const) b.lit.quad(x + (f === 'px' ? 1 : -1) * (bw / 2 + 0.07), y + bh * 0.5, z, bw * 0.3, bh * 0.5, f, windowColor(rng.next(), 'lit'));
      y += bh;
      // Eave: a wide, shallow tiled pyramid with gold upturned corners
      const ew = bw + 1.6;
      ink.box(x, y + 0.1, z, ew, 0.2, ew, '#3b2a2a');
      hipRoofInked(ink, x, y + 0.2, z, ew, ew, 1.0, '#3f7a5e');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        ink.geometry(CONE8, matE(x + (sx * ew) / 2, y + 0.4, z + (sz * ew) / 2, 0.14, 0.55, 0.14, sz * 0.5, 0, -sx * 0.5), '#f4c95d');
        b.emissive.geometry(BLOB, mat(x + (sx * ew) / 2 * 0.92, y - 0.35, z + (sz * ew) / 2 * 0.92, 0.18, 0.24, 0.18), '#e8503a');
      }
      y += 0.35;
    }
    // Finial
    y += 0.7;
    for (let k = 0; k < 5; k++) ink.fill.geometry(CYL8, mat(x, y + k * 0.35, z, 0.28 - k * 0.04, 0.12, 0.28 - k * 0.04), '#f4c95d');
    ink.fill.geometry(CYL6, mat(x, y + 1.2, z, 0.05, 2.4, 0.05), '#f4c95d');
    ink.fill.geometry(BLOB, mat(x, y + 2.5, z, 0.18, 0.2, 0.18), '#f4c95d');
  }

  private lighthouse(b: Builders, x: number, z: number) {
    const { ink } = b;
    const H = 20;
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const y0 = (H / bands) * i;
      const r0 = 2.2 - (i / bands) * 0.8;
      const r1 = 2.2 - ((i + 1) / bands) * 0.8;
      ink.geometry(new THREE.CylinderGeometry(r1, r0, H / bands, 14), mat(x, y0 + H / bands / 2, z, 1, 1, 1), i % 2 ? '#fff4e6' : '#e9786f');
    }
    ink.geometry(CYL, mat(x, H + 0.15, z, 1.9, 0.3, 1.9), '#4a3a48');
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ink.fill.box(x + Math.cos(a) * 1.75, H + 0.6, z + Math.sin(a) * 1.75, 0.05, 0.6, 0.05, '#4a3a48');
    }
    b.glass.geometry(CYL, mat(x, H + 1.3, z, 1.05, 1.9, 1.05), '#ffffff');
    b.bulbs.geometry(BULB, mat(x, H + 1.3, z, 0.55, 0.65, 0.55), '#ffffff');
    ink.geometry(CONE8, mat(x, H + 2.75, z, 1.3, 1.0, 1.3), '#e9786f');
    ink.fill.box(x, H + 3.5, z, 0.05, 0.8, 0.05, '#4a3a48');
    // Door and portholes
    ink.fill.quad(x, 1.1, z + 2.21, 0.9, 1.8, 'pz', '#5b6fb0');
    for (let y = 6; y < H - 2; y += 5) ink.fill.geometry(CYL8, matE(x, y, z + 2.2 - (y / H) * 0.8 + 0.02, 0.3, 0.05, 0.3, Math.PI / 2), '#5d6a9c');
  }

  private screenTower(rng: Rng, b: Builders, x: number, z: number, tw: number) {
    const { ink } = b;
    const H = 30;
    ink.box(x, H / 2, z, tw, H, tw, '#2f3550');
    // Glowing window grid
    for (let y = 2; y < H - 1; y += 1.4) {
      for (let k = -1; k <= 1; k++) if (rng.chance(0.6)) b.emissive.quad(x + k * tw * 0.3, y, z + tw / 2 + 0.07, tw * 0.22, 0.6, 'pz', rng.pick(['#bfe8ff', '#ffd9ec', '#fff4c9']));
    }
    // Big screens on the sides, facing along the street
    for (const f of ['px', 'nx'] as const) {
      const sx = x + (f === 'px' ? 1 : -1) * (tw / 2 + 0.2);
      ink.box(sx, H * 0.62, z, 0.3, 7, 7, '#1f1a24');
      b.neon.quad(sx + (f === 'px' ? 0.17 : -0.17), H * 0.62, z, 6.4, 6.4, f, '#ffffff', this.signUV(rng.pick(this.mats.atlas.murals)));
    }
    // Antenna with a red blinker
    ink.fill.box(x, H + 3, z, 0.12, 6, 0.12, '#8a7fb8');
    ink.fill.box(x, H + 1, z, tw * 0.6, 0.1, 0.1, '#8a7fb8');
    b.bulbs.geometry(BULB, mat(x, H + 6.1, z, 0.2, 0.2, 0.2), '#ffffff');
    b.emissive.box(x, H - 0.4, z + tw / 2 + 0.08, tw - 0.2, 0.12, 0.06, rng.pick(this.hood.accents));
  }

  private glasshouse(rng: Rng, b: Builders, x: number, z: number, w: number, d: number) {
    const { ink } = b;
    const H = 4.5;
    ink.box(x, 0.4, z, w + 0.3, 0.8, d + 0.3, STONE);
    b.glass.box(x, 0.8 + H / 2, z, w, H, d, '#ffffff');
    // Barrel-vault roof ribs and glass
    for (let zz = z - d / 2; zz <= z + d / 2 + 0.01; zz += d / 5) ink.fill.box(x, 0.8 + H / 2, zz, w + 0.06, H, 0.06, '#fff8ea');
    q.setFromEuler(eul.set(-Math.PI / 2, 0, 0));
    b.glass.geometry(VAULT, m4.compose(v.set(x, 0.8 + H, z), q, s.set(w / 2, d, w / 2 * 0.8)), '#ffffff');
    // Arched ribs over the vault
    const segs = 8;
    for (let zz = z - d / 2; zz <= z + d / 2 + 0.01; zz += d / 5) {
      for (let k = 0; k < segs; k++) {
        const a0 = (k / segs) * Math.PI, a1 = ((k + 1) / segs) * Math.PI;
        const p0x = Math.cos(a0) * w / 2, p0y = Math.sin(a0) * w * 0.4;
        const p1x = Math.cos(a1) * w / 2, p1y = Math.sin(a1) * w * 0.4;
        const len = Math.hypot(p1x - p0x, p1y - p0y);
        ink.fill.geometry(BOX1, matE(x + (p0x + p1x) / 2, 0.8 + H + (p0y + p1y) / 2, zz, len + 0.04, 0.1, 0.1, 0, 0, Math.atan2(p1y - p0y, p1x - p0x)), '#fff8ea');
      }
    }
    // Palms and greenery inside
    for (let k = 0; k < 5; k++) {
      const px = x + rng.range(-w / 2 + 1, w / 2 - 1), pz = z + rng.range(-d / 2 + 1, d / 2 - 1);
      ink.fill.geometry(CYL6, mat(px, 0.8 + 1.4, pz, 0.12, 2.8, 0.12), TRUNK);
      ink.fill.geometry(BLOB, mat(px, 0.8 + 3.1, pz, 1.0, 0.6, 1.0), rng.pick(['#6f9a6a', '#8bb87a', '#5f8a5c']));
    }
    ink.fill.geometry(BLOB, mat(x, 0.8 + H + w * 0.4 + 0.2, z, 0.25, 0.3, 0.25), '#f6b94f');
  }

  private ferrisWheel(rng: Rng, b: Builders, x: number, z: number) {
    const { ink } = b;
    const R = 7;
    const hub = R + 1.5;
    // The wheel faces along X so it's seen face-on down the corridor.
    q.setFromEuler(eul.set(0, Math.PI / 2, 0));
    ink.geometry(TORUS, m4.compose(v.set(x, hub, z), q, s.set(R, R, 0.8)), '#fff4e6');
    ink.geometry(TORUS, m4.compose(v.set(x, hub, z), q, s.set(R * 0.35, R * 0.35, 0.8)), '#f28fb0');
    const spokes = 12;
    const cols = ['#e9786f', '#6fa7e0', '#57b39a', '#f6b94f', '#b18ad8', '#f28fb0'];
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      const cy = hub + Math.sin(a) * R, czz = z + Math.cos(a) * R;
      ink.boxRot(P.set(x, hub + (Math.sin(a) * R) / 2, z + (Math.cos(a) * R) / 2), eul.set(Math.PI / 2 - a, 0, 0), S.set(0.08, R, 0.08), '#fff4e6', false);
      b.bulbs.geometry(BULB, mat(x, cy, czz, 0.12, 0.12, 0.12), '#ffffff');
      ink.box(x, cy - 0.75, czz, 0.9, 0.8, 0.9, cols[k % cols.length]);
      ink.fill.box(x, cy - 0.3, czz, 0.05, 0.4, 0.05, '#4a3a48');
    }
    // A-frame legs
    for (const sx of [-0.9, 0.9]) for (const sz of [-1, 1]) {
      const footZ = z + sz * 3.6;
      const len = Math.hypot(hub, footZ - z);
      const ang = Math.atan2(footZ - z, hub);
      ink.boxRot(P.set(x + sx, hub / 2, (z + footZ) / 2), eul.set(ang, 0, 0), S.set(0.25, len, 0.25), '#b9b3cc');
    }
    ink.box(x, hub, z, 2.2, 0.5, 0.5, '#b9b3cc');
    ink.box(x, 0.35, z, 2.5, 0.5, 8, '#e8dcc4');
    void rng;
  }

  /** Abstract painted sculpture for the arts quarter: stacked shapes on a plinth. */
  private sculpture(rng: Rng, b: Builders, x: number, y: number, z: number) {
    const { ink } = b;
    const cols = ['#f28fb0', '#8fd1b5', '#f6c453', '#7fb3e8', '#b99ae0', '#f5a25d'];
    ink.box(x, y + 0.3, z, 1.2, 0.6, 1.2, '#fff1d6');
    let h = y + 0.6;
    const parts = rng.int(3, 5);
    for (let i = 0; i < parts; i++) {
      const k = rng.next();
      const sz = rng.range(0.45, 0.8);
      const col = rng.pick(cols);
      if (k < 0.33) ink.geometry(BLOB, mat(x + rng.range(-0.2, 0.2), h + sz * 0.8, z, sz, sz * 0.8, sz), col);
      else if (k < 0.66) ink.box(x + rng.range(-0.2, 0.2), h + sz / 2, z, sz, sz, sz, col, rng.range(0, 1.5));
      else ink.geometry(CONE8, mat(x, h + sz * 0.6, z, sz * 0.7, sz * 1.2, sz * 0.7), col);
      h += sz * 1.1;
    }
    // A big ring on top
    ink.geometry(TORUS, matE(x, h + 0.6, z, 0.6, 0.6, 0.6, 0), rng.pick(cols));
  }

  /** Octagonal bandstand with a striped roof and a music stand or two. */
  private bandstand(rng: Rng, b: Builders, x: number, z: number) {
    const { ink } = b;
    const r = 1.8;
    ink.geometry(CYL8, mat(x, 0.5, z, r, 0.4, r), '#fff1d6');
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      ink.fill.geometry(CYL6, mat(x + Math.cos(a) * (r - 0.2), 1.85, z + Math.sin(a) * (r - 0.2), 0.07, 2.3, 0.07), '#fff1d6');
    }
    ink.surface = Surf.Tiles;
    ink.geometry(CONE8, mat(x, 3.5, z, r + 0.4, 1.3, r + 0.4), rng.pick(['#e9786f', '#57907a', '#6fa7e0']));
    ink.surface = Surf.Plain;
    ink.fill.geometry(BLOB, mat(x, 4.25, z, 0.15, 0.15, 0.15), '#f6b94f');
    this.sagLine(new THREE.Vector3(x - r, 2.9, z + r * 0.4), new THREE.Vector3(x + r, 2.9, z + r * 0.4), 0.25, [], b.bulbs, 0.07);
    for (const sx of [-0.5, 0.5]) ink.fill.box(x + sx, 1.2, z, 0.04, 0.9, 0.04, '#4a3a48');
  }

  /** Harbour yard: stacked shipping containers under a gantry crane. */
  private yard(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number) {
    const { ink } = b;
    ink.surface = Surf.Asphalt;
    ink.fill.box(cx, 0.05, cz, w - 0.2, 0.1, d - 0.2, '#b9b0c0');
    ink.surface = Surf.Plain;
    const cols = ['#e9786f', '#5b6fb0', '#f6b94f', '#57907a', '#b18ad8', '#d96a58'];
    for (let x = cx - w / 2 + 1.6; x < cx + w / 2 - 1.4; x += 3.2) {
      const stack = rng.int(1, 3);
      for (let k = 0; k < stack; k++) {
        const col = rng.pick(cols);
        const zc = cz + rng.range(-d / 4, d / 4);
        ink.box(x, 0.1 + 1.3 * k + 0.65, zc, 2.9, 1.3, Math.min(d - 1, 6), col);
        // Corrugation
        for (let r = -1.2; r <= 1.2; r += 0.3) ink.fill.box(x + r, 0.1 + 1.3 * k + 0.65, zc + Math.min(d - 1, 6) / 2 + 0.01, 0.06, 1.1, 0.02, '#4a3a48');
      }
    }
    if (w > 5 && rng.chance(0.7)) {
      // Gantry crane straddling the stacks
      const H = 9;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) ink.box(cx + sx * (w / 2 - 0.5), H / 2, cz + sz * (d / 2 - 0.8), 0.35, H, 0.35, '#f6b94f');
      for (const sz of [-1, 1]) ink.box(cx, H, cz + sz * (d / 2 - 0.8), w - 0.6, 0.5, 0.5, '#f6b94f');
      ink.box(cx + rng.range(-w / 4, w / 4), H - 0.6, cz, 1.2, 0.8, d - 1.2, '#e9786f');
      b.wires.push([new THREE.Vector3(cx, H - 1, cz), new THREE.Vector3(cx, 3.5, cz)]);
      b.bulbs.geometry(BULB, mat(cx + w / 2 - 0.5, H + 0.4, cz - d / 2 + 0.8, 0.14, 0.14, 0.14), '#ffffff');
    }
  }

  private market(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number) {
    const { ink } = b;
    // Paved square with a tile grid
    ink.fill.box(cx, 0.06, cz, w - 0.2, 0.12, d - 0.2, '#ead9c8');
    for (let tx = cx - w / 2 + 1; tx < cx + w / 2 - 0.5; tx += 1) ink.fill.quad(tx, 0.125, cz, 0.04, d - 0.4, 'py', '#d6c2b2');
    const cols = Math.max(1, Math.floor((w - 0.8) / 2.7));
    const rows = Math.max(1, Math.min(3, Math.floor((d - 1) / 3.2)));
    const colW = (w - 0.4) / cols;
    const rowD = (d - 0.8) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx = cx - (w - 0.4) / 2 + colW * (c + 0.5);
        const sz = cz + (d - 0.8) / 2 - rowD * (r + 0.5);
        this.stall(rng, b, sx, sz, Math.min(2.3, colW - 0.3));
      }
    }
    // Festoon lights over the square
    for (let i = 0; i < 2; i++) {
      const a = new THREE.Vector3(cx - w / 2 + 0.3, 3.4, cz + d / 2 - 0.5 - i * (d / 2));
      const c = new THREE.Vector3(cx + w / 2 - 0.3, 3.4, cz + d / 2 - 1.5 - i * (d / 2));
      ink.box(a.x, 1.7, a.z, 0.1, 3.4, 0.1, WOOD);
      ink.box(c.x, 1.7, c.z, 0.1, 3.4, 0.1, WOOD);
      this.sagLine(a, c, 0.5, b.wires, b.bulbs, 0.09);
    }
  }

  /**
   * A market stall. What it sells and how it's covered depend on the
   * neighbourhood: fishmongers by the harbour, dumpling steamers and paper
   * lanterns in Chinatown, records and books in the arts quarter...
   */
  private stall(rng: Rng, b: Builders, x: number, z: number, sw: number) {
    const { ink } = b;
    const kind = rng.pick(STALLS[this.hood.name]);
    const canopy = rng.pick(CANOPIES[this.hood.name]);
    const accent = rng.pick(this.hood.name === 'chinatown' ? ['#d9594c', '#b8463f', '#e8503a'] : this.hood.name === 'harbour' ? ['#5b6fb0', '#6fa7e0', '#e9786f'] : ACCENTS);
    const second = this.hood.name === 'chinatown' ? '#f4c95d' : this.hood.name === 'neon' ? '#2f3550' : '#fff4e6';
    const y = 0.12;
    const top = y + 0.9;
    const cart = canopy === 'cart';
    const cw = cart ? Math.min(sw, 1.7) : sw;

    // Counter (or a rail for clothes)
    if (kind !== 'clothes') {
      ink.box(x, y + 0.45, z + 0.3, cw, cart ? 0.6 : 0.9, 0.8, cart ? rng.pick(['#e9786f', '#6fa7e0', '#57b39a', '#f6b94f']) : WOOD);
      if (!cart) ink.fill.quad(x, y + 0.45, z + 0.71, cw - 0.1, 0.5, 'pz', accent);
    }
    if (cart) {
      // Wheels, a handle and a lifted counter
      for (const sx of [-cw / 2 + 0.3, cw / 2 - 0.3]) {
        q.setFromEuler(eul.set(Math.PI / 2, 0, 0));
        ink.geometry(CYL, m4.compose(v.set(x + sx, y + 0.28, z + 0.72), q, s.set(0.28, 0.06, 0.28)), '#4a3a48');
      }
      ink.fill.box(x - cw / 2 - 0.35, y + 0.75, z + 0.3, 0.7, 0.05, 0.05, '#4a3a48');
    }

    // Goods
    const cx0 = x - cw / 2;
    switch (kind) {
      case 'produce': {
        const crates = Math.max(2, Math.floor(cw / 0.6));
        for (let i = 0; i < crates; i++) {
          const px = cx0 + (cw / crates) * (i + 0.5);
          ink.box(px, top + 0.1, z + 0.3, cw / crates - 0.08, 0.2, 0.6, '#d9b08a', 0, false);
          const fruit = rng.pick(FRUIT);
          for (let k = 0; k < 5; k++) ink.fill.geometry(BLOB, mat(px + rng.range(-0.15, 0.15), top + 0.25, z + 0.3 + rng.range(-0.2, 0.2), 0.1, 0.1, 0.1), fruit);
        }
        // Spare crates stacked beside the stall
        ink.box(x + cw / 2 + 0.3, y + 0.2, z + 0.5, 0.45, 0.4, 0.45, '#d9b08a');
        break;
      }
      case 'flowers': {
        for (let i = 0; i < Math.floor(cw / 0.45); i++) {
          const px = cx0 + 0.25 + i * 0.45;
          for (const [dz, dy] of [[0.1, 0.1], [0.45, 0]] as const) {
            ink.geometry(CYL8, mat(px, top + dy + 0.15, z + dz, 0.16, 0.3, 0.16), rng.pick(['#8d8398', '#b9b3cc', '#b77a64']));
            const col = rng.pick(FLOWERS);
            for (let k = 0; k < 4; k++) ink.fill.geometry(BLOB, mat(px + rng.range(-0.1, 0.1), top + dy + 0.42 + rng.range(0, 0.15), z + dz + rng.range(-0.08, 0.08), 0.09, 0.08, 0.09), col);
          }
        }
        // Buckets on the ground in front
        for (let px = cx0 + 0.3; px < x + cw / 2; px += 0.55) {
          ink.geometry(CYL8, mat(px, y + 0.18, z + 1.0, 0.17, 0.36, 0.17), '#b9b3cc');
          ink.fill.geometry(BLOB, mat(px, y + 0.5, z + 1.0, 0.2, 0.16, 0.2), rng.pick(FLOWERS));
        }
        break;
      }
      case 'fish': {
        // Crushed ice bed, tilted toward the customers, with a row of fish
        ink.boxRot(P.set(x, top + 0.08, z + 0.3), eul.set(0.25, 0, 0), S.set(cw - 0.1, 0.12, 0.7), '#e6f1f7', false);
        for (let i = 0; i < Math.floor(cw / 0.3); i++) {
          const fx = cx0 + 0.2 + i * 0.3;
          ink.fill.geometry(BLOB, matE(fx, top + 0.18, z + 0.3, 0.07, 0.06, 0.26, 0.25), rng.pick(['#b9c6d6', '#f0a497', '#e9786f', '#d6dde8']));
        }
        for (let k = 0; k < 3; k++) ink.fill.geometry(BLOB, mat(cx0 + 0.2 + k * 0.2, top + 0.2, z + 0.62, 0.06, 0.05, 0.06), '#f5d45a');
        // A hanging scale
        ink.fill.box(x + cw / 2 - 0.3, top + 0.9, z + 0.1, 0.02, 0.5, 0.02, '#4a3a48');
        ink.geometry(CYL8, mat(x + cw / 2 - 0.3, top + 0.62, z + 0.1, 0.15, 0.05, 0.15), METAL);
        break;
      }
      case 'bakery': {
        for (let i = 0; i < Math.floor(cw / 0.55); i++) {
          const px = cx0 + 0.3 + i * 0.55;
          ink.geometry(CYL8, mat(px, top + 0.06, z + 0.3, 0.24, 0.12, 0.24), '#b98a5a');
          for (let k = 0; k < 3; k++) ink.fill.geometry(BLOB, matE(px + (k - 1) * 0.12, top + 0.17, z + 0.3, 0.07, 0.07, 0.15, 0), rng.pick(['#e0a86a', '#c98a4a', '#f0c890']));
        }
        // Baguettes standing in a tall basket
        ink.geometry(CYL8, mat(x + cw / 2 + 0.3, y + 0.35, z + 0.6, 0.2, 0.7, 0.2), '#b98a5a');
        for (let k = 0; k < 4; k++) ink.fill.geometry(CYL6, matE(x + cw / 2 + 0.3 + (k - 1.5) * 0.06, y + 0.8, z + 0.6, 0.04, 0.7, 0.04, (k - 1.5) * 0.12), '#e0a86a');
        break;
      }
      case 'books': {
        for (let px = cx0 + 0.15; px < x + cw / 2 - 0.1; px += rng.range(0.28, 0.4)) {
          const stack = rng.int(2, 5);
          for (let k = 0; k < stack; k++) ink.fill.box(px, top + 0.04 + k * 0.07, z + 0.3 + rng.range(-0.15, 0.15), 0.24, 0.06, 0.32, rng.pick(['#e9786f', '#6fa7e0', '#57b39a', '#f6b94f', '#b18ad8', '#fff1d6', '#8f5a4f']));
        }
        break;
      }
      case 'records': {
        for (let px = cx0 + 0.3; px < x + cw / 2 - 0.2; px += 0.6) {
          ink.box(px, top + 0.15, z + 0.3, 0.5, 0.3, 0.55, '#c08f6c', 0, false);
          for (let k = 0; k < 5; k++) ink.fill.box(px, top + 0.33, z + 0.12 + k * 0.09, 0.42, 0.42, 0.02, rng.pick(['#f28fb0', '#8fd1b5', '#f6c453', '#7fb3e8', '#3b2a3a', '#fff1d6']));
        }
        // A turntable playing
        ink.box(x + cw / 2 - 0.3, top + 0.05, z + 0.55, 0.45, 0.1, 0.35, '#3b2a3a');
        ink.fill.geometry(CYL, mat(x + cw / 2 - 0.3, top + 0.11, z + 0.55, 0.14, 0.01, 0.14), '#1f1a24');
        break;
      }
      case 'clothes': {
        // Two rails of hanging clothes
        for (const rz of [z + 0.05, z + 0.55]) {
          ink.fill.box(x, y + 1.7, rz, cw, 0.04, 0.04, METAL);
          for (const sx of [-cw / 2, cw / 2]) ink.fill.box(x + sx, y + 0.85, rz, 0.05, 1.7, 0.05, METAL);
          for (let px = cx0 + 0.15; px < x + cw / 2 - 0.1; px += 0.22) {
            ink.box(px, y + 1.2, rz, 0.06, rng.range(0.7, 0.95), 0.38, rng.pick(['#e9786f', '#6fa7e0', '#57b39a', '#f6b94f', '#b18ad8', '#f28fb0', '#fff1d6']), 0, false);
          }
        }
        break;
      }
      case 'food':
      case 'dumplings': {
        // Hot plate (glows) and a pot or a steamer stack; steam rises from it
        const px = x - cw / 4;
        ink.box(px, top + 0.08, z + 0.3, 0.7, 0.16, 0.55, '#4a3a48');
        b.emissive.quad(px, top + 0.165, z + 0.3, 0.55, 0.4, 'py', '#ff9a5a');
        if (kind === 'dumplings') {
          for (let k = 0; k < 3; k++) ink.geometry(CYL, mat(px, top + 0.26 + k * 0.17, z + 0.3, 0.26, 0.15, 0.26), k === 2 ? '#d9b08a' : '#c9a06a');
          this.chimneys.push(new THREE.Vector3(px + this.x0, top + 0.85, this.wz(z + 0.3)));
        } else {
          ink.geometry(CYL, mat(px, top + 0.3, z + 0.3, 0.24, 0.3, 0.24), METAL);
          this.chimneys.push(new THREE.Vector3(px + this.x0, top + 0.55, this.wz(z + 0.3)));
        }
        // Bowls and a menu board
        for (let k = 0; k < 3; k++) ink.geometry(CYL8, mat(x + cw / 8 + k * 0.25, top + 0.05, z + 0.5, 0.1, 0.08, 0.1), '#fff1d6');
        ink.box(x + cw / 4, top + 0.45, z + 0.05, 0.6, 0.45, 0.04, '#3b2a3a', 0, false);
        // Stools for customers
        for (const sx of [-0.5, 0.5]) {
          ink.geometry(CYL8, mat(x + sx, y + 0.5, z + 1.05, 0.17, 0.06, 0.17), accent);
          ink.fill.geometry(CYL6, mat(x + sx, y + 0.25, z + 1.05, 0.03, 0.5, 0.03), '#4a3a48');
        }
        break;
      }
      case 'lanterns': {
        // Paper lanterns in every colour hanging from the canopy frame
        for (let px = cx0 + 0.2; px < x + cw / 2 - 0.1; px += 0.34) {
          const hy = y + rng.range(1.5, 1.8);
          ink.fill.box(px, hy + 0.3, z + 0.75, 0.015, 0.4, 0.015, '#3b2a2a');
          b.emissive.geometry(BLOB, mat(px, hy, z + 0.75, 0.13, 0.17, 0.13), rng.pick(['#e8503a', '#f4c95d', '#e8503a', '#f28fb0']));
        }
        for (let k = 0; k < 4; k++) ink.fill.geometry(BLOB, mat(cx0 + 0.3 + k * (cw - 0.6) / 3, top + 0.12, z + 0.3, 0.12, 0.13, 0.12), rng.pick(['#e8503a', '#f4c95d']));
        break;
      }
      case 'tea': {
        for (let i = 0; i < Math.floor(cw / 0.4); i++) {
          const px = cx0 + 0.22 + i * 0.4;
          if (i % 2) {
            ink.geometry(CYL8, mat(px, top + 0.15, z + 0.3, 0.12, 0.3, 0.12), rng.pick(['#b8463f', '#3f7a5e', '#f4c95d']));
          } else {
            ink.geometry(BLOB, mat(px, top + 0.11, z + 0.3, 0.13, 0.11, 0.13), rng.pick(['#e6d6c0', '#57907a', '#8f5a4f']));
            ink.fill.geometry(CYL6, matE(px + 0.13, top + 0.14, z + 0.3, 0.025, 0.14, 0.025, -0.8), '#8f5a4f');
          }
        }
        break;
      }
      case 'gadgets': {
        for (let px = cx0 + 0.25; px < x + cw / 2 - 0.15; px += 0.45) {
          ink.box(px, top + 0.14, z + 0.35, 0.36, 0.28, 0.22, '#2f3550', 0, false);
          b.emissive.quad(px, top + 0.15, z + 0.47, 0.3, 0.2, 'pz', rng.pick(['#8fe3ff', '#ff8fb1', '#9dffc8', '#ffe08a']));
        }
        break;
      }
      case 'plants': {
        for (let px = cx0 + 0.2; px < x + cw / 2 - 0.1; px += 0.4) {
          const ph = rng.range(0.15, 0.3);
          ink.geometry(CYL8, mat(px, top + ph / 2, z + 0.3, 0.13, ph, 0.13), '#d98a6a');
          const r = rng.range(0.14, 0.24);
          ink.fill.geometry(BLOB, mat(px, top + ph + r * 0.8, z + 0.3, r, r * 1.2, r), rng.pick(['#8bc36a', '#6f9a6a', '#9fc48a', ...FLOWERS.slice(0, 2)]));
        }
        break;
      }
      case 'nets': {
        ink.geometry(TORUS, matE(x - cw / 4, top + 0.08, z + 0.3, 0.3, 0.3, 0.3, Math.PI / 2), '#d9c6b2');
        for (let k = 0; k < 4; k++) ink.fill.geometry(BLOB, mat(x + (k - 1) * 0.28, top + 0.14, z + 0.3, 0.13, 0.13, 0.13), k % 2 ? '#e9786f' : '#fff1d6');
        ink.fill.quad(x, y + 1.3, z - 0.18, cw, 1.1, 'pz', '#8f7a68');
        break;
      }
    }

    // Canopy
    const frame = WOOD;
    const tall = y + 2.2;
    if (canopy === 'striped' || canopy === 'solid') {
      for (const px of [-cw / 2, cw / 2]) {
        ink.box(x + px, y + 1.1, z - 0.2, 0.08, 2.2, 0.08, frame);
        ink.box(x + px, y + 0.95, z + 0.7, 0.08, 1.9, 0.08, frame);
      }
      if (canopy === 'striped') {
        const stripes = Math.max(3, Math.round(cw / 0.4));
        const stw = (cw + 0.3) / stripes;
        for (let i = 0; i < stripes; i++) {
          const px = x - (cw + 0.3) / 2 + stw * (i + 0.5);
          ink.boxRot(P.set(px, tall, z + 0.25), eul.set(0.3, 0, 0), S.set(stw + 0.005, 0.06, 1.3), i % 2 ? second : accent, false);
        }
        ink.outline.geometry(BOX1, matE(x, tall, z + 0.25, cw + 0.46, 0.2, 1.46, 0.3), 0x000000);
      } else {
        ink.boxRot(P.set(x, tall, z + 0.25), eul.set(0.3, 0, 0), S.set(cw + 0.3, 0.06, 1.3), accent);
        // Fringe
        for (let px = x - cw / 2; px <= x + cw / 2 + 0.01; px += 0.2) ink.fill.geometry(BLOB, mat(px, tall - 0.28, z + 0.87, 0.06, 0.08, 0.04), second);
      }
    } else if (canopy === 'umbrella') {
      ink.fill.geometry(CYL6, mat(x, y + 1.25, z - 0.25, 0.04, 2.5, 0.04), '#4a3a48');
      const r = Math.min(1.25, cw * 0.6);
      ink.fill.geometry(CONE8, mat(x, y + 2.35, z + 0.2, r, 0.4, r), accent);
      ink.fill.geometry(CONE8, mat(x, y + 2.47, z + 0.2, r * 0.45, 0.19, r * 0.45), second);
      ink.outline.geometry(CONE8, mat(x, y + 2.35, z + 0.2, r + 0.06, 0.46, r + 0.06), 0x000000);
      ink.fill.geometry(BLOB, mat(x, y + 2.6, z + 0.2, 0.06, 0.06, 0.06), second);
    } else if (canopy === 'tent') {
      // Peaked tent: two roof slopes meeting over the counter
      for (const px of [-cw / 2, cw / 2]) for (const pz of [-0.25, 0.85]) ink.fill.box(x + px, y + 1.05, z + pz, 0.07, 2.1, 0.07, frame);
      for (const side of [-1, 1]) {
        ink.boxRot(P.set(x, y + 2.35, z + 0.3 + side * 0.33), eul.set(side * 0.62, 0, 0), S.set(cw + 0.25, 0.05, 0.85), side < 0 ? accent : second);
      }
      ink.fill.box(x, y + 2.6, z + 0.3, cw + 0.3, 0.06, 0.06, frame);
    } else {
      // Cart roof on two poles
      for (const px of [-cw / 2 + 0.1, cw / 2 - 0.1]) ink.fill.box(x + px, y + 1.4, z + 0.3, 0.05, 1.2, 0.05, '#4a3a48');
      ink.box(x, y + 2.05, z + 0.3, cw + 0.3, 0.1, 1.0, accent);
      for (let px = x - cw / 2; px <= x + cw / 2 + 0.01; px += 0.25) ink.fill.geometry(BLOB, mat(px, y + 1.95, z + 0.82, 0.07, 0.09, 0.04), second);
    }
    // Hanging lantern
    const lanternY = canopy === 'cart' ? y + 1.8 : y + 1.95;
    if (this.hood.name === 'chinatown') b.emissive.geometry(BLOB, mat(x + cw / 2 - 0.2, lanternY - 0.1, z + 0.6, 0.14, 0.18, 0.14), '#e8503a');
    else b.bulbs.geometry(BULB, mat(x, lanternY - 0.1, z + 0.5, 0.12, 0.15, 0.12), '#ffffff');
    b.glow.quad(x, 0.14, z + 0.9, 2, 2, 'py', '#ffffff');
  }

  // =========================================================================

  private sagLine(a: THREE.Vector3, c: THREE.Vector3, sag: number, wires: THREE.Vector3[][], bulbs?: GeoBuilder, bulbSize = 0.08) {
    const pts: THREE.Vector3[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(c, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      pts.push(p);
      if (bulbs && i > 0 && i < n) bulbs.geometry(BULB, mat(p.x, p.y - 0.08, p.z, bulbSize, bulbSize * 1.3, bulbSize), '#ffffff');
    }
    wires.push(pts);
  }

  private powerLines(rng: Rng, b: Builders) {
    const { ink } = b;
    // Utility poles on the sidewalk between rows 1 and 2.
    const z = rowFront(2) + STREET - 0.45;
    const poleH = 13;
    const xs = [0, CHUNK_W / 2, CHUNK_W];
    for (const px of xs.slice(0, 2)) {
      ink.box(px + 0.5, poleH / 2, z, 0.3, poleH, 0.3, TRUNK);
      ink.box(px + 0.5, poleH - 0.6, z, 2.4, 0.18, 0.18, TRUNK);
    }
    for (let i = 0; i < xs.length - 1; i++) {
      for (const off of [-1, 0, 1]) {
        const a = new THREE.Vector3(xs[i] + 0.5 + off * 1.0, poleH - 0.5, z);
        const c = new THREE.Vector3(xs[i + 1] + 0.5 + off * 1.0, poleH - 0.5, z);
        this.sagLine(a, c, 0.9 + rng.range(-0.1, 0.1), b.wires);
      }
    }
  }

  /** The stretch of railway crossing this chunk: viaduct, ramps, street-level cutting, tunnels, stations. */
  private viaduct(rng: Rng, b: Builders) {
    const { ink } = b;
    const x0 = this.x0;
    const step = 2;
    const stations = stationsIn(x0 - STATION_LEN, x0 + CHUNK_W + STATION_LEN);
    const inStation = (wx: number) => stations.find((st) => Math.abs(wx - st.x) <= STATION_LEN / 2);

    for (let lx = 0; lx < CHUNK_W; lx += step) {
      const wxa = x0 + lx, wxb = wxa + step, wx = wxa + step / 2;
      if (inTunnel(wx)) continue;
      const ya = railY(wxa), yb = railY(wxb), y = (ya + yb) / 2;
      const yaw = railYaw(wx);
      const len = step * Math.sqrt(1 + railSlope(wx) ** 2);
      const pitch = Math.atan2(yb - ya, len);
      const rot = new THREE.Euler(0, yaw, pitch, 'YZX');
      const at = (off: number, dy: number) => {
        const p = trackPoint(wx, off);
        return P.set(p.x - x0, y + dy, p.z);
      };
      const ground = y < 1;
      ink.surface = ground ? Surf.Gravel : Surf.Stone;
      if (ground) {
        // Ballast bed with low fences either side
        ink.boxRot(at(0, -0.12), rot, S.set(len + 0.1, 0.3, 4.0), '#a79a9a', false);
        for (const side of [-1, 1]) {
          ink.boxRot(at(side * 2.3, 0.45), rot, S.set(len + 0.05, 0.08, 0.06), '#6b5c78', false);
          ink.boxRot(at(side * 2.3, 0.25), rot, S.set(0.08, 0.5, 0.08), '#6b5c78', false);
        }
      } else {
        ink.boxRot(at(0, -DECK_H / 2), rot, S.set(len + 0.1, DECK_H, 4.0), CONCRETE, false);
        ink.boxRot(at(0, -DECK_H - 0.04), rot, S.set(len + 0.1, 0.1, 4.1), '#8d8398', false);
        for (const side of [-1, 1]) ink.boxRot(at(side * 1.95, 0.3), rot, S.set(len + 0.1, 0.6, 0.16), KERB, false);
      }
      ink.surface = Surf.Plain;
      for (const t of [-TRACK_OFFSET, TRACK_OFFSET]) {
        for (const r of [-0.3, 0.3]) ink.boxRot(at(t + r, 0.08), rot, S.set(len + 0.1, 0.1, 0.08), '#8d8398', false);
        ink.boxRot(at(t, 0.02), rot, S.set(0.22, 0.06, 1.1), '#9c7a66', false);
      }
      const st = inStation(wx);
      if (st) this.platform(b, wx, y, rot, st.elevated, Math.abs(wx - st.x) <= step / 2 ? st.name : -1, lx);
    }

    // Pillars under the viaduct (kept off roads and the corridor).
    const avoid = [CANAL_Z, TRAM_STREET, BUS_STREET, rowFront(4) + STREET / 2, 2 * CANAL_Z - TRAM_STREET, 2 * CANAL_Z - BUS_STREET, 2 * CANAL_Z - rowFront(4) - STREET / 2];
    for (const wx of pillarXs(x0, x0 + CHUNK_W)) {
      const y = railY(wx);
      const z = railZ(wx);
      if (y < 4 || inTunnel(wx)) continue;
      const clear = avoid.every((a, i) => Math.abs(z - a) > (i === 0 ? 6 : 3.8));
      if (!clear) continue;
      const lx = wx - x0;
      const yaw = railYaw(wx);
      ink.surface = Surf.Stone;
      ink.box(lx, (y - DECK_H) / 2, z, 1.1, y - DECK_H, 1.4, CONCRETE, yaw);
      ink.box(lx, y - DECK_H - 0.4, z, 1.5, 0.6, 3.2, CONCRETE, yaw);
      ink.surface = Surf.Plain;
    }
    // Catenary masts and wires wherever the line is in the open.
    for (let wx = Math.ceil(x0 / 9) * 9; wx < x0 + CHUNK_W; wx += 9) {
      if (inTunnel(wx) || inStation(wx)) continue;
      const y = railY(wx);
      for (const side of [-1, 1]) {
        const p = trackPoint(wx, side * 2.1);
        ink.box(p.x - x0, y + 1.6, p.z, 0.12, 3.2, 0.12, '#8d8398', 0, false);
      }
      const a = trackPoint(wx, -2.1), c = trackPoint(wx, 2.1);
      b.wires.push([new THREE.Vector3(a.x - x0, y + 3.1, a.z), new THREE.Vector3(c.x - x0, y + 3.1, c.z)]);
    }
    for (const t of [-TRACK_OFFSET, TRACK_OFFSET]) {
      let line: THREE.Vector3[] = [];
      for (let lx = 0; lx <= CHUNK_W + 0.01; lx += 3) {
        const wx = x0 + lx;
        if (inTunnel(wx)) {
          if (line.length > 1) b.wires.push(line);
          line = [];
          continue;
        }
        const p = trackPoint(wx, t);
        line.push(new THREE.Vector3(p.x - x0, railY(wx) + 2.95, p.z));
      }
      if (line.length > 1) b.wires.push(line);
    }
    // Tunnel mouths
    for (const px of portalsIn(x0, x0 + CHUNK_W)) {
      const z = railZ(px);
      const yaw = railYaw(px);
      const lx = px - x0;
      ink.surface = Surf.Stone;
      ink.box(lx, 2.6, z, 3.0, 5.2, 6.4, STONE, yaw);
      ink.surface = Surf.Plain;
      ink.box(lx, 5.35, z, 3.3, 0.3, 6.8, KERB, yaw);
      const dir = new THREE.Vector3(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      for (const sgn of [-1, 1]) {
        const face = P.set(lx + dir.x * 1.52 * sgn, 2.0, z + dir.z * 1.52 * sgn);
        b.dark.geometry(BOX1, m4.compose(face, q.setFromEuler(eul.set(0, yaw, 0)), S.set(0.05, 3.6, 4.4)), '#2a2238');
      }
    }
    void rng;
  }

  /** Platforms, canopy, benches, lamps and a name board, one 2-unit slice at a time. */
  private platform(b: Builders, wx: number, y: number, rot: THREE.Euler, elevated: boolean, name: number, lx: number) {
    const { ink } = b;
    const x0 = this.x0;
    const at = (off: number, dy: number) => {
      const p = trackPoint(wx, off);
      return P.set(p.x - x0, y + dy, p.z);
    };
    const len = 2 * Math.sqrt(1 + railSlope(wx) ** 2) + 0.1;
    ink.surface = Surf.Paving;
    for (const side of [-1, 1]) {
      ink.boxRot(at(side * 3.0, elevated ? -0.1 : 0.15), rot, S.set(len, elevated ? 1.4 : 0.6, 2.0), '#e8dcd0', false);
      ink.boxRot(at(side * 2.05, 0.56), rot, S.set(len, 0.04, 0.12), '#f6c453', false); // yellow edge line
    }
    ink.surface = Surf.Plain;
    const odd = Math.round(lx / 2) % 3 === 0;
    for (const side of [-1, 1]) {
      if (odd) ink.boxRot(at(side * 3.4, 1.8), rot, S.set(0.12, 2.6, 0.12), '#6b5c78', false);
      ink.boxRot(at(side * 3.0, 3.15), rot, S.set(len, 0.12, 2.4), '#c8b5e6', false);
      if (odd) {
        const p = at(side * 3.0, 2.9);
        b.bulbs.geometry(BULB, mat(p.x, p.y, p.z, 0.12, 0.08, 0.12), '#ffffff');
        b.glow.quad(p.x, y + 0.63, p.z, 2.4, 2.4, 'py', '#ffffff');
      }
      if (Math.round(lx / 2) % 4 === 1) ink.boxRot(at(side * 3.6, 0.9), rot, S.set(1.4, 0.08, 0.4), WOOD, false);
    }
    if (name >= 0) {
      const uv = this.mats.atlas.stations[name % STATION_NAMES.length];
      for (const side of [-1, 1]) {
        const p = at(side * 3.7, 2.25);
        const yaw = rot.y;
        const board = new THREE.Vector3(p.x, p.y, p.z);
        ink.box(board.x, board.y, board.z, 3.4, 0.8, 0.08, '#2f4f8a', yaw);
        const nrm = new THREE.Vector3(0, 0, -side).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        const c = board.clone().addScaledVector(nrm, 0.06);
        q.setFromEuler(eul.set(0, yaw + (side === 1 ? Math.PI : 0), 0));
        b.signs.geometryUV(SIGN_PLANE, m4.compose(c, q, S.set(3.2, 0.7, 1)), '#ffffff', uv);
      }
    }
  }

  /**
   * How the railway affects a lot (local footprint): null if it doesn't,
   * otherwise the maximum building height (small values clear the lot).
   */
  private railLimit(lx0: number, lx1: number, lz0: number, lz1: number): number | null {
    const za = this.wz(lz0), zb = this.wz(lz1);
    const zMin = Math.min(za, zb), zMax = Math.max(za, zb);
    let limit: number | null = null;
    for (let lx = lx0; lx <= lx1 + 0.01; lx += 1.5) {
      const wx = this.x0 + Math.min(lx, lx1);
      if (inTunnel(wx)) continue;
      const z = railZ(wx);
      const half = stationsIn(wx - 1, wx + 1).length ? 5.5 : 3.4;
      if (z + half < zMin || z - half > zMax) continue;
      const y = railY(wx);
      const h = y < 7 ? 0 : y - DECK_H - 1.6;
      limit = limit === null ? h : Math.min(limit, h);
    }
    // Pillars and tunnel mouths need the whole lot.
    for (const px of pillarXs(this.x0 + lx0 - 1, this.x0 + lx1 + 1)) {
      const z = railZ(px);
      if (z > zMin - 1.5 && z < zMax + 1.5 && railY(px) >= 4 && !inTunnel(px)) limit = 0;
    }
    for (const px of portalsIn(this.x0 + lx0 - 4, this.x0 + lx1 + 4)) {
      const z = railZ(px);
      if (z > zMin - 4 && z < zMax + 4) limit = 0;
    }
    return limit;
  }

  /** A lot given over to the railway: gravel, shrubs. */
  private railside(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number) {
    const { ink } = b;
    ink.surface = Surf.Gravel;
    ink.fill.box(cx, 0.06, cz, w - 0.2, 0.12, d - 0.2, '#c9bcb4');
    ink.surface = Surf.Foliage;
    for (let i = 0; i < rng.int(2, 5); i++) {
      const x = cx + rng.range(-w / 2 + 0.6, w / 2 - 0.6), z = cz + rng.range(-d / 2 + 0.6, d / 2 - 0.6);
      ink.geometry(BLOB, mat(x, 0.35, z, 0.55, 0.45, 0.55), rng.pick(['#8fb98a', '#9fd49a', '#7aa874']));
    }
    ink.surface = Surf.Plain;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

/** A little painted rowing boat, optionally with a canopy and lantern. */
export function buildBoat(ink: InkedBuilder, bulbs: GeoBuilder | null, x: number, z: number, color: string, canopy: boolean, y = WATER_Y) {
  ink.box(x, y + 0.12, z, 2.4, 0.4, 1.0, color);
  ink.boxRot(P.set(x + 1.35, y + 0.2, z), eul.set(0, 0, 0.5), S.set(0.6, 0.35, 0.8), color);
  ink.boxRot(P.set(x - 1.35, y + 0.2, z), eul.set(0, 0, -0.5), S.set(0.6, 0.35, 0.8), color);
  ink.fill.quad(x, y + 0.33, z, 2.2, 0.8, 'py', '#8a6a60');
  ink.fill.box(x, y + 0.35, z, 0.25, 0.06, 0.9, WOOD);
  ink.fill.box(x, y + 0.2, z + 0.51, 2.4, 0.08, 0.01, '#fff4e6');
  if (canopy) {
    for (const px of [-0.6, 0.6]) for (const pz of [-0.4, 0.4]) ink.fill.box(x + px, y + 0.9, z + pz, 0.05, 1.1, 0.05, WOOD);
    ink.box(x, y + 1.48, z, 1.5, 0.1, 1.0, '#fff4e6');
  }
  if (bulbs) {
    // Short lantern pole: low enough to pass under the bridges.
    ink.fill.box(x + 1.1, y + 0.55, z, 0.04, 0.45, 0.04, '#4a3a48');
    bulbs.geometry(BULB, mat(x + 1.1, y + 0.82, z, 0.1, 0.13, 0.1), '#ffffff');
  }
}
