import * as THREE from 'three';
import { Rng, hashSeed } from '../rng';
import type { ResolvedPalette } from '../palette';

/** Gradient dome with a soft sun glow and a few painted cloud bands. */
export class Sky {
  readonly mesh: THREE.Mesh;
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1) },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };

  get skyUniforms(): SkyUniforms {
    return this.uniforms;
  }

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // pin to the far plane
        }
      `,
      fragmentShader: /* glsl */ `
        ${SKY_GRADIENT}
        uniform vec3 uTop, uBottom, uHaze, uSun, uSunDir;
        uniform float uNight, uTime;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = skyGradient(d, uTop, uBottom, uHaze);

          // Sun/moon glow, looking toward the light source's horizon.
          vec3 sd = normalize(vec3(uSunDir.x, max(uSunDir.y * 0.35, 0.05), -abs(uSunDir.z) - 0.6));
          float g = max(dot(d, sd), 0.0);
          col += uSun * (pow(g, 12.0) * 0.35 + pow(g, 400.0) * (0.8 - 0.5 * uNight));

          // Painterly cloud streaks.
          vec2 cp = vec2(atan(d.x, -d.z) * 3.0 + uTime * 0.004, d.y * 14.0);
          float c = noise(cp * vec2(1.0, 1.0)) * 0.6 + noise(cp * 2.3) * 0.4;
          float band = smoothstep(0.55, 0.8, c) * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.3, 0.6, h));
          col = mix(col, mix(uBottom, vec3(1.0), 0.55 - 0.4 * uNight), band * 0.55);

          // Stars at night.
          vec2 sp = floor(vec2(atan(d.x, -d.z), d.y) * 260.0);
          float star = step(0.997, hash(sp)) * smoothstep(0.15, 0.5, h) * uNight;
          col += star * 0.8;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(p: ResolvedPalette, sunDir: THREE.Vector3, cameraPos: THREE.Vector3, time: number) {
    const u = this.uniforms;
    u.uTop.value.copy(p.skyTop);
    u.uBottom.value.copy(p.skyBottom);
    u.uHaze.value.copy(p.haze);
    u.uSun.value.copy(p.sun);
    u.uSunDir.value.copy(sunDir);
    u.uNight.value = p.nightness;
    u.uTime.value = time;
    this.mesh.position.copy(cameraPos);
  }
}

// ---------------------------------------------------------------------------

const SKY_CHUNK = 60;
const LAYERS = [
  { z0: -125, z1: -175, h: [18, 40], w: [7, 16], haze: 0.3 },
  { z0: -190, z1: -260, h: [24, 58], w: [9, 22], haze: 0.5 },
  { z0: -280, z1: -380, h: [30, 80], w: [12, 30], haze: 0.68 },
];

// Shared by the sky dome and the skyline so distant towers always fade into
// exactly the sky colour behind them (never brighter, never a seam).
const SKY_GRADIENT = /* glsl */ `
  vec3 skyGradient(vec3 d, vec3 top, vec3 bottom, vec3 haze) {
    float h = clamp(d.y, -0.2, 1.0);
    vec3 col = mix(bottom, top, smoothstep(0.0, 0.55, h));
    return mix(haze, col, smoothstep(-0.05, 0.12, h));
  }
`;

interface SkyUniforms {
  uTop: { value: THREE.Color };
  uBottom: { value: THREE.Color };
  uHaze: { value: THREE.Color };
}

/**
 * Distant skyline silhouettes: flat, unlit, pre-hazed layers like the pale
 * blue towers in the reference frames. Lit windows sprinkle in at night.
 */
export class Skyline {
  readonly group = new THREE.Group();
  private chunks = new Map<number, THREE.Group>();
  private layerMats: THREE.ShaderMaterial[];
  private windowMat = new THREE.PointsMaterial({
    color: '#ffd98a', size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  private geos = new Map<number, THREE.BufferGeometry[]>();

  constructor(private seed: number, sky: SkyUniforms) {
    this.layerMats = LAYERS.map(
      (l) =>
        new THREE.ShaderMaterial({
          uniforms: {
            ...sky,
            uColor: { value: new THREE.Color() },
            uHazeAmount: { value: l.haze },
          },
          vertexColors: true,
          vertexShader: /* glsl */ `
            varying vec3 vWorld;
            varying vec3 vColor;
            void main() {
              vColor = color;
              vec4 w = modelMatrix * vec4(position, 1.0);
              vWorld = w.xyz;
              gl_Position = projectionMatrix * viewMatrix * w;
            }
          `,
          fragmentShader: /* glsl */ `
            ${SKY_GRADIENT}
            uniform vec3 uTop, uBottom, uHaze, uColor;
            uniform float uHazeAmount;
            varying vec3 vWorld;
            varying vec3 vColor;
            void main() {
              vec3 d = normalize(vWorld - cameraPosition);
              vec3 sky = skyGradient(d, uTop, uBottom, uHaze);
              gl_FragColor = vec4(mix(uColor * vColor, sky, uHazeAmount), 1.0);
              #include <colorspace_fragment>
            }
          `,
        }),
    );
  }

  update(cameraX: number, p: ResolvedPalette) {
    const from = Math.floor((cameraX - 200) / SKY_CHUNK);
    const to = Math.floor((cameraX + 620) / SKY_CHUNK);
    for (let i = from; i <= to; i++) if (!this.chunks.has(i)) this.build(i);
    for (const [i, g] of this.chunks) {
      if (i < from - 1 || i > to + 1) {
        g.removeFromParent();
        this.geos.get(i)?.forEach((geo) => geo.dispose());
        this.geos.delete(i);
        this.chunks.delete(i);
      }
    }
    for (const m of this.layerMats) m.uniforms.uColor.value.copy(p.skyline);
    this.windowMat.opacity = Math.max(0, p.nightness - 0.3) * 1.2;
  }

  private build(index: number) {
    const rng = new Rng(hashSeed(this.seed, index, 0x5c));
    const g = new THREE.Group();
    g.position.x = index * SKY_CHUNK;
    const geos: THREE.BufferGeometry[] = [];
    const windows: number[] = [];

    LAYERS.forEach((layer, li) => {
      const boxes: THREE.BufferGeometry[] = [];
      let x = 0;
      while (x < SKY_CHUNK) {
        const w = rng.range(layer.w[0], layer.w[1]);
        const h = rng.range(layer.h[0], layer.h[1]) * (rng.chance(0.15) ? 1.35 : 1);
        const z = rng.range(layer.z1, layer.z0);
        const box = new THREE.BoxGeometry(w, h, 6);
        box.translate(x + w / 2, h / 2, z);
        const shade = rng.range(0.9, 1.04);
        const colors = new Float32Array(box.getAttribute('position').count * 3).fill(shade);
        box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        boxes.push(box);
        if (rng.chance(0.3)) {
          // Stepped crown or antenna
          const cw = w * rng.range(0.3, 0.6);
          const ch = rng.range(4, 12);
          const crown = new THREE.BoxGeometry(cw, ch, 5);
          crown.translate(x + w / 2, h + ch / 2, z);
          crown.setAttribute('color', new THREE.BufferAttribute(new Float32Array(crown.getAttribute('position').count * 3).fill(shade), 3));
          boxes.push(crown);
        }
        for (let k = 0; k < (w * h) / 60; k++) {
          if (rng.chance(0.55)) windows.push(x + rng.range(1, w - 1), rng.range(2, h - 2), z + 3.1);
        }
        x += w * rng.range(0.55, 1.05);
      }
      const merged = mergeBoxes(boxes);
      boxes.forEach((b) => b.dispose());
      geos.push(merged);
      const mesh = new THREE.Mesh(merged, this.layerMats[li]);
      mesh.renderOrder = -5 + li;
      g.add(mesh);
    });

    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(windows, 3));
    geos.push(wg);
    g.add(new THREE.Points(wg, this.windowMat));

    this.group.add(g);
    this.chunks.set(index, g);
    this.geos.set(index, geos);
  }
}

function mergeBoxes(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const g of list) {
    verts += g.getAttribute('position').count;
    idx += g.getIndex()!.count;
  }
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const index = new Uint32Array(idx);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.getAttribute('position').array as Float32Array;
    const c = g.getAttribute('color').array as Float32Array;
    pos.set(p, vo * 3);
    col.set(c, vo * 3);
    const gi = g.getIndex()!.array;
    for (let i = 0; i < gi.length; i++) index[io + i] = gi[i] + vo;
    vo += p.length / 3;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}
