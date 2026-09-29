import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, hashSeed } from '../rng';
import { FOLIAGE } from '../palette';
import { GeoBuilder, InkedBuilder } from './geo';
import type { Materials } from './materials';
import type { UVRect } from './textures';
import { windowColor } from './windows';
import { areaAt, type District, type Hood } from './hoods';
import { Surf } from './surfaces';
import { railZ, railSlope, railYaw, trackPoint, RAIL_Y, DECK_H, TRACK_OFFSET } from './rail';

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
const BOX1 = new THREE.BoxGeometry(1, 1, 1);
const WHEEL = new THREE.TorusGeometry(0.28, 0.035, 5, 12);
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
          if (row >= 1 && row <= 3 && facesStreet && roll < this.hood.marketChance && w > 5) {
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
      for (let x = lampX; x < CHUNK_W - 1; x += 9) this.lampPost(b, x, half0 + 1.2, 0.16, true);
      for (let x = lampX + 4.5; x < CHUNK_W - 1; x += 9) if (rng.chance(0.7)) this.tree(rng, b, x, 0.16, half0 + 0.8, rng.range(0.7, 0.85));
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
      for (let x = rng.range(1, 3); x < CHUNK_W - 1; x += 5) this.tree(rng, b, x, 0, half0 + 0.8, rng.range(0.75, 0.9));
      for (let x = rng.range(4, 6); x < CHUNK_W - 2; x += 10) {
        ink.box(x, 0.45, half0 + 2.1, 1.6, 0.1, 0.5, WOOD);
        ink.box(x, 0.8, half0 + 1.85, 1.6, 0.4, 0.08, WOOD);
        this.lampPost(b, x + 2.5, half0 + 1.9, 0, false);
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
    ink.surface = Surf.Tiles;
    q.setFromEuler(eul.set(0, Math.PI / 4, 0));
    ink.geometry(new THREE.ConeGeometry(1, 1, 4), m4.compose(v.set(x, 8.2, CANAL_Z), q, s.set(1.6, 1.3, (z1 - z0 + 2.4) / 2 / Math.SQRT1_2)), '#3f7a5e');
    ink.surface = Surf.Plain;
    for (const z of [z0 - 0.9, z1 + 0.9]) ink.geometry(CONE8, matE(x, 7.8, z, 0.16, 0.6, 0.16, z < CANAL_Z ? -0.6 : 0.6), '#f4c95d');
    // Sign board, readable from both directions
    const uv = this.mats.atlas.cjkWide[0];
    ink.box(x, 5.4, CANAL_Z, 0.2, 1.1, 3.6, '#f4c95d');
    b.signs.quad(x + 0.12, 5.4, CANAL_Z, 3.3, 0.85, 'px', '#ffffff', uv);
    b.signs.quad(x - 0.12, 5.4, CANAL_Z, 3.3, 0.85, 'nx', '#ffffff', uv);
    // Lanterns under the beam
    for (const z of [CANAL_Z - 1.2, CANAL_Z + 1.2]) b.emissive.geometry(BLOB, mat(x, 6.3, z, 0.3, 0.38, 0.3), '#e8503a');
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
    if (rng.chance(0.4)) this.bridge(b, rng.range(12, CHUNK_W - 6), 1.6, false);

    // Mooring posts and moored boats.
    for (let x = 5; x < CHUNK_W - 1; x += rng.range(3, 6)) {
      const side = rng.chance(0.5) ? nearWall - 0.35 : farWall + 0.35;
      ink.geometry(CYL6, mat(x, WATER_Y + 0.55, side, 0.1, 1.2, 0.1), '#8a6a60');
      ink.fill.geometry(CYL6, mat(x, WATER_Y + 1.1, side, 0.12, 0.1, 0.12), '#f1e5df');
    }
    const boats = rng.int(1, 3);
    for (let i = 0; i < boats; i++) {
      const bx = rng.range(7, CHUNK_W - 4);
      const near = rng.chance(0.5);
      buildBoat(ink, b.bulbs, bx, near ? CANAL_Z1 - 1.05 : CANAL_Z0 + 1.05, rng.pick(ACCENTS), rng.chance(0.4));
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
    // Arch face underneath (visible from the camera side), outlined.
    ink.box(cx, -0.35, (z0 + z1) / 2, width + 0.1, 0.7, 0.5, STONE);
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
      // Zebra crossing next to the avenue
      for (let z = roadZ0 + 0.25; z < roadZ1 - 0.1; z += 0.5) ink.fill.quad(AVENUE_W + 0.9, 0.02, z, 1.3, 0.26, 'py', '#f6eee0');

      if (row === 4) continue; // barely visible; keep it light
      // Lamps and trees along the far kerb (in front of the row's facades)
      const lampX = rng.range(6, 10);
      for (let x = lampX; x < CHUNK_W - 1; x += 9) this.lampPost(b, x, zF + 0.35, 0, true);
      for (let x = lampX + 4.5; x < CHUNK_W - 1; x += 9) if (rng.chance(0.6)) this.tree(rng, b, x, 0.16, zF + 0.45, rng.range(0.8, 1.05));
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
    // Railway arches: keep buildings under the viaduct low.
    if (this.underRail(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2)) floors = Math.min(floors, 3);
    const h = floors * FLOOR + 0.6;
    const wall = rng.pick(hood.walls);
    const trim = rng.pick(hood.trims);
    const roof = rng.pick(hood.roofs);
    const accent = rng.pick(hood.accents);
    const front = cz + d / 2;
    const detailed = row <= 3;

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
    ink.surface = Surf.Gravel;
    ink.fill.box(cx, h + 0.02, cz, w - 0.2, 0.06, d - 0.2, roof);
    ink.surface = Surf.Plain;
    ink.box(cx, h + ph / 2, front - pt / 2, w, ph, pt, wall);
    ink.box(cx, h + ph / 2, cz - d / 2 + pt / 2, w, ph, pt, wall);
    ink.box(cx - w / 2 + pt / 2, h + ph / 2, cz, pt, ph, d - 2 * pt, wall);
    ink.box(cx + w / 2 - pt / 2, h + ph / 2, cz, pt, ph, d - 2 * pt, wall);

    const shop = facesStreet && row >= 1 && row <= 3 && rng.chance(hood.shopChance);
    if (shop) this.shopfront(rng, b, cx, front, w, accent, row !== 1 || this.district !== 'canal');
    this.windows(rng, b, cx, cz, w, d, floors, trim, accent, shop, detailed);

    if (this.hood.ivy && rng.chance(0.55)) this.ivy(rng, b, cx, front, w, h);
    if (this.hood.murals && floors >= 2 && rng.chance(0.55)) this.mural(rng, b, cx, cz, w, d, h);
    if (this.hood.festoon === 'neon' && rng.chance(0.6)) {
      // Neon strip tracing the cornice
      const col = rng.pick(this.hood.accents);
      b.emissive.box(cx, h - 0.4, front + 0.05, w - 0.2, 0.08, 0.06, col);
      if (floors >= 3) b.emissive.box(cx, FLOOR * 2 + 0.1, front + 0.05, w - 0.2, 0.06, 0.06, rng.pick(this.hood.accents));
    }
    if (floors >= 3 && rng.chance(0.25)) this.fireEscape(rng, b, cx, front, w, floors);
    if (detailed && floors >= 2 && facesStreet && rng.chance(hood.neonChance)) this.neonBlade(rng, b, cx + (rng.chance(0.5) ? -1 : 1) * (w / 2 - 0.45), front, floors);

    this.rooftop(rng, b, row, cx, cz, w, d, h, wall, trim);
  }

  private shopfront(rng: Rng, b: Builders, cx: number, front: number, w: number, accent: string, cafe: boolean) {
    const { ink } = b;
    const z = front + 0.02;
    const winW = Math.min(w * 0.55, 4.2);
    const doorX = cx + (rng.chance(0.5) ? 1 : -1) * (winW / 2 + 0.6);
    // Display window with warm light and a trim frame
    ink.fill.quad(cx, 1.3, z, winW + 0.3, 1.7, 'pz', '#4a3a48');
    b.lit.quad(cx, 1.3, z + 0.02, winW, 1.45, 'pz', windowColor(rng.next(), 'lit', true));
    for (let mx = cx - winW / 2 + winW / 3; mx < cx + winW / 2 - 0.1; mx += winW / 3) ink.fill.quad(mx, 1.3, z + 0.04, 0.06, 1.45, 'pz', '#4a3a48');
    ink.fill.quad(doorX, 1.05, z, 0.95, 2.1, 'pz', '#4a3a48');
    b.dark.quad(doorX, 1.05, z + 0.02, 0.75, 1.95, 'pz', '#f7e6d0');
    // Striped awning
    const aw = Math.min(w - 0.4, winW + 1.8);
    const stripes = Math.max(3, Math.round(aw / 0.45));
    const sw = aw / stripes;
    const tilt = 0.42;
    for (let i = 0; i < stripes; i++) {
      const sx = cx - aw / 2 + sw * (i + 0.5);
      ink.boxRot(P.set(sx, 2.55, z + 0.55), eul.set(tilt, 0, 0), S.set(sw + 0.005, 0.07, 1.2), i % 2 ? '#fff4e6' : accent, false);
    }
    ink.outline.geometry(BOX1, matE(cx, 2.55, z + 0.55, aw + 0.16, 0.2, 1.36, tilt), 0x000000);
    // Scalloped valance
    for (let i = 0; i < stripes; i++) {
      const sx = cx - aw / 2 + sw * (i + 0.5);
      ink.fill.geometry(CYL8, matE(sx, 2.27, z + 1.1, sw * 0.5, 0.04, 0.18, Math.PI / 2), i % 2 ? '#fff4e6' : accent);
    }
    // Shop board above the awning
    const board = rng.pick(this.mats.atlas.small);
    b.signs.quad(cx, 3.15, z + 0.06, 1.6, 0.8, 'pz', '#ffffff', this.signUV(board));
    ink.box(cx, 3.15, z + 0.02, 1.7, 0.9, 0.06, '#4a3a48', 0, false);

    if (cafe && rng.chance(0.55)) {
      // Café table with an umbrella on the sidewalk
      const tx = cx + rng.range(-winW / 2, winW / 2);
      const tz = front + 0.5;
      ink.geometry(CYL, mat(tx, 0.55, tz, 0.3, 0.05, 0.3), '#fff1d6');
      ink.fill.geometry(CYL6, mat(tx, 0.35, tz, 0.04, 0.4, 0.04), '#4a3a48');
      ink.fill.geometry(CYL6, mat(tx, 1.3, tz, 0.03, 1.6, 0.03), '#4a3a48');
      ink.geometry(CONE8, mat(tx, 2.1, tz, 0.95, 0.35, 0.95), accent);
      for (const sx of [-0.45, 0.45]) ink.box(tx + sx, 0.4, tz, 0.3, 0.06, 0.3, WOOD, 0, false);
    }
  }

  private windows(
    rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number, floors: number,
    trim: string, accent: string, shop: boolean, detailed: boolean,
  ) {
    const { ink } = b;
    const litChance = rng.range(0.25, 0.6);
    const shutters = detailed && rng.chance(0.35);
    const balconies = detailed && floors >= 2 && rng.chance(0.3);
    const flowerBoxes = detailed && rng.chance(0.45);
    const arched = rng.chance(0.25);
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
            ink.fill.quad(x, y, z + 0.02, ww + 0.3, wh + 0.3, 'pz', trim);
            target.quad(x, y + 0.02, z + 0.04, ww, wh, 'pz', glass);
            if (arched) ink.fill.geometry(CYL8, matE(x, y + wh / 2 + 0.1, z + 0.03, (ww + 0.3) / 2, 0.02, 0.35, Math.PI / 2), trim);
            // Curtains in lit rooms
            if (isLit && detailed && rng.chance(0.5)) {
              const cc = rng.pick(['#f28fb0', '#a9c9f0', '#f8dea0', '#bde2d0']);
              ink.fill.quad(x - ww / 2 + 0.14, y + 0.02, z + 0.05, 0.22, wh, 'pz', cc);
              ink.fill.quad(x + ww / 2 - 0.14, y + 0.02, z + 0.05, 0.22, wh, 'pz', cc);
            }
            if (!detailed) continue;
            ink.fill.box(x, y - wh / 2 - 0.12, z + 0.12, ww + 0.4, 0.08, 0.24, trim);
            if (shutters) {
              ink.fill.quad(x - ww / 2 - 0.3, y, z + 0.05, 0.36, wh + 0.1, 'pz', accent);
              ink.fill.quad(x + ww / 2 + 0.3, y, z + 0.05, 0.36, wh + 0.1, 'pz', accent);
            }
            if (balconies && f >= 1 && c % 2 === 0) {
              this.balcony(rng, b, x, f * FLOOR + 0.2, z, ww + 0.9);
            } else if (flowerBoxes && rng.chance(0.3)) {
              ink.box(x, y - wh / 2 - 0.3, z + 0.2, ww + 0.1, 0.26, 0.3, '#b77a64');
              for (let k = 0; k < 4; k++) ink.fill.geometry(BLOB, mat(x - 0.35 + k * 0.23, y - wh / 2 - 0.1, z + 0.22, 0.12, 0.12, 0.12), rng.pick(k % 2 ? FLOWERS : FOLIAGE));
            }
          } else {
            const sgn = facing === 'px' ? 1 : -1;
            const x = cx + (sgn * w) / 2;
            ink.fill.quad(x + sgn * 0.02, y, cz + o, ww + 0.3, wh + 0.3, facing, trim);
            target.quad(x + sgn * 0.04, y + 0.02, cz + o, ww, wh, facing, glass);
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
    ink.box(x, y, z + 0.4, bw, 0.12, 0.8, CONCRETE);
    ink.box(x, y + 0.55, z + 0.78, bw, 0.05, 0.05, '#4a3a48', 0, false);
    for (let k = 0; k <= 6; k++) ink.fill.box(x - bw / 2 + (bw * k) / 6, y + 0.3, z + 0.78, 0.035, 0.5, 0.035, '#4a3a48');
    if (rng.chance(0.6)) {
      const px = x + rng.range(-bw / 3, bw / 3);
      ink.geometry(CYL, mat(px, y + 0.2, z + 0.4, 0.14, 0.28, 0.14), '#d98a6a');
      ink.fill.geometry(BLOB, mat(px, y + 0.5, z + 0.4, 0.26, 0.3, 0.26), rng.pick(['#8bc36a', '#9fd49a', ...FOLIAGE]));
    }
  }

  private neonBlade(rng: Rng, b: Builders, x: number, front: number, floors: number) {
    const uv: UVRect = rng.pick(this.mats.atlas.tall);
    const h = Math.min(3.2, (floors - 1) * FLOOR);
    const y = FLOOR + 0.3 + h / 2;
    b.ink.box(x, y, front + 0.14, 0.9, h + 0.2, 0.12, '#3b2a45');
    b.neon.quad(x, y, front + 0.21, 0.78, h, 'pz', '#ffffff', this.signUV(uv));
  }

  private fireEscape(rng: Rng, b: Builders, cx: number, front: number, w: number, floors: number) {
    const { ink } = b;
    const fw = Math.min(w * 0.55, 4);
    const fx = cx + rng.range(-w / 2 + fw / 2 + 0.3, w / 2 - fw / 2 - 0.3);
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

  private rooftop(rng: Rng, b: Builders, _row: number, cx: number, cz: number, w: number, d: number, h: number, wall: string, trim: string) {
    const { ink } = b;
    const roofY = h + 0.05;
    const style = this.hood.roofStyle;
    if (style === 'pagoda' && rng.chance(0.7)) {
      this.pagodaRoof(rng, b, cx, cz, w, d, roofY);
      return;
    }
    if (style === 'sawtooth' && rng.chance(0.7)) {
      this.sawtoothRoof(rng, b, cx, cz, w, d, roofY);
      return;
    }
    const front = cz + d / 2;
    const usable = { x0: cx - w / 2 + 0.7, x1: cx + w / 2 - 0.7, z0: cz - d / 2 + 0.7, z1: front - 0.7 };
    const backZ = usable.z0 + 1.4;
    const rx = () => rng.range(usable.x0 + 0.6, usable.x1 - 0.6);
    const rzBack = () => rng.range(usable.z0 + 0.6, cz);

    if (rng.chance(0.4)) {
      const bx = rng.range(usable.x0 + 1, usable.x1 - 1);
      ink.box(bx, roofY + 1.15, backZ, 2, 2.3, 2.2, wall);
      ink.box(bx, roofY + 2.35, backZ, 2.3, 0.15, 2.5, trim);
      b.dark.quad(bx, roofY + 0.85, backZ + 1.11, 0.9, 1.7, 'pz', '#6a5a7a');
    }
    const floors = Math.round((h - 0.6) / FLOOR);
    if (floors >= 3 && rng.chance(0.3)) this.waterTower(b, rx(), roofY, backZ + rng.range(0, 1.5));
    const acCount = rng.chance(0.5) ? rng.int(1, 3) : 0;
    for (let i = 0; i < acCount; i++) {
      const ax = rx(), az = rzBack();
      ink.box(ax, roofY + 0.4, az, 1.1, 0.8, 0.9, METAL);
      ink.fill.geometry(CYL, mat(ax, roofY + 0.81, az, 0.35, 0.02, 0.35), '#6d6883');
    }
    if (rng.chance(0.18)) {
      const axx = rng.range(usable.x0, usable.x1);
      ink.box(axx, roofY + 2.2, usable.z0 + 0.3, 0.1, 4.4, 0.1, METAL);
      ink.box(axx, roofY + 3.6, usable.z0 + 0.3, 1.4, 0.08, 0.08, METAL);
      ink.box(axx, roofY + 4.1, usable.z0 + 0.3, 0.9, 0.08, 0.08, METAL);
    }
    if (rng.chance(0.4)) {
      // Brick chimney, sometimes smoking
      const chx = rng.chance(0.5) ? usable.x0 : usable.x1;
      const chz = rzBack();
      ink.box(chx, roofY + 0.9, chz, 0.6, 1.8, 0.6, '#c9826e');
      ink.box(chx, roofY + 1.85, chz, 0.75, 0.15, 0.75, '#e1a08a');
      if (rng.chance(0.6)) this.chimneys.push(new THREE.Vector3(chx + this.x0, roofY + 2.0, this.wz(chz)));
    }
    if (w > 4.5 && rng.chance(0.15)) {
      // Solar panels
      const n = Math.floor((usable.x1 - usable.x0) / 1.4);
      const pz = rzBack();
      for (let i = 0; i < Math.min(n, 4); i++) {
        const px = usable.x0 + 0.7 + i * 1.4;
        ink.boxRot(P.set(px, roofY + 0.45, pz), eul.set(-0.5, 0, 0), S.set(1.25, 0.06, 1.0), '#5b6fb0');
        ink.fill.box(px, roofY + 0.2, pz - 0.2, 0.06, 0.4, 0.06, METAL);
      }
    }
    if (rng.chance(0.15)) {
      // Satellite dish angled at the sky
      const sx = rx(), sz = rzBack();
      ink.fill.box(sx, roofY + 0.4, sz, 0.08, 0.8, 0.08, METAL);
      ink.geometry(CONE, matE(sx, roofY + 0.95, sz + 0.1, 0.5, 0.18, 0.5, 2.3), '#eeeaf5');
    }
    if (rng.chance(0.25)) {
      // Skylights
      for (let i = 0; i < rng.int(1, 3); i++) {
        const kx = rx(), kz = rzBack();
        ink.box(kx, roofY + 0.12, kz, 1.1, 0.2, 0.8, trim);
        b.dark.quad(kx, roofY + 0.23, kz, 0.9, 0.6, 'py', '#bcd8ff');
      }
    }

    const garden = rng.chance(0.3);
    if (garden) {
      const n = rng.int(1, 2);
      for (let i = 0; i < n; i++) {
        const tx = rng.range(usable.x0 + 0.8, usable.x1 - 0.8);
        const tz = rng.range(usable.z0 + 0.8, cz + 0.5);
        ink.box(tx, roofY + 0.3, tz, 1.4, 0.6, 1.4, '#b77a64');
        this.tree(rng, b, tx, roofY + 0.6, tz, rng.range(0.5, 0.75));
      }
      if (w > 4) {
        const y0 = roofY + 2.6;
        const pA = new THREE.Vector3(usable.x0, y0, usable.z0 + 0.5);
        const pB = new THREE.Vector3(usable.x1, y0, usable.z1 - 0.3);
        ink.box(pA.x, roofY + 1.3, pA.z, 0.12, 2.6, 0.12, WOOD);
        ink.box(pB.x, roofY + 1.3, pB.z, 0.12, 2.6, 0.12, WOOD);
        this.sagLine(pA, pB, 0.7, b.wires, b.bulbs, 0.09);
      }
    } else if (w > 5.5 && d > 5 && rng.chance(0.12)) {
      // Glass greenhouse
      const gx = rx(), gz = rzBack();
      const gw = Math.min(3, w - 2), gd = 2, gh = 1.6;
      b.glass.box(gx, roofY + gh / 2, gz, gw, gh, gd, '#ffffff');
      for (const fx of [-gw / 2, 0, gw / 2]) ink.fill.box(gx + fx, roofY + gh / 2, gz + gd / 2, 0.06, gh, 0.06, '#f1e5df');
      ink.fill.box(gx, roofY + gh, gz, gw + 0.1, 0.08, gd + 0.1, '#f1e5df');
      for (let k = 0; k < 4; k++) ink.fill.geometry(BLOB, mat(gx - gw / 2 + 0.4 + k * (gw - 0.8) / 3, roofY + 0.35, gz, 0.3, 0.35, 0.3), '#8bc36a');
    }

    if (rng.chance(0.14) && w > 4.5) this.billboard(rng, b, cx, roofY, usable.z0 + 1.2, w);
    if (!garden && rng.chance(0.15)) {
      // Patio umbrella with a table and chairs
      const ux = rx(), uz = rng.range(cz, usable.z1 - 0.8);
      ink.fill.geometry(CYL6, mat(ux, roofY + 1.0, uz, 0.04, 2.0, 0.04), '#4a3a48');
      ink.geometry(CONE8, mat(ux, roofY + 2.05, uz, 1.2, 0.45, 1.2), rng.pick(ACCENTS));
      ink.geometry(CYL, mat(ux, roofY + 0.6, uz, 0.4, 0.05, 0.4), '#fff1d6');
      for (const cxo of [-0.7, 0.7]) ink.box(ux + cxo, roofY + 0.35, uz, 0.4, 0.06, 0.4, WOOD, 0, false);
    }
    if (!garden && rng.chance(0.16) && w > 4) this.laundry(rng, b, usable, roofY, cz);
  }

  /** Glazed tile hip roof with flared, upturned eaves (Chinatown). */
  private pagodaRoof(rng: Rng, b: Builders, cx: number, cz: number, w: number, d: number, y: number) {
    const { ink } = b;
    const tile = rng.pick(this.hood.roofs);
    const tiers = w > 5 && rng.chance(0.4) ? 2 : 1;
    let tw = w + 0.9, td = d + 0.9, ty = y;
    for (let t = 0; t < tiers; t++) {
      // Eave slab, then a square pyramid scaled to the footprint.
      ink.box(cx, ty + 0.1, cz, tw, 0.2, td, '#b8463f');
      ink.surface = Surf.Tiles;
      q.setFromEuler(eul.set(0, Math.PI / 4, 0));
      const r = Math.SQRT1_2;
      ink.geometry(new THREE.ConeGeometry(1, 1, 4), m4.compose(v.set(cx, ty + 0.2 + 0.9, cz), q, s.set((tw / 2) / r, 1.8, (td / 2) / r)), tile);
      ink.surface = Surf.Plain;
      // Upturned corners
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        ink.geometry(CONE8, matE(cx + sx * tw / 2, ty + 0.35, cz + sz * td / 2, 0.14, 0.5, 0.14, sz * 0.5, 0, -sx * 0.5), '#f4c95d');
      }
      // Ridge ornament
      ink.box(cx, ty + 2.05, cz, Math.max(0.4, tw - td), 0.18, 0.18, '#f4c95d');
      if (t === 0 && tiers === 2) {
        ink.box(cx, ty + 1.1, cz, tw * 0.55, 1.6, td * 0.55, '#d9594c');
        tw *= 0.62;
        td *= 0.62;
        ty += 1.9;
      }
    }
    // A hanging lantern at each front corner
    for (const sx of [-1, 1]) b.emissive.geometry(BLOB, mat(cx + sx * (w / 2 + 0.2), y - 0.5, cz + d / 2 + 0.2, 0.2, 0.26, 0.2), '#e8503a');
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

  private tree(rng: Rng, b: Builders, x: number, y: number, z: number, scale: number) {
    const { ink } = b;
    const trunkH = 2.2 * scale;
    ink.surface = Surf.Bark;
    ink.geometry(CYL, mat(x, y + trunkH / 2, z, 0.18 * scale, trunkH, 0.18 * scale), TRUNK);
    ink.surface = Surf.Foliage;
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
    const green = this.hood.name === 'parkland' || this.hood.name === 'garden';
    if (green && w > 5 && d > 5 && rng.chance(0.5)) {
      // Lily pond with a little gazebo
      const px = cx + rng.range(-w / 5, w / 5), pz = cz - d / 5;
      ink.surface = Surf.Stone;
      ink.geometry(CYL, mat(px, 0.32, pz, 1.9, 0.16, 1.4), STONE);
      ink.surface = Surf.Plain;
      b.water.geometry(CYL, mat(px, 0.41, pz, 1.75, 0.02, 1.28), '#ffffff');
      for (let k = 0; k < 5; k++) ink.fill.geometry(CYL8, mat(px + rng.range(-1.2, 1.2), 0.43, pz + rng.range(-0.8, 0.8), 0.2, 0.01, 0.2), '#8bc36a');
      const gx = cx + (px > cx ? -w / 4 : w / 4), gz = cz + d / 5;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ink.box(gx + Math.cos(a) * 1.1, 1.3, gz + Math.sin(a) * 1.1, 0.1, 2.0, 0.1, '#fff1d6', 0, false);
      }
      ink.geometry(CYL8, mat(gx, 0.4, gz, 1.3, 0.2, 1.3), '#e8dcc4');
      ink.surface = Surf.Tiles;
      ink.geometry(CONE8, mat(gx, 2.8, gz, 1.6, 1.1, 1.6), rng.pick(['#57907a', '#b98a6a', '#8a7fd0']));
      ink.surface = Surf.Plain;
    }
    // Gravel paths in a cross
    ink.fill.quad(cx, 0.31, cz, 1.0, d - 0.6, 'py', '#eadccb');
    ink.fill.quad(cx, 0.311, cz, w - 0.6, 1.0, 'py', '#eadccb');
    ink.box(cx, 0.35, cz + d / 2 - 0.3, w - 0.2, 0.3, 0.3, CONCRETE);
    const fountain = rng.chance(0.55) && w > 4.5 && d > 4.5;
    if (fountain) {
      ink.geometry(CYL, mat(cx, 0.55, cz, 1.4, 0.5, 1.4), STONE);
      b.water.geometry(CYL, mat(cx, 0.78, cz, 1.25, 0.02, 1.25), '#ffffff');
      ink.geometry(CYL, mat(cx, 1.1, cz, 0.18, 1.1, 0.18), STONE);
      ink.geometry(CYL, mat(cx, 1.65, cz, 0.6, 0.12, 0.6), STONE);
      this.fountains.push(new THREE.Vector3(cx + this.x0, 1.75, this.wz(cz)));
    }
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      let tx = cx + rng.range(-w / 2 + 1.5, w / 2 - 1.5);
      let tz = cz + rng.range(-d / 2 + 1.5, d / 2 - 1.5);
      if (fountain && Math.hypot(tx - cx, tz - cz) < 2.2) {
        tx = cx + (tx >= cx ? 2.4 : -2.4);
        tz = cz + (tz >= cz ? 2.2 : -2.2);
      }
      this.tree(rng, b, tx, 0.3, tz, rng.range(1.0, 1.4));
    }
    // Benches facing the paths, with lamps
    ink.box(cx + 1.3, 0.75, cz + d / 2 - 1.2, 1.6, 0.12, 0.6, WOOD);
    ink.box(cx + 1.3, 1.1, cz + d / 2 - 1.5, 1.6, 0.5, 0.1, WOOD);
    this.lampPost(b, cx - 0.9, cz + d / 2 - 1.2, 0.3, false);
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

  private stall(rng: Rng, b: Builders, x: number, z: number, sw: number) {
    const { ink } = b;
    const accent = rng.pick(ACCENTS);
    const y = 0.12;
    // Counter
    ink.box(x, y + 0.45, z + 0.3, sw, 0.9, 0.8, WOOD);
    ink.fill.quad(x, y + 0.45, z + 0.71, sw - 0.1, 0.5, 'pz', accent);
    // Produce heaped in crates on the counter
    const crates = Math.max(2, Math.floor(sw / 0.6));
    for (let i = 0; i < crates; i++) {
      const px = x - sw / 2 + (sw / crates) * (i + 0.5);
      ink.box(px, y + 1.0, z + 0.3, sw / crates - 0.08, 0.2, 0.6, '#d9b08a', 0, false);
      const fruit = rng.pick(FRUIT);
      for (let k = 0; k < 5; k++) ink.fill.geometry(BLOB, mat(px + rng.range(-0.15, 0.15), y + 1.15, z + 0.3 + rng.range(-0.2, 0.2), 0.1, 0.1, 0.1), fruit);
    }
    // Posts and a striped canopy
    for (const px of [-sw / 2, sw / 2]) {
      ink.box(x + px, y + 1.1, z - 0.2, 0.08, 2.2, 0.08, WOOD);
      ink.box(x + px, y + 0.95, z + 0.7, 0.08, 1.9, 0.08, WOOD);
    }
    const stripes = Math.max(3, Math.round(sw / 0.4));
    const stw = (sw + 0.3) / stripes;
    for (let i = 0; i < stripes; i++) {
      const px = x - (sw + 0.3) / 2 + stw * (i + 0.5);
      ink.boxRot(P.set(px, y + 2.2, z + 0.25), eul.set(0.3, 0, 0), S.set(stw + 0.005, 0.06, 1.3), i % 2 ? '#fff4e6' : accent, false);
    }
    ink.outline.geometry(BOX1, matE(x, y + 2.2, z + 0.25, sw + 0.46, 0.2, 1.46, 0.3), 0x000000);
    // Hanging lantern
    b.bulbs.geometry(BULB, mat(x, y + 1.85, z + 0.5, 0.12, 0.15, 0.12), '#ffffff');
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

  /** The stretch of curved railway viaduct crossing this chunk (rail.ts). */
  private viaduct(rng: Rng, b: Builders) {
    const { ink } = b;
    const x0 = this.x0;
    const step = 2;
    ink.surface = Surf.Stone;
    for (let lx = 0; lx < CHUNK_W; lx += step) {
      const wx = x0 + lx + step / 2;
      const z = railZ(wx);
      const yaw = railYaw(wx);
      const len = step * Math.sqrt(1 + railSlope(wx) ** 2) + 0.08;
      ink.fill.box(lx + step / 2, RAIL_Y - DECK_H / 2, z, len, DECK_H, 4.8, CONCRETE, yaw);
      ink.fill.box(lx + step / 2, RAIL_Y - DECK_H - 0.05, z, len, 0.12, 4.9, '#8d8398', yaw);
      for (const side of [-1, 1]) {
        const p = trackPoint(wx, side * 2.3);
        ink.fill.box(p.x - x0, RAIL_Y + 0.35, p.z, len, 0.7, 0.2, KERB, yaw);
      }
    }
    ink.surface = Surf.Plain;
    for (let lx = 0; lx < CHUNK_W; lx += step) {
      const wx = x0 + lx + step / 2;
      const yaw = railYaw(wx);
      const len = step * Math.sqrt(1 + railSlope(wx) ** 2) + 0.08;
      for (const t of [-TRACK_OFFSET, TRACK_OFFSET]) {
        for (const r of [-0.36, 0.36]) {
          const p = trackPoint(wx, t + r);
          ink.fill.box(p.x - x0, RAIL_Y + 0.08, p.z, len, 0.12, 0.1, '#8d8398', yaw);
        }
        const sl = trackPoint(wx, t);
        ink.fill.box(sl.x - x0, RAIL_Y + 0.02, sl.z, 0.25, 0.06, 1.3, '#9c7a66', yaw);
      }
    }
    // Pillars (kept off roads and the corridor) and catenary masts.
    const avoid = [CANAL_Z, TRAM_STREET, BUS_STREET, rowFront(4) + STREET / 2, 2 * CANAL_Z - TRAM_STREET, 2 * CANAL_Z - BUS_STREET, 2 * CANAL_Z - rowFront(4) - STREET / 2];
    const first = Math.ceil((x0 - 6) / 12) * 12 + 6;
    for (let wx = first; wx < x0 + CHUNK_W; wx += 12) {
      const z = railZ(wx);
      const lx = wx - x0;
      const yaw = railYaw(wx);
      const clear = avoid.every((a, i) => Math.abs(z - a) > (i === 0 ? 6 : 3.8));
      if (clear) {
        ink.surface = Surf.Stone;
        ink.box(lx, (RAIL_Y - DECK_H) / 2, z, 1.3, RAIL_Y - DECK_H, 1.7, CONCRETE, yaw);
        ink.box(lx, RAIL_Y - DECK_H - 0.5, z, 1.8, 0.7, 3.6, CONCRETE, yaw);
        ink.surface = Surf.Plain;
      }
      for (const side of [-1, 1]) {
        const p = trackPoint(wx, side * 2.45);
        ink.box(p.x - x0, RAIL_Y + 1.9, p.z, 0.14, 3.8, 0.14, '#8d8398', 0, false);
      }
      const a = trackPoint(wx, -2.45), c = trackPoint(wx, 2.45);
      b.wires.push([new THREE.Vector3(a.x - x0, RAIL_Y + 3.6, a.z), new THREE.Vector3(c.x - x0, RAIL_Y + 3.6, c.z)]);
    }
    // Overhead wires along both tracks
    for (const t of [-TRACK_OFFSET, TRACK_OFFSET]) {
      const line: THREE.Vector3[] = [];
      for (let lx = 0; lx <= CHUNK_W + 0.01; lx += 3) {
        const p = trackPoint(x0 + lx, t);
        line.push(new THREE.Vector3(p.x - x0, RAIL_Y + 3.4, p.z));
      }
      b.wires.push(line);
    }
    void rng;
  }

  /** Is the viaduct passing over this footprint (world coords)? Then keep it low. */
  private underRail(lx0: number, lx1: number, lz0: number, lz1: number): boolean {
    const za = this.wz(lz0), zb = this.wz(lz1);
    const zMin = Math.min(za, zb) - 4, zMax = Math.max(za, zb) + 4;
    for (const lx of [lx0, (lx0 + lx1) / 2, lx1]) {
      const z = railZ(this.x0 + lx);
      if (z > zMin && z < zMax) return true;
    }
    return false;
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
    ink.fill.box(x + 1.1, y + 0.8, z, 0.04, 0.9, 0.04, '#4a3a48');
    bulbs.geometry(BULB, mat(x + 1.1, y + 1.28, z, 0.1, 0.13, 0.1), '#ffffff');
  }
}
