import * as THREE from 'three';
import { INK, type ResolvedPalette } from '../palette';
import { WindowMaterial } from './windows';
import { brushTexture, toonGradient, blobShadowTexture, leafTexture, signAtlas, glowTexture } from './textures';

// Shared materials. Everything that reacts to time of day or to the music
// is updated in one place (`update`) so chunks never need to know about it.

const WINDOW_DAY = new THREE.Color('#5d6a9c');
const WINDOW_GLOW = new THREE.Color('#ffd98a');
const BULB_DAY = new THREE.Color('#fff2cf');
const BULB_NIGHT = new THREE.Color('#ffcf73');
const TV_GLOW = new THREE.Color('#9fc4ff');
const WHITE = new THREE.Color('#ffffff');

// Character rig, evaluated per vertex on the GPU. Every vertex knows its bone
// (0 body, 1 head, 2 left arm, 3 right arm), the bone's pivot, the character's
// feet (root), its activity and a random seed. Activities:
// 0 idle, 1 read, 2 sip, 3 paint, 4 strum, 5 wave, 6 listen, 7 row.
const RIG_PARS = /* glsl */ `
  attribute float aBone;
  attribute vec3 aPivot;
  attribute vec3 aRoot;
  attribute vec2 aAnim;
  uniform float uTime;
  uniform float uBeatPh;
  uniform float uBeatLen;
  vec3 rigRotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
  vec3 rigRotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
  float rigHit() { return pow(1.0 - clamp(uBeatPh, 0.0, 1.0), 3.0); }
  // (pitch about X, roll about Z) for this vertex's bone.
  vec2 rigBone() {
    int bone = int(aBone + 0.5);
    int act = int(aAnim.x + 0.5);
    float seed = aAnim.y;
    float hit = rigHit();
    float g = 0.6 + 0.4 * fract(seed * 7.31);
    float t = uTime + seed * 10.0;
    float hb = uTime * 3.14159 / max(uBeatLen, 0.3) + seed * 6.0;
    float pitch = 0.0, roll = 0.0;
    if (bone == 1) {
      if (act == 1) { pitch = 0.2 + 0.05 * hit; roll = 0.05 * sin(t * 0.5); }
      else if (act == 6) { pitch = 0.3 * hit * g - 0.04; roll = 0.1 * sin(hb); }
      else { pitch = 0.14 * hit * g; roll = 0.07 * sin(t * 1.1); }
    } else if (bone == 3) {
      if (act == 2) { float x = fract(t * 0.09); pitch = -1.05 * smoothstep(0.0, 0.12, x) * (1.0 - smoothstep(0.3, 0.42, x)); }
      else if (act == 3) { pitch = -0.15 + 0.3 * sin(t * 5.0); roll = 0.2 * sin(t * 2.5); }
      else if (act == 4) { pitch = 0.32 * sin(uBeatPh * 12.566); }
      else if (act == 5) { roll = 2.3 + 0.35 * sin(uBeatPh * 6.283); }
      else if (act == 1) { float x = fract(t * 0.07); roll = -0.55 * smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.1, 0.18, x)); }
      else if (act == 7) { pitch = 0.45 * sin(t * 2.2); }
      else { pitch = 0.12 * sin(hb); roll = 0.08 * hit; }
    } else if (bone == 2) {
      if (act == 5) { roll = -0.3 * hit; }
      else if (act == 7) { pitch = 0.45 * sin(t * 2.2); }
      else if (act == 0 || act == 6) { pitch = -0.12 * sin(hb); roll = -0.08 * hit; }
    }
    return vec2(pitch, roll);
  }
  // (squash, sway) for the whole character about its feet.
  vec2 rigBody() {
    int act = int(aAnim.x + 0.5);
    float seed = aAnim.y;
    float g = 0.6 + 0.4 * fract(seed * 7.31);
    float hb = uTime * 3.14159 / max(uBeatLen, 0.3) + seed * 6.0;
    float groove = (act == 5 || act == 6) ? 1.5 : 1.0;
    float sway = (act == 5 || act == 6) ? 0.06 * sin(hb) : 0.02 * sin(uTime * 0.8 + seed * 9.0);
    return vec2(0.05 * rigHit() * g * groove, sway);
  }
`;
const RIG_NORMAL = /* glsl */ `
  vec2 rigB = rigBone();
  vec2 rigC = rigBody();
  objectNormal = rigRotZ(rigRotX(rigRotZ(objectNormal, rigB.y), rigB.x), rigC.y);
`;
const RIG_POSITION = /* glsl */ `
  vec2 rigB2 = rigBone();
  vec2 rigC2 = rigBody();
  vec3 rigL = transformed - aPivot;
  transformed = aPivot + rigRotX(rigRotZ(rigL, rigB2.y), rigB2.x);
  vec3 rigR = transformed - aRoot;
  rigR.y *= 1.0 - rigC2.x;
  rigR.xz *= 1.0 + rigC2.x * 0.5;
  transformed = aRoot + rigRotZ(rigR, rigC2.y);
`;

/** Shared rim light: a soft sun-coloured edge on toon surfaces. */
export const rimUniforms = { uRim: { value: new THREE.Color('#ffd9a8') } };

function addRim(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, rimUniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
    .replace(
      '#include <opaque_fragment>',
      `float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
      outgoingLight += uRim * rimF;
      #include <opaque_fragment>`,
    );
}

function rimmed<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = addRim;
  return m;
}

function rigged<M extends THREE.Material>(m: M, uniforms: Record<string, THREE.IUniform>, normals: boolean): M {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (normals) addRim(shader);
    let vs = shader.vertexShader.replace('#include <common>', '#include <common>\n' + RIG_PARS);
    if (normals) vs = vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + RIG_NORMAL);
    vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + RIG_POSITION);
    shader.vertexShader = vs;
  };
  m.customProgramCacheKey = () => 'rig' + (normals ? 'n' : '');
  return m;
}

export class Materials {
  readonly gradient = toonGradient();
  readonly brush = brushTexture();

  readonly toon = rimmed(new THREE.MeshToonMaterial({
    vertexColors: true,
    map: this.brush,
    gradientMap: this.gradient,
  }));

  readonly ink = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

  /** Windows that light up at night. */
  readonly windowLit = new THREE.MeshBasicMaterial({ color: WINDOW_DAY.clone(), vertexColors: true });
  /** Windows that stay dark; tinted with the sky so they read as glass. */
  readonly windowDark = new THREE.MeshBasicMaterial({ color: WINDOW_DAY.clone(), vertexColors: true });

  readonly bulb = new THREE.MeshBasicMaterial({ color: BULB_DAY.clone() });
  readonly wire = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.75 });

  readonly blobShadow = new THREE.MeshBasicMaterial({
    map: blobShadowTexture(),
    transparent: true,
    depthWrite: false,
  });

  readonly leaf = new THREE.MeshBasicMaterial({
    map: leafTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });

  /** Building windows: glass over a ray-cast room (windows.ts). */
  readonly windows = new WindowMaterial();

  /** TV-lit windows: flicker blue at night. */
  readonly windowTv = new THREE.MeshBasicMaterial({ color: WINDOW_DAY.clone(), vertexColors: true });

  readonly atlas = signAtlas();
  /** Painted shop signs and billboards (follow the sprite tint). */
  readonly signs = new THREE.MeshBasicMaterial({ map: this.atlas.tex });
  /** Neon blades: plain by day, glowing and flickering at night. */
  readonly neon = new THREE.MeshBasicMaterial({ map: this.atlas.tex });

  /** Lamp light pools on pavements and water; only visible after dusk. */
  readonly glow = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color: '#ffc877',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  readonly glass = new THREE.MeshBasicMaterial({ color: '#bfe3e6', transparent: true, opacity: 0.55, depthWrite: false });

  /** Bunting flags that ripple with the wind (uv.x = distance from the string). */
  readonly flags: THREE.MeshToonMaterial;
  private flagUniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };

  readonly water: THREE.ShaderMaterial;

  /** Shared clock for every character rig. */
  readonly rigUniforms = { uTime: { value: 0 }, uBeatPh: { value: 1 }, uBeatLen: { value: 0.8 } };
  readonly charToon: THREE.MeshToonMaterial;
  readonly charInk: THREE.MeshBasicMaterial;

  /** Flat cut-outs (sprites, signs) multiply by this each frame. */
  readonly spriteTint = new THREE.Color('#ffffff');
  private readonly tinted = new Set<THREE.Material & { color: THREE.Color }>();

  private spriteMats = new Map<THREE.Texture, THREE.SpriteMaterial>();

  constructor() {
    const g = this.gradient;
    g.colorSpace = THREE.NoColorSpace;
    this.tinted.add(this.signs);

    this.charToon = rigged(
      new THREE.MeshToonMaterial({ vertexColors: true, map: this.brush, gradientMap: this.gradient }),
      this.rigUniforms,
      true,
    );
    this.charInk = rigged(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }), this.rigUniforms, false);

    this.flags = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient, side: THREE.DoubleSide });
    const fu = this.flagUniforms;
    this.flags.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fu);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float sway = uv.x;
          transformed.z += sin(uTime * 5.0 + position.x * 1.7 + position.z) * sway * (0.08 + 0.18 * uWind);
          transformed.x += cos(uTime * 4.0 + position.z * 1.3) * sway * 0.05 * uWind;`,
        );
    };

    this.water = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uSkyTop: { value: new THREE.Color() },
          uSkyBottom: { value: new THREE.Color() },
          uDeep: { value: new THREE.Color('#5f8fa8') },
          uGlint: { value: new THREE.Color('#ffd98a') },
          uNight: { value: 0 },
          uPulse: { value: 0 },
        },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime, uNight, uPulse;
        uniform vec3 uSkyTop, uSkyBottom, uDeep, uGlint;
        varying vec3 vWorld;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          vec2 p = vWorld.xz;
          // Painted reflection: sky colours broken up by slow wobble.
          float wob = vnoise(p * vec2(0.35, 1.6) + vec2(uTime * 0.25, 0.0));
          vec3 sky = mix(uSkyBottom, uSkyTop, 0.35 + 0.4 * wob);
          vec3 col = mix(uDeep, sky, 0.55);
          // Brushy wavelet dashes drifting along the canal.
          float dash = vnoise(vec2(p.x * 0.9 - uTime * 0.6, p.y * 5.0));
          col = mix(col, mix(uSkyBottom, vec3(1.0), 0.6), smoothstep(0.72, 0.78, dash) * (0.55 - 0.35 * uNight));
          // Night: warm lamp glints dancing on the water, brighter on the beat.
          float gl = vnoise(vec2(p.x * 2.2 + uTime * 0.8, p.y * 7.0 - uTime));
          col += uGlint * smoothstep(0.8, 0.9, gl) * uNight * (0.6 + 0.6 * uPulse);
          // Darker toward the walls.
          col *= 0.88 + 0.12 * wob;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
  }

  spriteMaterial(tex: THREE.Texture): THREE.SpriteMaterial {
    let m = this.spriteMats.get(tex);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 });
      this.spriteMats.set(tex, m);
      this.tinted.add(m);
    }
    return m;
  }

  /** Register a material whose colour should follow the sprite tint. */
  track<M extends THREE.Material & { color: THREE.Color }>(m: M): M {
    this.tinted.add(m);
    return m;
  }

  untrack(m: THREE.Material & { color: THREE.Color }): void {
    this.tinted.delete(m);
  }

  update(p: ResolvedPalette, beatPulse: number, time = 0, wind = 0.3, neonFlicker = 0): void {
    const n = p.nightness;
    this.spriteTint.copy(p.spriteTint);
    for (const m of this.tinted) m.color.copy(this.spriteTint);

    // Glass picks up the sky by day; lit windows glow warmer as night falls.
    this.windowDark.color.copy(WINDOW_DAY).lerp(p.skyTop, 0.35).multiplyScalar(1 - 0.45 * n);
    this.windowLit.color.copy(this.windowDark.color).lerp(WINDOW_GLOW, Math.min(1, n * 1.15));

    // String-light bulbs: soft by day, warm and breathing with the beat at night.
    this.bulb.color.copy(BULB_DAY).lerp(BULB_NIGHT, n).multiplyScalar(0.9 + n * (0.25 + 0.2 * beatPulse));

    this.leaf.color.copy(p.spriteTint);

    // TV windows: cool flicker at night.
    const tv = 0.75 + 0.25 * Math.sin(time * 13.0) * Math.sin(time * 3.7 + 1.0);
    this.windowTv.color.copy(this.windowDark.color).lerp(TV_GLOW, Math.min(1, n * 1.2) * tv);

    // Neon: normal paint by day, bright at night with the odd flicker on hats.
    const neonBoost = 1 + n * (0.5 - 0.45 * neonFlicker);
    this.neon.color.copy(p.spriteTint).lerp(WHITE, n).multiplyScalar(neonBoost);

    this.glow.opacity = Math.max(0, n - 0.2) * (0.42 + 0.1 * beatPulse);

    this.flagUniforms.uTime.value = time;
    this.flagUniforms.uWind.value = wind;

    const wu = this.water.uniforms;
    wu.uTime.value = time;
    wu.uSkyTop.value.copy(p.skyTop);
    wu.uSkyBottom.value.copy(p.skyBottom);
    wu.uDeep.value.set('#5f8fa8').lerp(p.shadowLift, 0.35 + 0.4 * n);
    wu.uNight.value = n;
    wu.uPulse.value = beatPulse;
    this.ink.color.set(INK).lerp(p.shadowLift, 0.15);
    this.charInk.color.copy(this.ink.color);
    this.rigUniforms.uTime.value = time;
    // Rim light follows the sun; a cool moonlit edge at night.
    rimUniforms.uRim.value.copy(p.sun).multiplyScalar(0.22 * (0.5 + 0.5 * (1 - n)) * p.sunIntensity * 0.45);

    // Lit windows run a little hot at night so the bloom picks them up.
    this.windowLit.color.multiplyScalar(1 + 0.35 * n);
  }
}
