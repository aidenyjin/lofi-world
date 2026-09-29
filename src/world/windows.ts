import * as THREE from 'three';
import type { ResolvedPalette } from '../palette';

/**
 * Window glass with a room behind it.
 *
 * Every pane is a flat quad, but the fragment shader ray-casts into an
 * imaginary box room behind the glass ("interior mapping"): back wall, side
 * walls, floor and ceiling with furniture silhouettes and a hanging lamp, all
 * with real parallax as the camera glides past. On top sits the glass itself:
 * a Fresnel reflection of the sky, a sun glint the bloom picks up, and a
 * painterly diagonal sheen.
 *
 * Per-window data rides in the vertex colour: r = random seed,
 * g = 0 dark / 0.5 TV / 1 lit, b = 0 flat window / 1 shop display.
 */
export function windowColor(seed: number, state: 'dark' | 'tv' | 'lit', shop = false): THREE.Color {
  return new THREE.Color(seed, state === 'dark' ? 0 : state === 'tv' ? 0.5 : 1, shop ? 1 : 0);
}

export class WindowMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      fog: true,
      vertexColors: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uSkyTop: { value: new THREE.Color() },
          uSkyBottom: { value: new THREE.Color() },
          uSun: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uNight: { value: 0 },
          uPulse: { value: 0 },
          uFrame: { value: new THREE.Color('#fff1d6') },
        },
      ]),
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vN;
        varying vec3 vT;
        varying vec3 vData;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vData = color;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          // Tangent follows the quad's u direction in object space, then goes
          // through the model matrix so mirrored chunks stay consistent.
          vec3 tObj = normalize(cross(vec3(0.0, 1.0, 0.0), normal));
          vT = normalize(mat3(modelMatrix) * tObj);
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime, uNight, uPulse;
        uniform vec3 uSkyTop, uSkyBottom, uSun, uSunDir, uFrame;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vN;
        varying vec3 vT;
        varying vec3 vData;

        float h11(float x) { return fract(sin(x * 91.345) * 47453.5453); }
        vec3 pastel(float s) {
          vec3 a = vec3(0.98, 0.72, 0.60); // peach
          vec3 b = vec3(0.76, 0.66, 0.95); // lilac
          vec3 c = vec3(0.62, 0.86, 0.74); // sage
          vec3 d = vec3(1.0, 0.86, 0.56); // butter
          vec3 e = vec3(0.62, 0.78, 0.98); // sky
          float k = fract(s * 5.0);
          return k < 0.2 ? a : k < 0.4 ? b : k < 0.6 ? c : k < 0.8 ? d : e;
        }

        void main() {
          float seed = vData.r;
          float state = vData.g; // 0 dark, 0.5 tv, 1 lit
          float shop = vData.b;
          vec3 N = normalize(vN);
          vec3 T = normalize(vT);
          vec3 B = vec3(0.0, 1.0, 0.0);
          vec3 V = normalize(vWorld - cameraPosition);

          // ---- Interior: ray-cast a unit room (x, y in [0,1], depth z in [0,1])
          vec2 winSize = shop > 0.5 ? vec2(3.0, 1.45) : vec2(0.85, 1.25);
          float depth = shop > 0.5 ? 2.6 : 2.2;
          vec3 r = vec3(dot(V, T) / winSize.x, dot(V, B) / winSize.y, -dot(V, N) / depth);
          vec3 p = vec3(vUv, 0.0);
          vec3 tAxis = vec3(
            r.x > 0.0 ? (1.0 - p.x) / r.x : -p.x / r.x,
            r.y > 0.0 ? (1.0 - p.y) / r.y : -p.y / r.y,
            (1.0 - p.z) / max(r.z, 1e-4)
          );
          float t = min(min(tAxis.x, tAxis.y), tAxis.z);
          vec3 hit = p + r * t;

          vec3 wall = pastel(seed);
          vec3 room;
          float shadeK;
          if (t == tAxis.z) {
            // Back wall: a picture, a shelf, a sofa or a plant silhouette.
            room = wall;
            vec2 q = hit.xy;
            float pic = step(abs(q.x - (0.3 + 0.4 * h11(seed * 13.0))), 0.12) * step(abs(q.y - 0.62), 0.1);
            room = mix(room, pastel(seed + 0.37) * 0.8, pic);
            float sofa = step(q.y, 0.3) * step(0.12, q.y) * step(abs(q.x - 0.5), 0.32) * step(0.4, h11(seed * 7.0));
            room = mix(room, pastel(seed + 0.61) * 0.7, sofa);
            float shelf = step(abs(q.y - 0.45), 0.015) * step(0.5, h11(seed * 3.0));
            room = mix(room, vec3(0.45, 0.33, 0.3), shelf);
            shadeK = 0.9;
          } else if (t == tAxis.y) {
            if (r.y < 0.0) {
              // Floor boards
              float plank = step(0.92, fract(hit.x * 6.0));
              room = mix(vec3(0.72, 0.52, 0.40), vec3(0.55, 0.38, 0.3), plank);
              shadeK = 0.8;
            } else {
              room = mix(wall, vec3(1.0), 0.6); // ceiling
              shadeK = 1.0;
            }
          } else {
            room = wall * 0.85; // side walls
            // A tall plant or lamp on one side in some rooms
            float plant = step(0.6, h11(seed * 11.0)) * step(hit.y, 0.55) * step(abs(hit.z - 0.6), 0.12);
            room = mix(room, vec3(0.45, 0.62, 0.42), plant);
            shadeK = 0.75;
          }
          // Depth darkening (ambient occlusion toward the back and corners).
          float corner = min(min(hit.x, 1.0 - hit.x), min(hit.y, 1.0 - hit.y));
          room *= shadeK * mix(0.7, 1.0, smoothstep(0.0, 0.18, corner)) * mix(1.0, 0.75, hit.z);

          // Lighting: a warm hanging lamp at night; dim daylight otherwise.
          vec3 lampPos = vec3(0.5, 0.88, 0.45);
          float lampFall = 1.0 / (1.0 + 6.0 * dot(hit - lampPos, hit - lampPos));
          vec3 warm = vec3(1.0, 0.8, 0.55);
          vec3 lit = room * (0.32 + 0.95 * lampFall) * warm;
          vec3 dayRoom = room * 0.72 * vec3(1.0, 0.95, 0.9);
          vec3 darkRoom = room * mix(0.35, 0.06, uNight) * vec3(0.8, 0.85, 1.1);
          vec3 interior;
          if (state > 0.75) {
            interior = mix(dayRoom * 1.1, lit * 1.15, uNight);
            // The lamp shade itself
            vec2 lampUv = vec2(0.5, 0.86);
            float shadeDisc = smoothstep(0.07, 0.05, length((p.xy - lampUv) * vec2(1.0, 1.4) - r.xy * 0.3));
            interior += warm * shadeDisc * (0.4 + 1.2 * uNight);
          } else if (state > 0.25) {
            float flick = 0.7 + 0.3 * sin(uTime * 13.0 + seed * 40.0) * sin(uTime * 3.7 + seed);
            vec3 tv = vec3(0.55, 0.72, 1.0) * flick;
            interior = mix(dayRoom, room * tv * 1.3, uNight);
          } else {
            interior = mix(dayRoom * 0.8, darkRoom, uNight);
          }

          // ---- Glass: Fresnel sky reflection, sun glint, painterly sheen
          float cosV = clamp(dot(-V, N), 0.0, 1.0);
          float fres = 0.05 + 0.8 * pow(1.0 - cosV, 4.0);
          vec3 R = reflect(V, N);
          vec3 sky = mix(uSkyBottom, uSkyTop, smoothstep(-0.05, 0.6, R.y));
          float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 180.0);
          float sheen = smoothstep(0.08, 0.0, abs(fract((vUv.x + vUv.y * 0.6) * 0.8 + seed) - 0.5) - 0.08);
          float reflAmt = fres * mix(0.85, 0.35, uNight * step(0.25, state));
          vec3 col = mix(interior, sky, reflAmt);
          col += uSun * glint * 2.5 * (1.0 - uNight);
          col += sky * sheen * 0.12 * (1.0 - 0.6 * uNight);

          // ---- Frame and mullions, drawn so they cast no parallax
          float border = step(min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)), 0.045);
          float mull = shop > 0.5 ? 0.0 : step(abs(vUv.x - 0.5), 0.022) + step(abs(vUv.y - 0.56), 0.02);
          col = mix(col, uFrame * (0.75 + 0.25 * (1.0 - uNight)), clamp(border + mull, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
  }

  update(p: ResolvedPalette, sunDir: THREE.Vector3, time: number, beatPulse: number) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uSkyTop.value.copy(p.skyTop);
    u.uSkyBottom.value.copy(p.skyBottom);
    u.uSun.value.copy(p.sun);
    u.uSunDir.value.copy(sunDir);
    u.uNight.value = p.nightness;
    u.uPulse.value = beatPulse;
    u.uFrame.value.set('#fff1d6').multiplyScalar(1 - 0.6 * p.nightness);
  }
}
