import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { ResolvedPalette } from '../palette';

/**
 * The frame pipeline:
 *
 *   scene ──▶ HDR target (MSAA + depth)
 *              │
 *              ├─▶ fx pass (half res): ambient occlusion (R) + sun god rays (G)
 *              │     └─▶ depth-aware blur
 *              ├─▶ bloom (neon, windows, lamps, sun glints), added into the target
 *              ▼
 *   final pass: depth of field, AO tinted toward lilac, god rays, pastel grade,
 *               light leak, vignette and paper grain.
 */
export class Post {
  readonly target: THREE.WebGLRenderTarget;
  private fxTarget: THREE.WebGLRenderTarget;
  private blurTarget: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private fxMaterial: THREE.ShaderMaterial;
  private blurMaterial: THREE.ShaderMaterial;
  private sunWorld = new THREE.Vector3();
  private sunClip = new THREE.Vector4();

  readonly uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tFx: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uFocus: { value: 60 },
    uAperture: { value: 1 },
    uMaxBlur: { value: 9 },
    uTime: { value: 0 },
    uLift: { value: new THREE.Color() },
    uLeak: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uLeakPos: { value: new THREE.Vector2(0.85, 1.05) },
    uMood: { value: 0 }, // -1 cool (minor chords) .. +1 warm
    uPulse: { value: 0 },
    uNight: { value: 0 },
    uAO: { value: 1 },
    uRays: { value: 1 },
  };

  private fxUniforms = {
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uProj: { value: new THREE.Matrix4() },
    uProjInv: { value: new THREE.Matrix4() },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVisible: { value: 0 },
    uKernel: { value: [] as THREE.Vector3[] },
    uTexel: { value: new THREE.Vector2() },
  };

  constructor(width: number, height: number, type: THREE.TextureDataType = THREE.HalfFloatType, samples = 0) {
    const depth = new THREE.DepthTexture(width, height);
    depth.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(width, height, { type, depthTexture: depth, depthBuffer: true, samples });
    const half = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    this.fxTarget = new THREE.WebGLRenderTarget(1, 1, half);
    this.blurTarget = new THREE.WebGLRenderTarget(1, 1, half);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.55, 0.92);

    // Hemisphere kernel for SSAO, denser near the centre.
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 0.9 + 0.1).normalize();
      const sc = i / 14;
      v.multiplyScalar(0.15 + 0.85 * sc * sc);
      this.fxUniforms.uKernel.value.push(v);
    }
    this.fxUniforms.tDepth.value = depth;

    const vertexShader = /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `;

    this.fxMaterial = new THREE.ShaderMaterial({
      uniforms: this.fxUniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDepth;
        uniform float uNear, uFar, uSunVisible;
        uniform mat4 uProj, uProjInv;
        uniform vec2 uSunUV, uTexel;
        uniform vec3 uKernel[14];
        varying vec2 vUv;

        vec3 viewPos(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          vec4 v = uProjInv * clip;
          return v.xyz / v.w;
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main() {
          float d = texture2D(tDepth, vUv).x;
          float ao = 1.0;
          if (d < 0.99999) {
            vec3 P = viewPos(vUv);
            // Normal from neighbouring depths (the city is mostly flat faces).
            vec3 px = viewPos(vUv + vec2(uTexel.x, 0.0)) - P;
            vec3 py = viewPos(vUv + vec2(0.0, uTexel.y)) - P;
            vec3 N = normalize(cross(px, py));
            float dist = -P.z;
            float radius = clamp(dist * 0.035, 0.5, 3.0);
            float a = hash(vUv * 731.0) * 6.2831;
            vec3 rnd = vec3(cos(a), sin(a), 0.0);
            vec3 T = normalize(rnd - N * dot(rnd, N));
            vec3 B = cross(N, T);
            mat3 tbn = mat3(T, B, N);
            float occ = 0.0;
            for (int i = 0; i < 14; i++) {
              vec3 s = P + tbn * uKernel[i] * radius;
              vec4 c = uProj * vec4(s, 1.0);
              vec2 suv = c.xy / c.w * 0.5 + 0.5;
              if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
              float sceneZ = viewPos(suv).z;
              float range = smoothstep(0.0, 1.0, radius / abs(P.z - sceneZ));
              occ += (sceneZ >= s.z + 0.04 ? 1.0 : 0.0) * range;
            }
            ao = 1.0 - occ / 14.0;
          }

          // God rays: march toward the sun, gathering open sky.
          float rays = 0.0;
          if (uSunVisible > 0.0) {
            vec2 delta = (uSunUV - vUv) / 40.0;
            vec2 uv = vUv + delta * hash(vUv * 97.0);
            float decay = 1.0;
            for (int i = 0; i < 40; i++) {
              uv += delta;
              if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
              float sky = step(0.99999, texture2D(tDepth, uv).x);
              rays += sky * decay;
              decay *= 0.965;
            }
            rays = rays / 40.0 * uSunVisible;
          }
          gl_FragColor = vec4(ao, rays, 0.0, 1.0);
        }
      `,
    });

    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: { tFx: { value: this.fxTarget.texture }, tDepth: { value: depth }, uTexel: this.fxUniforms.uTexel, uNear: this.fxUniforms.uNear, uFar: this.fxUniforms.uFar },
      depthTest: false,
      depthWrite: false,
      vertexShader,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tFx, tDepth;
        uniform vec2 uTexel;
        uniform float uNear, uFar;
        varying vec2 vUv;
        float lin(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
        void main() {
          float z0 = lin(vUv);
          float ao = 0.0, w = 0.0, rays = 0.0;
          for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
              vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
              vec2 s = texture2D(tFx, uv).rg;
              float wz = 1.0 / (0.05 + abs(lin(uv) - z0) / max(z0, 1.0) * 40.0);
              ao += s.r * wz;
              w += wz;
              rays += s.g;
            }
          }
          gl_FragColor = vec4(ao / w, rays / 25.0, 0.0, 1.0);
        }
      `,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor, tDepth, tFx;
        uniform vec2 uResolution, uLeakPos;
        uniform float uNear, uFar, uFocus, uAperture, uMaxBlur, uTime, uMood, uPulse, uNight, uAO, uRays;
        uniform vec3 uLift, uLeak, uSun;
        varying vec2 vUv;

        float viewDist(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return -perspectiveDepthToViewZ(d, uNear, uFar);
        }

        // Circle-of-confusion in pixels. Inverse-distance so far haze blurs
        // gently and the foreground blurs quickly, like a macro lens.
        float blurSize(float dist) {
          float coc = abs(1.0 / uFocus - 1.0 / dist) * uFocus * uAperture;
          return clamp(coc, 0.0, 1.0) * uMaxBlur;
        }

        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        vec3 shade(vec2 uv) {
          vec3 c = min(texture2D(tColor, uv).rgb, vec3(1.6));
          float ao = mix(1.0, texture2D(tFx, uv).r, uAO);
          // Occlusion pools toward the palette's lilac instead of grey.
          return mix(c * mix(vec3(1.0), uLift * 2.2, 0.55), c, ao);
        }

        void main() {
          vec2 px = 1.0 / uResolution;
          float centerDepth = viewDist(vUv);
          float centerSize = blurSize(centerDepth);
          vec3 color = shade(vUv);
          float tot = 1.0;

          // Golden-angle gather (after Dennis Gustafsson's single-pass bokeh).
          float radius = 0.8;
          for (int i = 0; i < 64; i++) {
            if (radius >= uMaxBlur) break;
            float ang = float(i) * 2.39996323;
            vec2 tc = vUv + vec2(cos(ang), sin(ang)) * px * radius;
            vec3 sampleColor = shade(tc);
            float sampleDepth = viewDist(tc);
            float sampleSize = blurSize(sampleDepth);
            if (sampleDepth > centerDepth) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
            float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
            color += mix(color / tot, sampleColor, m);
            tot += 1.0;
            radius += 1.1 / radius;
          }
          color /= tot;

          // God rays, tinted by the sun.
          float rays = texture2D(tFx, vUv).g;
          color += uSun * rays * uRays;

          // --- Grade -------------------------------------------------------
          float luma = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(uLift, color, 0.93 + 0.07 * smoothstep(0.0, 0.6, luma));
          color = mix(vec3(luma), color, 1.1);
          color = mix(color, vec3(0.5), 0.04);
          vec3 warm = vec3(1.04, 1.0, 0.94);
          vec3 cool = vec3(0.95, 0.99, 1.06);
          color *= mix(vec3(1.0), uMood > 0.0 ? warm : cool, abs(uMood));
          // Soft highlight roll-off so bloom never clips harshly.
          color = color / (1.0 + max(color - 1.0, 0.0) * 0.6);

          vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
          float leak = 1.0 - smoothstep(0.0, 1.35, length((vUv - uLeakPos) * aspect));
          color += uLeak * leak * (0.22 - 0.16 * uNight);

          color *= 1.0 + uPulse * 0.025;

          float vig = smoothstep(1.25, 0.35, length((vUv - 0.5) * aspect * vec2(0.9, 1.1)));
          color = mix(color * mix(vec3(1.0), uLift * 1.6, 0.25), color, vig);

          float t = floor(uTime * 12.0);
          float grain = hash(vUv * uResolution + t * 17.0) - 0.5;
          float paper = hash(floor(vUv * uResolution / 2.0)) - 0.5;
          color += grain * 0.03 + paper * 0.018;

          gl_FragColor = vec4(max(color, 0.0), 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.uniforms.tColor.value = this.target.texture;
    this.uniforms.tDepth.value = depth;
    this.uniforms.tFx.value = this.blurTarget.texture;

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.setSize(width, height);
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
    const hw = Math.max(1, Math.floor(width / 2));
    const hh = Math.max(1, Math.floor(height / 2));
    this.fxTarget.setSize(hw, hh);
    this.blurTarget.setSize(hw, hh);
    this.fxUniforms.uTexel.value.set(1 / hw, 1 / hh);
    this.bloom.setSize(width, height);
    this.uniforms.uResolution.value.set(width, height);
  }

  update(camera: THREE.PerspectiveCamera, p: ResolvedPalette, time: number, sunDir: THREE.Vector3) {
    const u = this.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uTime.value = time;
    u.uLift.value.copy(p.shadowLift);
    u.uLeak.value.copy(p.sun);
    u.uSun.value.copy(p.sun).multiplyScalar(0.55 * (1 - p.nightness * 0.8));
    u.uNight.value = p.nightness;

    const f = this.fxUniforms;
    f.uNear.value = camera.near;
    f.uFar.value = camera.far;
    f.uProj.value.copy(camera.projectionMatrix);
    f.uProjInv.value.copy(camera.projectionMatrixInverse);
    // Where is the sun on screen? Rays fade as it leaves the frame.
    this.sunWorld.copy(camera.position).addScaledVector(sunDir, 800);
    this.sunClip.set(this.sunWorld.x, this.sunWorld.y, this.sunWorld.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    if (this.sunClip.w > 0) {
      const sx = this.sunClip.x / this.sunClip.w * 0.5 + 0.5;
      const sy = this.sunClip.y / this.sunClip.w * 0.5 + 0.5;
      f.uSunUV.value.set(sx, sy);
      const off = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
      f.uSunVisible.value = THREE.MathUtils.clamp(1.6 - off * 1.6, 0, 1) * (1 - p.nightness * 0.85);
      // The painted light leak sits where the sun is (kept near the frame).
      u.uLeakPos.value.set(THREE.MathUtils.clamp(sx, -0.2, 1.2), THREE.MathUtils.clamp(sy, 0.3, 1.2));
    } else {
      f.uSunVisible.value = 0;
    }
    // Bloom: gentle by day, lush at night when the lights come on.
    this.bloom.strength = 0.3 + p.nightness * 0.35;
    this.bloom.threshold = 0.95;
    this.bloom.radius = 0.4;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);

    this.quad.material = this.fxMaterial;
    renderer.setRenderTarget(this.fxTarget);
    renderer.render(this.scene, this.camera);
    this.quad.material = this.blurMaterial;
    renderer.setRenderTarget(this.blurTarget);
    renderer.render(this.scene, this.camera);

    this.bloom.render(renderer, this.target, this.target, 0, false);

    this.quad.material = this.material;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
