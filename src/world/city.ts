import * as THREE from 'three';
import { Rng, hashSeed } from '../rng';
import { WALLS, TRIM, ROOF, FOLIAGE } from '../palette';
import { GeoBuilder, InkedBuilder } from './geo';
import type { Materials } from './materials';
import { characterTexture, signTexture, SPECIES, POSES, type Pose } from './textures';

// The city is generated in chunks along +X (the direction the camera drifts).
// Each chunk is a strip of city blocks receding into the distance, with the
// elevated train line running between the middle rows.

export const CHUNK_W = 36;
export const TRAIN_Z = -79.5;
export const TRAIN_Y = 15;

const BLOCK_DEPTH = 16;
const STREET = 5;
const ROWS = 5;
// Taller toward the back so the city climbs toward the skyline.
const ROW_HEIGHTS: [number, number][] = [
  [3, 7], [5, 11], [7, 13], [8, 16], [12, 26],
];
const FLOOR = 2.6;

const RUST = '#b86f62';
const WOOD = '#c08f6c';
const METAL = '#b9b3cc';
const CONCRETE = '#cbbfd4';
const TRUNK = '#7b5a57';

// Shared unit geometries, reused for every instance via matrices.
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const CONE = new THREE.ConeGeometry(1, 1, 14);
const BLOB = new THREE.IcosahedronGeometry(1, 1);
const BULB = new THREE.IcosahedronGeometry(1, 0);
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

function mat(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0): THREE.Matrix4 {
  q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
  return m4.compose(v.set(x, y, z), q, s.set(sx, sy, sz));
}

export interface Resident {
  sprite: THREE.Sprite;
  baseScale: THREE.Vector2;
  phase: number;
  bounce: number; // how much this one grooves (readers bob less)
}

export interface TreeSpot {
  x: number;
  y: number;
  z: number;
}

export class CityChunk {
  readonly group = new THREE.Group();
  readonly residents: Resident[] = [];
  readonly trees: TreeSpot[] = [];
  private disposables: { dispose(): void }[] = [];
  private tracked: (THREE.Material & { color: THREE.Color })[] = [];

  constructor(
    readonly index: number,
    private worldSeed: number,
    private mats: Materials,
  ) {
    this.group.position.x = index * CHUNK_W;
    this.generate();
  }

  private generate() {
    const rng = new Rng(hashSeed(this.worldSeed, this.index, 0x51));
    const ink = new InkedBuilder(0.08);
    const lit = new GeoBuilder();
    const dark = new GeoBuilder();
    const bulbs = new GeoBuilder();
    const wires: THREE.Vector3[][] = [];

    // Ground (street level) for this strip.
    ink.fill.box(CHUNK_W / 2, -0.25, -45, CHUNK_W + 0.02, 0.5, 130, '#d7c3cc');

    for (let row = 0; row < ROWS; row++) {
      const zFront = 2 - row * (BLOCK_DEPTH + STREET);
      // Cross street at the start of each chunk, lots fill the rest.
      let x = 4;
      while (x < CHUNK_W - 2.5) {
        const w = Math.min(rng.range(4.5, 9), CHUNK_W - x);
        if (w < 3) break;
        const split = rng.chance(0.45);
        const depths = split ? [rng.range(6, 9)] : [BLOCK_DEPTH];
        if (split) depths.push(BLOCK_DEPTH - depths[0]);
        let z = zFront;
        for (const d of depths) {
          const lotCx = x + w / 2;
          const lotCz = z - d / 2;
          if (rng.chance(row < 3 ? 0.08 : 0.03)) {
            this.park(rng, ink, lotCx, lotCz, w, d);
          } else {
            this.building(rng, ink, lit, dark, bulbs, wires, row, lotCx, lotCz, w - rng.range(0.1, 0.6), d - rng.range(0.1, 0.5));
          }
          z -= d;
        }
        x += w;
      }
      // Street trees along the near kerb of each street.
      const streetZ = zFront + STREET / 2;
      if (row > 0) {
        for (let tx = 5; tx < CHUNK_W - 2; tx += rng.range(6, 11)) {
          if (rng.chance(0.55)) this.tree(rng, ink, tx, 0, streetZ + rng.range(-1.2, 1.2), rng.range(0.9, 1.3));
        }
      }
    }

    this.powerLines(rng, ink, wires);
    this.trainLine(rng, ink);

    this.addMesh(ink.fill.build(), this.mats.toon, true);
    this.addMesh(ink.outline.build(), this.mats.ink, false);
    if (!lit.empty) this.addMesh(lit.build(), this.mats.windowLit, false);
    if (!dark.empty) this.addMesh(dark.build(), this.mats.windowDark, false);
    if (!bulbs.empty) this.addMesh(bulbs.build(), this.mats.bulb, false);
    if (wires.length) {
      const segs: number[] = [];
      for (const line of wires) {
        for (let i = 0; i < line.length - 1; i++) {
          segs.push(line[i].x, line[i].y, line[i].z, line[i + 1].x, line[i + 1].y, line[i + 1].z);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      this.disposables.push(g);
      this.group.add(new THREE.LineSegments(g, this.mats.wire));
    }
  }

  private addMesh(geo: THREE.BufferGeometry, material: THREE.Material, shadows: boolean) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.disposables.push(geo);
  }

  // -------------------------------------------------------------------------

  private building(
    rng: Rng, ink: InkedBuilder, lit: GeoBuilder, dark: GeoBuilder, bulbs: GeoBuilder,
    wires: THREE.Vector3[][], row: number, cx: number, cz: number, w: number, d: number,
  ) {
    const [hMin, hMax] = ROW_HEIGHTS[row];
    const floors = Math.max(1, Math.round(rng.range(hMin, hMax) / FLOOR));
    const h = floors * FLOOR + 0.6;
    const wall = rng.pick(WALLS);
    const trim = rng.pick(TRIM);
    const roof = rng.pick(ROOF);
    const front = cz + d / 2;

    ink.box(cx, h / 2, cz, w, h, d, wall);
    // Cornice + parapet
    ink.box(cx, h - 0.15, cz, w + 0.35, 0.35, d + 0.35, trim);
    const pt = 0.28;
    const ph = 0.55;
    ink.fill.box(cx, h + 0.02, cz, w - 0.2, 0.06, d - 0.2, roof);
    ink.box(cx, h + ph / 2, front - pt / 2, w, ph, pt, wall);
    ink.box(cx, h + ph / 2, cz - d / 2 + pt / 2, w, ph, pt, wall);
    ink.box(cx - w / 2 + pt / 2, h + ph / 2, cz, pt, ph, d - 2 * pt, wall);
    ink.box(cx + w / 2 - pt / 2, h + ph / 2, cz, pt, ph, d - 2 * pt, wall);

    this.windows(rng, ink, lit, dark, cx, cz, w, d, floors, trim);

    if (floors >= 3 && rng.chance(0.3)) this.fireEscape(rng, ink, cx, front, w, floors);

    // Rooftop: pick a handful of features, keeping the front strip for people.
    const roofY = h + 0.05;
    const usable = { x0: cx - w / 2 + 0.7, x1: cx + w / 2 - 0.7, z0: cz - d / 2 + 0.7, z1: front - 0.7 };
    const backZ = usable.z0 + 1.4;

    if (rng.chance(0.4)) {
      // Stair bulkhead with a door facing the camera.
      const bx = rng.range(usable.x0 + 1, usable.x1 - 1);
      ink.box(bx, roofY + 1.15, backZ, 2, 2.3, 2.2, wall);
      ink.box(bx, roofY + 2.35, backZ, 2.3, 0.15, 2.5, trim);
      dark.quad(bx, roofY + 0.85, backZ + 1.11, 0.9, 1.7, 'pz', '#6a5a7a');
    }
    if (floors >= 3 && rng.chance(0.3)) this.waterTower(ink, rng.range(usable.x0 + 1.2, usable.x1 - 1.2), roofY, backZ + rng.range(0, 1.5));
    const acCount = rng.chance(0.55) ? rng.int(1, 3) : 0;
    for (let i = 0; i < acCount; i++) {
      const ax = rng.range(usable.x0 + 0.5, usable.x1 - 0.5);
      const az = rng.range(usable.z0 + 0.5, cz);
      ink.box(ax, roofY + 0.4, az, 1.1, 0.8, 0.9, METAL);
      ink.fill.geometry(CYL, mat(ax, roofY + 0.81, az, 0.35, 0.02, 0.35), '#6d6883');
    }
    if (rng.chance(0.2)) {
      const axx = rng.range(usable.x0, usable.x1);
      ink.box(axx, roofY + 2.2, usable.z0 + 0.3, 0.1, 4.4, 0.1, METAL);
      ink.box(axx, roofY + 3.6, usable.z0 + 0.3, 1.4, 0.08, 0.08, METAL);
      ink.box(axx, roofY + 4.1, usable.z0 + 0.3, 0.9, 0.08, 0.08, METAL);
    }

    const garden = rng.chance(0.28);
    if (garden) {
      const n = rng.int(1, 2);
      for (let i = 0; i < n; i++) {
        const tx = rng.range(usable.x0 + 0.8, usable.x1 - 0.8);
        const tz = rng.range(usable.z0 + 0.8, cz + 0.5);
        ink.box(tx, roofY + 0.3, tz, 1.4, 0.6, 1.4, '#b77a64');
        this.tree(rng, ink, tx, roofY + 0.6, tz, rng.range(0.5, 0.75));
      }
      if (w > 4) {
        // String lights zig-zagging over the roof.
        const y0 = roofY + 2.6;
        const pA = new THREE.Vector3(usable.x0, y0, usable.z0 + 0.5);
        const pB = new THREE.Vector3(usable.x1, y0, usable.z1 - 0.3);
        ink.box(pA.x, roofY + 1.3, pA.z, 0.12, 2.6, 0.12, WOOD);
        ink.box(pB.x, roofY + 1.3, pB.z, 0.12, 2.6, 0.12, WOOD);
        this.sagLine(pA, pB, 0.7, wires, bulbs, 0.09);
      }
    }

    if (rng.chance(0.14) && w > 4.5) this.billboard(rng, ink, cx, roofY, usable.z0 + 1.2, w);
    if (!garden && rng.chance(0.18) && w > 4) {
      // Laundry line
      const y0 = roofY + 1.9;
      const pA = new THREE.Vector3(usable.x0 + 0.2, y0, cz);
      const pB = new THREE.Vector3(usable.x1 - 0.2, y0, cz);
      ink.box(pA.x, roofY + 0.95, pA.z, 0.1, 1.9, 0.1, WOOD);
      ink.box(pB.x, roofY + 0.95, pB.z, 0.1, 1.9, 0.1, WOOD);
      this.sagLine(pA, pB, 0.35, wires);
      const cloths = ['#ffffff', '#f2a7c3', '#8fb8ea', '#f5d489', '#a9d7c2'];
      for (let lx = pA.x + 0.6; lx < pB.x - 0.6; lx += rng.range(0.7, 1.2)) {
        const t = (lx - pA.x) / (pB.x - pA.x);
        const sag = Math.sin(t * Math.PI) * 0.35;
        const cw = rng.range(0.4, 0.7);
        const ch = rng.range(0.5, 0.9);
        ink.box(lx, y0 - sag - ch / 2, cz, cw, ch, 0.04, rng.pick(cloths));
      }
    }

    // Residents
    if (rng.chance(row <= 2 ? 0.42 : 0.2)) {
      const count = rng.chance(0.3) ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const px = rng.range(usable.x0 + 0.4, usable.x1 - 0.4);
        const pz = usable.z1 - rng.range(0, 1.2);
        this.resident(rng, px, roofY, pz, ink);
      }
    }
  }

  private windows(
    rng: Rng, ink: InkedBuilder, lit: GeoBuilder, dark: GeoBuilder,
    cx: number, cz: number, w: number, d: number, floors: number, trim: string,
  ) {
    const litChance = rng.range(0.25, 0.6);
    const ww = 0.85;
    const wh = 1.25;
    const place = (facing: 'pz' | 'px' | 'nx', span: number) => {
      const cols = Math.max(1, Math.floor((span - 0.8) / 1.9));
      const gap = span / cols;
      for (let f = 0; f < floors; f++) {
        const y = f * FLOOR + 1.55;
        for (let c = 0; c < cols; c++) {
          if (rng.chance(0.08)) continue;
          const o = -span / 2 + gap * (c + 0.5);
          const target = rng.chance(litChance) ? lit : dark;
          const glass = rng.chance(0.5) ? '#ffffff' : '#e8e0ff';
          if (facing === 'pz') {
            const z = cz + d / 2;
            ink.fill.quad(cx + o, y, z + 0.02, ww + 0.3, wh + 0.3, 'pz', trim);
            target.quad(cx + o, y + 0.02, z + 0.04, ww, wh, 'pz', glass);
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
    place('px', d);
    place('nx', d);
  }

  private fireEscape(rng: Rng, ink: InkedBuilder, cx: number, front: number, w: number, floors: number) {
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
        // Diagonal ladder between landings.
        ink.box(fx + fw * 0.15, y + FLOOR / 2, front + 0.55, 0.12, FLOOR * 1.08, 0.4, RUST, 0, false);
      }
    }
  }

  private waterTower(ink: InkedBuilder, x: number, y: number, z: number) {
    const legH = 1.6;
    for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      ink.box(x + lx, y + legH / 2, z + lz, 0.14, legH, 0.14, TRUNK);
    }
    ink.box(x, y + legH, z, 1.9, 0.12, 1.9, TRUNK);
    ink.geometry(CYL, mat(x, y + legH + 1.2, z, 1.05, 2.3, 1.05), WOOD);
    ink.geometry(CONE, mat(x, y + legH + 2.75, z, 1.2, 0.8, 1.2), '#9c6f5a');
    // Hoops
    for (const hy of [0.5, 1.4]) {
      ink.fill.geometry(CYL, mat(x, y + legH + hy, z, 1.08, 0.06, 1.08), '#7a5850');
    }
  }

  private billboard(rng: Rng, ink: InkedBuilder, cx: number, y: number, z: number, w: number) {
    const { tex, aspect } = signTexture(rng);
    const bw = Math.min(w - 1, aspect > 1.5 ? 5.5 : 2.6);
    const bh = bw / aspect;
    const lift = 1.1;
    ink.box(cx - bw * 0.35, y + lift / 2, z, 0.14, lift, 0.14, METAL);
    ink.box(cx + bw * 0.35, y + lift / 2, z, 0.14, lift, 0.14, METAL);
    ink.box(cx, y + lift + bh / 2, z - 0.1, bw + 0.2, bh + 0.2, 0.15, '#6b5c78');
    const matl = this.mats.track(new THREE.MeshBasicMaterial({ map: tex }));
    this.tracked.push(matl);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), matl);
    plane.position.set(cx, y + lift + bh / 2, z + 0.0);
    this.group.add(plane);
    this.disposables.push(plane.geometry, tex, matl);
  }

  private tree(rng: Rng, ink: InkedBuilder, x: number, y: number, z: number, scale: number) {
    const trunkH = 2.2 * scale;
    ink.geometry(CYL, mat(x, y + trunkH / 2, z, 0.18 * scale, trunkH, 0.18 * scale), TRUNK);
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
    this.trees.push({ x: x + this.group.position.x, y: y + trunkH + scale, z });
  }

  private park(rng: Rng, ink: InkedBuilder, cx: number, cz: number, w: number, d: number) {
    ink.fill.box(cx, 0.15, cz, w - 0.4, 0.3, d - 0.4, '#b9d8a8');
    ink.box(cx, 0.35, cz, w - 0.2, 0.3, 0.3, CONCRETE);
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      this.tree(rng, ink, cx + rng.range(-w / 2 + 1.5, w / 2 - 1.5), 0.3, cz + rng.range(-d / 2 + 1.5, d / 2 - 1.5), rng.range(1.1, 1.5));
    }
    // Bench
    ink.box(cx, 0.75, cz + d / 2 - 1.2, 2, 0.12, 0.6, WOOD);
    ink.box(cx, 1.1, cz + d / 2 - 1.5, 2, 0.5, 0.1, WOOD);
    if (rng.chance(0.6)) this.resident(rng, cx + rng.range(-0.6, 0.6), 0.3, cz + d / 2 - 0.9, ink, 'sit');
  }

  private resident(rng: Rng, x: number, y: number, z: number, ink: InkedBuilder, forcePose?: Pose) {
    const species = rng.pick(SPECIES);
    const pose = forcePose ?? rng.pick(POSES);
    const tex = characterTexture(species, pose, rng.int(0, 6));
    const sprite = new THREE.Sprite(this.mats.spriteMaterial(tex));
    const height = pose === 'stand' || pose === 'paint' ? 3.3 : 2.8;
    const scale = new THREE.Vector2(height * (256 / 320), height);
    sprite.center.set(0.5, 0.02);
    sprite.position.set(x, y, z);
    sprite.scale.set(scale.x, scale.y, 1);
    this.group.add(sprite);
    this.residents.push({ sprite, baseScale: scale, phase: rng.range(0, Math.PI * 2), bounce: pose === 'read' ? 0.4 : 1 });

    if (pose === 'paint') {
      // Easel beside the painter.
      const ex = x + 1.1;
      ink.box(ex - 0.3, y + 0.8, z - 0.1, 0.07, 1.6, 0.07, WOOD, 0.3);
      ink.box(ex + 0.3, y + 0.8, z - 0.1, 0.07, 1.6, 0.07, WOOD, -0.3);
      ink.box(ex, y + 1.35, z, 0.9, 0.75, 0.06, '#9fd1f0');
    }

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), this.mats.blobShadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, y + 0.03, z);
    this.group.add(shadow);
    this.disposables.push(shadow.geometry);
  }

  private sagLine(a: THREE.Vector3, b: THREE.Vector3, sag: number, wires: THREE.Vector3[][], bulbs?: GeoBuilder, bulbSize = 0.08) {
    const pts: THREE.Vector3[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      pts.push(p);
      if (bulbs && i > 0 && i < n) bulbs.geometry(BULB, mat(p.x, p.y - 0.08, p.z, bulbSize, bulbSize * 1.3, bulbSize), '#ffffff');
    }
    wires.push(pts);
  }

  private powerLines(rng: Rng, ink: InkedBuilder, wires: THREE.Vector3[][]) {
    // Utility poles along the street between rows 1 and 2, wires between chunks
    // line up because poles sit at fixed offsets.
    const z = 2 - 2 * (BLOCK_DEPTH + STREET) + STREET * 0.5 + 0.8;
    const poleH = 13;
    const xs = [0, CHUNK_W / 2, CHUNK_W];
    for (const px of xs.slice(0, 2)) {
      ink.box(px + 0.5, poleH / 2, z, 0.3, poleH, 0.3, TRUNK);
      ink.box(px + 0.5, poleH - 0.6, z, 2.4, 0.18, 0.18, TRUNK);
    }
    for (let i = 0; i < xs.length - 1; i++) {
      for (const off of [-1, 0, 1]) {
        const a = new THREE.Vector3(xs[i] + 0.5 + off * 1.0, poleH - 0.5, z);
        const b = new THREE.Vector3(xs[i + 1] + 0.5 + off * 1.0, poleH - 0.5, z);
        this.sagLine(a, b, 0.9 + rng.range(-0.1, 0.1), wires);
      }
    }
  }

  private trainLine(rng: Rng, ink: InkedBuilder) {
    const deckH = 1.3;
    ink.box(CHUNK_W / 2, TRAIN_Y - deckH / 2, TRAIN_Z, CHUNK_W + 0.02, deckH, 4.2, CONCRETE, 0, false);
    // Outline only the long edges so neighbouring chunks join seamlessly.
    ink.outline.box(CHUNK_W / 2, TRAIN_Y - deckH / 2, TRAIN_Z, CHUNK_W + 0.02, deckH + 0.16, 4.36, 0x000000);
    for (let px = 6; px < CHUNK_W; px += 12) {
      ink.box(px, (TRAIN_Y - deckH) / 2, TRAIN_Z, 1.2, TRAIN_Y - deckH, 1.2, CONCRETE);
    }
    ink.box(CHUNK_W / 2, TRAIN_Y + 0.08, TRAIN_Z - 0.7, CHUNK_W + 0.02, 0.16, 0.14, '#8d8398', 0, false);
    ink.box(CHUNK_W / 2, TRAIN_Y + 0.08, TRAIN_Z + 0.7, CHUNK_W + 0.02, 0.16, 0.14, '#8d8398', 0, false);
    if (rng.chance(0.5)) {
      // A splash of graffiti colour on the deck face.
      const gx = rng.range(6, CHUNK_W - 6);
      ink.fill.quad(gx, TRAIN_Y - deckH / 2, TRAIN_Z + 2.12, rng.range(4, 8), deckH * 0.8, 'pz', rng.pick(['#f2a7c3', '#9fc7ef', '#f5d489', '#a9d7c2']));
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const m of this.tracked) this.mats.untrack(m);
    this.group.removeFromParent();
  }
}
