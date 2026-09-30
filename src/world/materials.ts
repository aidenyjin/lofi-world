import * as THREE from 'three';
import { INK, type ResolvedPalette } from '../palette';
import { WindowMaterial } from './windows';
import { SURFACE_GLSL } from './surfaces';
import { brushTexture, toonGradient, blobShadowTexture, leafTexture, signAtlas, glowTexture } from './textures';

// Shared materials. Everything that reacts to time of day or to the music
// is updated in one place (`update`) so chunks never need to know about it.

const WINDOW_DAY = new THREE.Color('#5d6a9c');
const WINDOW_GLOW = new THREE.Color('#ffd98a');
const BULB_DAY = new THREE.Color('#fff2cf');
const BULB_NIGHT = new THREE.Color('#ffcf73');
const TV_GLOW = new THREE.Color('#9fc4ff');
const WHITE = new THREE.Color('#ffffff');

/** Shared rim light: a soft sun-coloured edge on toon surfaces. */
export const rimUniforms = { uRim: { value: new THREE.Color('#ffd9a8') } };
/** How far the trees have turned toward autumn (follows the sunset). */
export const surfaceUniforms = { uAutumn: { value: 0 } };

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

/** World-space procedural surface detail (brick, stone, wood, asphalt...). */
function addSurfaces(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, surfaceUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aSurf;\nvarying float vSurf;\nvarying vec3 vWPos;\nvarying vec3 vWNor;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vSurf = aSurf;
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWNor = normalize(mat3(modelMatrix) * objectNormal);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uAutumn;\nvarying float vSurf;\nvarying vec3 vWPos;\nvarying vec3 vWNor;\n' + SURFACE_GLSL)
    .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = surfaceDetail(vSurf, vWPos, normalize(vWNor), diffuseColor.rgb);')
    .replace('#include <color_fragment>', '#include <color_fragment>\nif (int(vSurf + 0.5) == 8) diffuseColor.rgb = autumnShift(diffuseColor.rgb, vWPos);');
}

/** How bright the unlit outline shader should be (follows the light, dims at night). */
export const inkUniforms = { uInk: { value: new THREE.Color(INK) }, uLineLight: { value: new THREE.Color(1, 1, 1) } };

/**
 * Outline hulls carry their shape's colour. The line is a darker, slightly
 * plum shade of that colour; it breaks up here and there like a sketched
 * line, and fades into the shape's own colour with distance so the far
 * city is drawn without lines at all. Hulls with no colour (black) are
 * drawn in plain ink.
 */
function inkMaterial(): THREE.MeshBasicMaterial {
  // (Its colour stays ink: birds borrow it. The shader draws the lines from the vertex colours.)
  const m = new THREE.MeshBasicMaterial({ color: INK, vertexColors: true, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, inkUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInkW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInkW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uInk, uLineLight;
        varying vec3 vInkW;
        float iHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float iNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(iHash(i), iHash(i + vec2(1, 0)), u.x), mix(iHash(i + vec2(0, 1)), iHash(i + vec2(1, 1)), u.x), u.y);
        }`)
      .replace('#include <color_fragment>', `
        vec3 fillC = vColor.rgb;
        bool plain = dot(fillC, vec3(1.0)) < 0.03;
        vec3 lineC = plain ? uInk : mix(fillC * 0.42, uInk, 0.3);
        // Sketchy breaks along the line
        float gap = smoothstep(0.66, 0.8, iNoise(vInkW.xz * 1.3 + vInkW.y * 1.7));
        // Distance: lines thin out into the haze
        #ifdef USE_FOG
          float far = smoothstep(30.0, 140.0, vFogDepth);
        #else
          float far = 0.0;
        #endif
        vec3 base = plain ? mix(uInk, vec3(0.75), 0.5) : fillC;
        diffuseColor.rgb = mix(lineC, base, max(gap * 0.75, far)) * uLineLight;`);
  };
  m.customProgramCacheKey = () => 'ink-illustrated';
  return m;
}

function rimmed<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (shader) => {
    addSurfaces(shader);
    addRim(shader);
  };
  m.customProgramCacheKey = () => 'toon-surf-rim';
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

  /** Illustrated outlines: see inkMaterial(). */
  readonly ink = inkMaterial();

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

  /** Self-lit colour (paper lanterns, neon strips): vertex colour, brighter at night. */
  readonly emissive = new THREE.MeshBasicMaterial({ vertexColors: true });

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
    surfaceUniforms.uAutumn.value = p.autumn;
    // Outlines are unlit: dim them with the light so they don't glow at night.
    inkUniforms.uLineLight.value.setRGB(1, 1, 1).lerp(new THREE.Color(0.32, 0.34, 0.52), n);
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

    this.emissive.color.setScalar((0.85 + n * 0.75) * (1 - 0.35 * neonFlicker * n));

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
    // Rim light follows the sun; a cool moonlit edge at night.
    rimUniforms.uRim.value.copy(p.sun).multiplyScalar(0.22 * (0.5 + 0.5 * (1 - n)) * p.sunIntensity * 0.45);

    // Lit windows run a little hot at night so the bloom picks them up.
    this.windowLit.color.multiplyScalar(1 + 0.35 * n);
  }
}
