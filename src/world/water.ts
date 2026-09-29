import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { ResolvedPalette } from '../palette';
import { CANAL_Z, CANAL_Z0, CANAL_Z1, WATER_Y } from './city';

/**
 * The canal surface: a real planar reflection of the city, rippled and
 * painted over with brushy wavelets and warm lamp glints at night.
 *
 * One long plane follows the camera down the corridor. Where the corridor is
 * a street, market or park, its paving sits above the water and hides it.
 */
export class CanalWater {
  readonly mesh: Reflector;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const geo = new THREE.PlaneGeometry(460, CANAL_Z1 - CANAL_Z0);
    const shader = {
      name: 'CanalWater',
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          color: { value: new THREE.Color(0xffffff) },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
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
        uniform mat4 textureMatrix;
        varying vec4 vReflUv;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vReflUv = textureMatrix * vec4(position, 1.0);
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
        uniform sampler2D tDiffuse;
        uniform vec3 color, uSkyTop, uSkyBottom, uDeep, uGlint;
        uniform float uTime, uNight, uPulse;
        varying vec4 vReflUv;
        varying vec3 vWorld;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          vec2 p = vWorld.xz;
          float t = uTime;
          // Ripples that bend the reflection, stretched along the canal.
          vec2 rip = vec2(
            vnoise(p * vec2(0.7, 3.0) + vec2(t * 0.6, 0.0)) - 0.5,
            vnoise(p * vec2(0.5, 2.2) - vec2(t * 0.4, t * 0.2)) - 0.5
          );
          vec4 ruv = vReflUv;
          ruv.xy += rip * vec2(0.03, 0.06) * ruv.w;
          vec3 refl = texture2DProj(tDiffuse, ruv).rgb;

          float wob = vnoise(p * vec2(0.35, 1.6) + vec2(t * 0.25, 0.0));
          vec3 sky = mix(uSkyBottom, uSkyTop, 0.35 + 0.4 * wob);
          vec3 body = mix(uDeep, sky, 0.45);
          // Mostly mirror, tinted by the water body; slightly darker near the walls.
          float edge = smoothstep(0.0, 1.2, min(abs(vWorld.z - ${CANAL_Z0.toFixed(2)}), abs(vWorld.z - ${CANAL_Z1.toFixed(2)})));
          vec3 col = mix(body, refl * vec3(0.95, 0.98, 1.02), 0.6) * 1.08;
          col *= 0.82 + 0.18 * edge;

          // Brushy wavelet dashes drifting along the canal.
          float dash = vnoise(vec2(p.x * 0.9 - t * 0.6, p.y * 5.0));
          col = mix(col, mix(uSkyBottom, vec3(1.0), 0.6), smoothstep(0.74, 0.8, dash) * (0.4 - 0.3 * uNight));
          // Warm glints dancing at night, brighter on the beat.
          float gl = vnoise(vec2(p.x * 2.2 + t * 0.8, p.y * 7.0 - t));
          col += uGlint * smoothstep(0.8, 0.9, gl) * uNight * (0.8 + 0.8 * uPulse);

          gl_FragColor = vec4(col * color, 1.0);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }
      `,
    };
    this.mesh = new Reflector(geo, {
      textureWidth: Math.floor(size.x * 0.6),
      textureHeight: Math.floor(size.y * 0.6),
      clipBias: 0.01,
      shader,
      multisample: 4,
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, WATER_Y, CANAL_Z);
    const mat = this.mesh.material as THREE.ShaderMaterial;
    mat.fog = true;
    this.uniforms = mat.uniforms;
  }

  update(camX: number, p: ResolvedPalette, time: number, beatPulse: number) {
    this.mesh.position.x = camX + 150;
    const u = this.uniforms;
    u.uTime.value = time;
    u.uSkyTop.value.copy(p.skyTop);
    u.uSkyBottom.value.copy(p.skyBottom);
    u.uDeep.value.set('#5f8fa8').lerp(p.shadowLift, 0.35 + 0.4 * p.nightness);
    u.uNight.value = p.nightness;
    u.uPulse.value = beatPulse;
  }
}
