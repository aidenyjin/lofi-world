import * as THREE from 'three';

// Accumulates coloured primitives into one BufferGeometry so a whole city
// chunk becomes a handful of draw calls. UVs are in world units / UV_SCALE so
// the tiling brush texture has the same grain on every face.

const UV_SCALE = 7;
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpC = new THREE.Color();
const normalMat = new THREE.Matrix3();
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const rq = new THREE.Quaternion();
const rm = new THREE.Matrix4();
const rs = new THREE.Vector3();

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private surf: number[] = [];
  private anySurf = false;
  /** Surface type for following vertices (see Surf); drives procedural texture detail. */
  surface = 0;
  /** Animation tags: from vertex `start` on, every vertex carries `tag`. */
  private tags: { start: number; tag: number[] }[] = [];

  /**
   * Tag following vertices for the character shader:
   * [bone, pivotX, pivotY, pivotZ, rootX, rootY, rootZ, activity, seed].
   */
  setTag(tag: number[]): this {
    this.tags.push({ start: this.pos.length / 3, tag });
    return this;
  }

  private pushSurf() {
    this.surf.push(this.surface);
    if (this.surface !== 0) this.anySurf = true;
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  /** Axis-aligned box centred at (x, y, z), optionally rotated about Y. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, rotY = 0): this {
    tmpC.set(color);
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    // face: normal, u axis, v axis, u size, v size
    const faces: [number[], number[], number[], number, number][] = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0], d, h],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0], d, h],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1], w, d],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1], w, d],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0], w, h],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0], w, h],
    ];
    for (const [n, u, v, us, vs] of faces) {
      const base = this.pos.length / 3;
      const cx = n[0] * hw, cy = n[1] * hh, cz = n[2] * hd;
      const ux = u[0] * (us / 2), uy = u[1] * (us / 2), uz = u[2] * (us / 2);
      const vx = v[0] * (vs / 2), vy = v[1] * (vs / 2), vz = v[2] * (vs / 2);
      const corners = [
        [-1, -1], [1, -1], [1, 1], [-1, 1],
      ];
      for (const [a, b] of corners) {
        const lx = cx + ux * a + vx * b;
        const ly = cy + uy * a + vy * b;
        const lz = cz + uz * a + vz * b;
        this.pos.push(x + lx * cos + lz * sin, y + ly, z - lx * sin + lz * cos);
        this.nor.push(n[0] * cos + n[2] * sin, n[1], -n[0] * sin + n[2] * cos);
        // World-ish UVs so grain density is constant across faces.
        this.uv.push(((a + 1) / 2) * us / UV_SCALE + x * 0.013, ((b + 1) / 2) * vs / UV_SCALE + y * 0.017 + z * 0.011);
        this.col.push(tmpC.r, tmpC.g, tmpC.b);
        this.pushSurf();
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /** Append any geometry transformed by `m`, flat-coloured. */
  geometry(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation): this {
    tmpC.set(color);
    normalMat.getNormalMatrix(m);
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      tmpV.fromBufferAttribute(p, i).applyMatrix4(m);
      tmpN.fromBufferAttribute(n, i).applyMatrix3(normalMat).normalize();
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      if (uv) this.uv.push(uv.getX(i) * 0.5, uv.getY(i) * 0.5);
      // No UVs (welded blobs): project world position so the brush grain still shows.
      else this.uv.push((tmpV.x + tmpV.z * 0.7) / UV_SCALE, tmpV.y / UV_SCALE);
      this.col.push(tmpC.r, tmpC.g, tmpC.b);
        this.pushSurf();
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    return this;
  }

  /**
   * Axis-aligned quad facing ±X, ±Z or up (py). `uv` optionally maps the quad
   * to a sub-rectangle of a texture atlas as [u0, v0, u1, v1].
   */
  quad(
    x: number, y: number, z: number, w: number, h: number,
    facing: 'px' | 'nx' | 'pz' | 'nz' | 'py', color: THREE.ColorRepresentation,
    uv: [number, number, number, number] = [0, 0, 1, 1],
  ): this {
    tmpC.set(color);
    const base = this.pos.length / 3;
    const hw = w / 2, hh = h / 2;
    let n: [number, number, number];
    let corners: [number, number, number][];
    switch (facing) {
      case 'pz':
        n = [0, 0, 1];
        corners = [[x - hw, y - hh, z], [x + hw, y - hh, z], [x + hw, y + hh, z], [x - hw, y + hh, z]];
        break;
      case 'nz':
        n = [0, 0, -1];
        corners = [[x + hw, y - hh, z], [x - hw, y - hh, z], [x - hw, y + hh, z], [x + hw, y + hh, z]];
        break;
      case 'px':
        n = [1, 0, 0];
        corners = [[x, y - hh, z + hw], [x, y - hh, z - hw], [x, y + hh, z - hw], [x, y + hh, z + hw]];
        break;
      case 'nx':
        n = [-1, 0, 0];
        corners = [[x, y - hh, z - hw], [x, y - hh, z + hw], [x, y + hh, z + hw], [x, y + hh, z - hw]];
        break;
      case 'py':
        // w along X, h along Z (h grows toward -Z so the texture reads upright from the camera).
        n = [0, 1, 0];
        corners = [[x - hw, y, z + hh], [x + hw, y, z + hh], [x + hw, y, z - hh], [x - hw, y, z - hh]];
        break;
    }
    const [u0, v0, u1, v1] = uv;
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    corners.forEach((c, i) => {
      this.pos.push(c[0], c[1], c[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(tmpC.r, tmpC.g, tmpC.b);
        this.pushSurf();
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  /** Single double-sided-friendly triangle; `uvx` per vertex (used for flag sway). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.ColorRepresentation, uvx: [number, number, number] = [0, 0, 0]): this {
    tmpC.set(color);
    const base = this.pos.length / 3;
    tmpN.subVectors(b, a).cross(tmpV.subVectors(c, a)).normalize();
    [a, b, c].forEach((p, i) => {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      this.uv.push(uvx[i], 0);
      this.col.push(tmpC.r, tmpC.g, tmpC.b);
        this.pushSurf();
    });
    this.idx.push(base, base + 1, base + 2);
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.anySurf) g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 1));
    if (this.tags.length) {
      const n = this.pos.length / 3;
      const bone = new Float32Array(n);
      const pivot = new Float32Array(n * 3);
      const root = new Float32Array(n * 3);
      const anim = new Float32Array(n * 2);
      this.tags.forEach((r, i) => {
        const end = i + 1 < this.tags.length ? this.tags[i + 1].start : n;
        const t = r.tag;
        for (let k = r.start; k < end; k++) {
          bone[k] = t[0];
          pivot.set([t[1], t[2], t[3]], k * 3);
          root.set([t[4], t[5], t[6]], k * 3);
          anim.set([t[7], t[8]], k * 2);
        }
      });
      g.setAttribute('aBone', new THREE.BufferAttribute(bone, 1));
      g.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3));
      g.setAttribute('aRoot', new THREE.BufferAttribute(root, 3));
      g.setAttribute('aAnim', new THREE.BufferAttribute(anim, 2));
    }
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Fill + ink-outline pair. Outlines use the inverted-hull trick: the same
 * shapes slightly inflated, drawn back-faces only in ink colour.
 */
export class InkedBuilder {
  readonly fill = new GeoBuilder();
  readonly outline = new GeoBuilder();

  constructor(private thickness = 0.09) {}

  /** Surface type for the fill (outlines are plain ink). */
  set surface(v: number) {
    this.fill.surface = v;
  }
  get surface(): number {
    return this.fill.surface;
  }

  setTag(tag: number[]): this {
    this.fill.setTag(tag);
    this.outline.setTag(tag);
    return this;
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, rotY = 0, ink = true): this {
    this.fill.box(x, y, z, w, h, d, color, rotY);
    if (ink) {
      const t = this.thickness * 2;
      this.outline.box(x, y, z, w + t, h + t, d + t, 0x000000, rotY);
    }
    return this;
  }

  /** Arbitrarily rotated box (arches, awnings, solar panels). */
  boxRot(pos: THREE.Vector3, rot: THREE.Euler, size: THREE.Vector3, color: THREE.ColorRepresentation, ink = true): this {
    rq.setFromEuler(rot);
    this.fill.geometry(UNIT_BOX, rm.compose(pos, rq, size), color);
    if (ink) {
      const t = this.thickness * 2;
      this.outline.geometry(UNIT_BOX, rm.compose(pos, rq, rs.set(size.x + t, size.y + t, size.z + t)), 0x000000);
    }
    return this;
  }

  /** Smooth shapes: inflate along normals for the hull. */
  geometry(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, ink = true): this {
    this.fill.geometry(geo, m, color);
    if (ink) {
      const inflated = geo.clone();
      const p = inflated.getAttribute('position') as THREE.BufferAttribute;
      const n = inflated.getAttribute('normal') as THREE.BufferAttribute;
      // Normals are in local space, so compensate for the matrix scale.
      const s = new THREE.Vector3().setFromMatrixScale(m);
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(
          i,
          p.getX(i) + (n.getX(i) * this.thickness) / s.x,
          p.getY(i) + (n.getY(i) * this.thickness) / s.y,
          p.getZ(i) + (n.getZ(i) * this.thickness) / s.z,
        );
      }
      this.outline.geometry(inflated, m, 0x000000);
      inflated.dispose();
    }
    return this;
  }
}
