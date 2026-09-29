import * as THREE from 'three';
import { InkedBuilder, GeoBuilder } from './geo';
import type { Materials } from './materials';
import { buildBoat, buildCar, CANAL_Z, TRAFFIC_STREETS, WATER_Y } from './city';
import { puffTexture } from './textures';
import { buildCharacter, Act } from './characters';
import { Rng } from '../rng';

// Things that move on their own: traffic, boats, birds, smoke, spray and
// fireflies. Each keeps a fixed pool of objects recycled around the camera,
// so nothing is created or destroyed while the world scrolls.

const SPAN_BEHIND = 70;
const SPAN_AHEAD = 90;

function meshesFrom(ink: InkedBuilder, lights: GeoBuilder | null, mats: Materials): THREE.Group {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(ink.fill.build(), mats.toon);
  fill.castShadow = true;
  g.add(fill, new THREE.Mesh(ink.outline.build(), mats.ink));
  if (lights && !lights.empty) g.add(new THREE.Mesh(lights.build(), mats.bulb));
  return g;
}

// ---------------------------------------------------------------------------

interface Mover {
  obj: THREE.Group;
  x: number;
  speed: number;
  dir: 1 | -1;
  phase: number;
}

/** Cars driving both ways along the two middle streets, headlights on. */
export class Traffic {
  readonly group = new THREE.Group();
  private cars: Mover[] = [];

  constructor(mats: Materials) {
    const colors = ['#f0a497', '#a9c9f0', '#f8dea0', '#bde2d0', '#c8b5e6', '#fff1d6', '#e9786f'];
    let i = 0;
    for (const streetZ of TRAFFIC_STREETS) {
      for (const dir of [1, -1] as const) {
        for (let k = 0; k < 3; k++) {
          const ink = new InkedBuilder(0.07);
          const lights = new GeoBuilder();
          buildCar(ink, lights, 0, 0.01, 0, 0, colors[i++ % colors.length], Math.random() < 0.25);
          const obj = meshesFrom(ink, lights, mats);
          obj.rotation.y = dir === 1 ? 0 : Math.PI;
          obj.position.z = streetZ + (dir === 1 ? 0.8 : -0.8);
          this.group.add(obj);
          this.cars.push({ obj, x: (k / 3) * (SPAN_AHEAD + SPAN_BEHIND) - SPAN_BEHIND + Math.random() * 20, speed: 3 + Math.random() * 3, dir, phase: Math.random() * 10 });
        }
      }
    }
  }

  update(dt: number, camX: number, time: number) {
    for (const c of this.cars) {
      c.x += c.speed * c.dir * dt;
      const rel = c.x - camX;
      if (rel > SPAN_AHEAD) c.x = camX - SPAN_BEHIND;
      if (rel < -SPAN_BEHIND) c.x = camX + SPAN_AHEAD;
      c.obj.position.x = c.x;
      // A little suspension bounce
      c.obj.position.y = Math.abs(Math.sin(time * 9 + c.phase)) * 0.025;
    }
  }
}

/** Rowing boats drifting along the canal, some with a passenger. */
export class Boats {
  readonly group = new THREE.Group();
  private boats: Mover[] = [];

  constructor(mats: Materials) {
    const colors = ['#e9786f', '#6fa7e0', '#57b39a', '#f6b94f'];
    for (let i = 0; i < 4; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const ink = new InkedBuilder(0.07);
      const lights = new GeoBuilder();
      buildBoat(ink, lights, 0, 0, colors[i], i === 1, 0);
      const obj = meshesFrom(ink, lights, mats);
      obj.position.set(0, WATER_Y, CANAL_Z + (dir === 1 ? 0.7 : -0.7));
      if (i !== 1) {
        // A rower, animated by the same rig as the rooftop residents.
        const who = new InkedBuilder(0.045);
        buildCharacter(who, new Rng(31 + i * 7), -0.2, 0.3, 0, { pose: 'sit', act: Act.Row, scale: 1.0, yaw: dir === 1 ? 0.2 : -0.2 });
        obj.add(new THREE.Mesh(who.fill.build(), mats.charToon), new THREE.Mesh(who.outline.build(), mats.charInk));
      }
      this.group.add(obj);
      this.boats.push({ obj, x: (i / 4) * (SPAN_AHEAD + SPAN_BEHIND) - SPAN_BEHIND, speed: 1.2 + Math.random() * 0.8, dir: dir as 1 | -1, phase: Math.random() * 6 });
    }
  }

  update(dt: number, camX: number, time: number, beatPulse: number) {
    for (const b of this.boats) {
      b.x += b.speed * b.dir * dt;
      const rel = b.x - camX;
      if (rel > SPAN_AHEAD) b.x = camX - SPAN_BEHIND;
      if (rel < -SPAN_BEHIND) b.x = camX + SPAN_AHEAD;
      b.obj.position.x = b.x;
      b.obj.position.y = WATER_Y + Math.sin(time * 1.6 + b.phase) * 0.05 + beatPulse * 0.02;
      b.obj.rotation.z = Math.sin(time * 1.2 + b.phase) * 0.03;
      b.obj.rotation.x = Math.sin(time * 0.9 + b.phase * 2) * 0.03;
    }
  }
}

// ---------------------------------------------------------------------------

const BIRDS_PER_FLOCK = 9;

/**
 * Two flocks of little ink birds circling the rooftops. A section change
 * startles them into a wide sweep; wings beat twice per musical beat.
 */
export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private flocks = [
    { cx: 0, cy: 24, cz: -32, r: 14, speed: 0.25, phase: 0, excite: 0 },
    { cx: 30, cy: 30, cz: -55, r: 20, speed: -0.18, phase: 2, excite: 0 },
  ];
  private offsets: THREE.Vector3[] = [];
  private dummy = new THREE.Object3D();

  constructor(mats: Materials) {
    // A flat 'V' of two wings.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.1, -0.7, 0.25, -0.1, 0, 0, -0.15,
      0, 0, 0.1, 0, 0, -0.15, 0.7, 0.25, -0.1,
    ], 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: mats.ink.color, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(g, mat, BIRDS_PER_FLOCK * this.flocks.length);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.mesh.count; i++) {
      this.offsets.push(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 6));
    }
  }

  startle() {
    for (const f of this.flocks) f.excite = 1;
  }

  update(dt: number, camX: number, time: number, beatSeconds: number, inkColor: THREE.Color) {
    (this.mesh.material as THREE.MeshBasicMaterial).color.copy(inkColor);
    const flapRate = (Math.PI * 2 * 2) / Math.max(0.3, beatSeconds);
    let i = 0;
    for (const f of this.flocks) {
      f.excite *= Math.exp(-dt * 0.35);
      f.phase += f.speed * (1 + f.excite * 3) * dt;
      const r = f.r * (1 + f.excite * 1.5);
      const cx = camX + f.cx + Math.sin(time * 0.05) * 10;
      for (let k = 0; k < BIRDS_PER_FLOCK; k++, i++) {
        const o = this.offsets[i];
        const a = f.phase + k * 0.12;
        const x = cx + Math.cos(a) * r + o.x;
        const z = f.cz + Math.sin(a) * r * 0.5 + o.z;
        const y = f.cy + o.y + Math.sin(time * 0.7 + k) * 0.8 + f.excite * 6;
        this.dummy.position.set(x, y, z);
        // Face along the circle
        this.dummy.rotation.set(0, -a - (f.speed > 0 ? 0 : Math.PI), 0);
        const flap = Math.sin(time * flapRate + k * 0.7);
        this.dummy.scale.set(0.9, 0.3 + flap * 0.9, 0.9);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------

const MAX_PARTICLES = 700;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  kind: 0 | 1; // 0 smoke, 1 spray
  size: number;
}

/** Chimney smoke and fountain spray, drawn as soft painted puffs. */
export class Particles {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private alpha = new Float32Array(MAX_PARTICLES);
  private size = new Float32Array(MAX_PARTICLES);
  private tint = new Float32Array(MAX_PARTICLES * 3);
  private carry = new Map<string, number>();
  private burst = 0;
  private uniforms = { map: { value: puffTexture() as THREE.Texture }, uScale: { value: 400 } };

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(this.tint, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.uniforms]),
      fog: true,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        attribute vec3 aTint;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vTint;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = aAlpha;
          vTint = aTint;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying float vAlpha;
        varying vec3 vTint;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vTint, t.a * vAlpha);
          if (gl_FragColor.a < 0.01) discard;
          #include <fog_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    mat.uniforms.map.value = this.uniforms.map.value;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.uniforms = mat.uniforms as typeof this.uniforms;
  }

  /** Fountains leap on the kick. */
  kick() {
    this.burst = 1;
  }

  private spawn(p: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'z' | 'kind' | 'max'>) {
    if (this.parts.length >= MAX_PARTICLES) return;
    this.parts.push({ vx: 0, vy: 0, vz: 0, life: 0, size: 1, ...p });
  }

  update(dt: number, camX: number, chimneys: THREE.Vector3[], fountains: THREE.Vector3[], wind: number, night: number, haze: THREE.Color, height: number) {
    this.uniforms.uScale.value = height * 0.5;
    for (const c of chimneys) {
      if (c.x < camX - 60 || c.x > camX + 80) continue;
      const key = `c${c.x.toFixed(1)},${c.z.toFixed(1)}`;
      let acc = (this.carry.get(key) ?? Math.random()) + dt * 1.1;
      while (acc >= 1) {
        acc -= 1;
        this.spawn({ x: c.x + (Math.random() - 0.5) * 0.3, y: c.y, z: c.z, vx: 0.2, vy: 0.7 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.1, kind: 0, max: 5 + Math.random() * 2, size: 1.2 });
      }
      this.carry.set(key, acc);
    }
    const burst = this.burst;
    this.burst = 0;
    for (const f of fountains) {
      if (f.x < camX - 50 || f.x > camX + 70) continue;
      const n = Math.random() < dt * 30 ? 1 : 0;
      for (let i = 0; i < n + Math.round(burst * 10); i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.4 + Math.random() * 0.6 + burst * 0.4;
        this.spawn({ x: f.x, y: f.y, z: f.z, vx: Math.cos(a) * r, vy: 2.6 + Math.random() * 0.8 + burst * 1.2, vz: Math.sin(a) * r, kind: 1, max: 1.1, size: 0.45 });
      }
    }

    const smokeCol = new THREE.Color('#ffffff').lerp(haze, 0.35).multiplyScalar(1 - night * 0.5);
    const sprayCol = new THREE.Color('#e8f6ff').multiplyScalar(1 - night * 0.35);
    let n = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      if (p.kind === 0) {
        p.vx += (0.4 + wind * 1.5 - p.vx) * dt * 0.5;
        p.size += dt * 0.55;
      } else {
        p.vy -= 7 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.alpha[n] = p.kind === 0 ? Math.sin(t * Math.PI) * 0.5 : (1 - t) * 0.85;
      this.size[n] = p.size;
      const c = p.kind === 0 ? smokeCol : sprayCol;
      this.tint[n * 3] = c.r;
      this.tint[n * 3 + 1] = c.g;
      this.tint[n * 3 + 2] = c.b;
      this.parts[n] = p;
      n++;
    }
    this.parts.length = n;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const name of ['position', 'aAlpha', 'aSize', 'aTint']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    // Forget emitters that scrolled away.
    if (this.carry.size > 200) this.carry.clear();
  }
}

// ---------------------------------------------------------------------------

const FIREFLIES = 70;

/** Warm specks drifting over the canal and parks after dark; pulse on the beat. */
export class Fireflies {
  readonly points: THREE.Points;
  private base: Float32Array;
  private pos: Float32Array;
  private mat: THREE.PointsMaterial;

  constructor() {
    this.base = new Float32Array(FIREFLIES * 3);
    this.pos = new Float32Array(FIREFLIES * 3);
    for (let i = 0; i < FIREFLIES; i++) {
      this.base[i * 3] = Math.random() * 140 - 60;
      this.base[i * 3 + 1] = 0.4 + Math.random() * 4.5;
      this.base[i * 3 + 2] = CANAL_Z + (Math.random() - 0.5) * 36;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: '#ffe08a', size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, map: puffTexture(),
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  update(time: number, camX: number, night: number, beatPulse: number) {
    this.mat.opacity = Math.max(0, night - 0.35) * (0.8 + 0.5 * beatPulse);
    this.points.visible = this.mat.opacity > 0.01;
    if (!this.points.visible) return;
    for (let i = 0; i < FIREFLIES; i++) {
      const bx = this.base[i * 3];
      // Wrap around the camera so they are always nearby.
      const x = camX - 60 + ((((bx - (camX - 60)) % 140) + 140) % 140);
      this.pos[i * 3] = x + Math.sin(time * 0.4 + i) * 1.5;
      this.pos[i * 3 + 1] = this.base[i * 3 + 1] + Math.sin(time * 0.9 + i * 1.7) * 0.5;
      this.pos[i * 3 + 2] = this.base[i * 3 + 2] + Math.cos(time * 0.3 + i * 0.5) * 1.2;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
