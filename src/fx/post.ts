import * as THREE from 'three';
import type { ResolvedPalette } from '../palette';

/**
 * One full-screen pass that turns the clean render into something that reads
 * as painted: depth-of-field (for tilt-shift and focus pulls), a pastel grade
 * that lifts shadows toward lilac, a warm light leak, paper grain and a
 * vignette. Doing it all in one shader keeps it cheap.
 */
export class Post {
  readonly target: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;

  readonly uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uFocus: { value: 60 },
    uAperture: { value: 1 },
    uMaxBlur: { value: 9 },
    uTime: { value: 0 },
    uLift: { value: new THREE.Color() },
    uLeak: { value: new THREE.Color() },
    uLeakPos: { value: new THREE.Vector2(0.85, 1.05) },
    uMood: { value: 0 }, // -1 cool (minor chords) .. +1 warm
    uPulse: { value: 0 },
    uNight: { value: 0 },
  };

  constructor(width: number, height: number) {
    const depth = new THREE.DepthTexture(width, height);
    depth.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthTexture: depth,
      depthBuffer: true,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor, tDepth;
        uniform vec2 uResolution, uLeakPos;
        uniform float uNear, uFar, uFocus, uAperture, uMaxBlur, uTime, uMood, uPulse, uNight;
        uniform vec3 uLift, uLeak;
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

        void main() {
          vec2 px = 1.0 / uResolution;
          float centerDepth = viewDist(vUv);
          float centerSize = blurSize(centerDepth);
          vec3 color = texture2D(tColor, vUv).rgb;
          float tot = 1.0;

          // Golden-angle gather (after Dennis Gustafsson's single-pass bokeh).
          float radius = 0.8;
          for (int i = 0; i < 64; i++) {
            if (radius >= uMaxBlur) break;
            float ang = float(i) * 2.39996323;
            vec2 tc = vUv + vec2(cos(ang), sin(ang)) * px * radius;
            vec3 sampleColor = texture2D(tColor, tc).rgb;
            float sampleDepth = viewDist(tc);
            float sampleSize = blurSize(sampleDepth);
            if (sampleDepth > centerDepth) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
            float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
            color += mix(color / tot, sampleColor, m);
            tot += 1.0;
            radius += 1.1 / radius;
          }
          color /= tot;

          // --- Grade -------------------------------------------------------
          float luma = dot(color, vec3(0.299, 0.587, 0.114));
          // Lift shadows toward the palette's lilac instead of black.
          color = mix(uLift, color, 0.93 + 0.07 * smoothstep(0.0, 0.6, luma));
          // Soft pastel: pull contrast in a touch, keep saturation.
          color = mix(vec3(luma), color, 1.08);
          color = mix(color, vec3(0.5), 0.05);
          // Chord mood: warm on major, cool on minor. Subtle.
          vec3 warm = vec3(1.04, 1.0, 0.94);
          vec3 cool = vec3(0.95, 0.99, 1.06);
          color *= mix(vec3(1.0), uMood > 0.0 ? warm : cool, abs(uMood));

          // Light leak / haze glow from the sun side of the sky.
          vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
          float leak = 1.0 - smoothstep(0.0, 1.35, length((vUv - uLeakPos) * aspect));
          color += uLeak * leak * (0.3 - 0.2 * uNight);

          // Beat pulse: a whisper of exposure on the kick.
          color *= 1.0 + uPulse * 0.025;

          // Vignette, tinted.
          float vig = smoothstep(1.25, 0.35, length((vUv - 0.5) * aspect * vec2(0.9, 1.1)));
          color = mix(color * mix(vec3(1.0), uLift * 1.6, 0.2), color, vig);

          // Paper grain, stepped at 12fps so it feels like film, not static.
          float t = floor(uTime * 12.0);
          float grain = hash(vUv * uResolution + t * 17.0) - 0.5;
          float paper = hash(floor(vUv * uResolution / 2.0)) - 0.5;
          color += grain * 0.035 + paper * 0.02;

          gl_FragColor = vec4(max(color, 0.0), 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.uniforms.tColor.value = this.target.texture;
    this.uniforms.tDepth.value = depth;

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.setSize(width, height);
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
    this.uniforms.uResolution.value.set(width, height);
  }

  update(camera: THREE.PerspectiveCamera, p: ResolvedPalette, time: number) {
    const u = this.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uTime.value = time;
    u.uLift.value.copy(p.shadowLift);
    u.uLeak.value.copy(p.sun);
    u.uNight.value = p.nightness;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
