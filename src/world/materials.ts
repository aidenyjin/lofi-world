import * as THREE from 'three';
import { INK, type ResolvedPalette } from '../palette';
import { brushTexture, toonGradient, blobShadowTexture, leafTexture, signAtlas, glowTexture } from './textures';

// Shared materials. Everything that reacts to time of day or to the music
// is updated in one place (`update`) so chunks never need to know about it.

const WINDOW_DAY = new THREE.Color('#5d6a9c');
const WINDOW_GLOW = new THREE.Color('#ffd98a');
const BULB_DAY = new THREE.Color('#fff2cf');
const BULB_NIGHT = new THREE.Color('#ffcf73');
const TV_GLOW = new THREE.Color('#9fc4ff');
const WHITE = new THREE.Color('#ffffff');

export class Materials {
  readonly gradient = toonGradient();
  readonly brush = brushTexture();

  readonly toon = new THREE.MeshToonMaterial({
    vertexColors: true,
    map: this.brush,
    gradientMap: this.gradient,
  });

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

  /** Flat cut-outs (sprites, signs) multiply by this each frame. */
  readonly spriteTint = new THREE.Color('#ffffff');
  private readonly tinted = new Set<THREE.Material & { color: THREE.Color }>();

  private spriteMats = new Map<THREE.Texture, THREE.SpriteMaterial>();

  constructor() {
    const g = this.gradient;
    g.colorSpace = THREE.NoColorSpace;
    this.tinted.add(this.signs);

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
    this.bulb.color.copy(BULB_DAY).lerp(BULB_NIGHT, n).multiplyScalar(0.9 + n * (0.35 + 0.35 * beatPulse));

    this.leaf.color.copy(p.spriteTint);

    // TV windows: cool flicker at night.
    const tv = 0.75 + 0.25 * Math.sin(time * 13.0) * Math.sin(time * 3.7 + 1.0);
    this.windowTv.color.copy(this.windowDark.color).lerp(TV_GLOW, Math.min(1, n * 1.2) * tv);

    // Neon: normal paint by day, bright at night with the odd flicker on hats.
    const neonBoost = 1 + n * (0.9 - 0.7 * neonFlicker);
    this.neon.color.copy(p.spriteTint).lerp(WHITE, n).multiplyScalar(neonBoost);

    this.glow.opacity = Math.max(0, n - 0.2) * (0.75 + 0.15 * beatPulse);

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
  }
}
