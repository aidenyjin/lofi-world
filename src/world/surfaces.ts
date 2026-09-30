/** Surface types for procedural texture detail (see materials.ts). */
export const Surf = {
  Plain: 0,
  Plaster: 1,
  Brick: 2,
  Stone: 3,
  Wood: 4,
  Gravel: 5,
  Asphalt: 6,
  Paving: 7,
  Foliage: 8,
  Tiles: 9,
  Bark: 10,
  Grass: 11,
} as const;

// Painted procedural detail, applied in world space by the toon shader.
export const SURFACE_GLSL = /* glsl */ `
  float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1, 0)), u.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), u.x), u.y);
  }
  float sFbm(vec2 p) { return 0.5 * sNoise(p) + 0.3 * sNoise(p * 2.1 + 7.3) + 0.2 * sNoise(p * 4.3 - 3.1); }

  vec3 surfaceDetailRaw(float sid, vec3 p, vec3 n, vec3 c) {
    int id = int(sid + 0.5);
    if (id == 0) return c;
    vec3 an = abs(n);
    bool top = an.y > 0.6;
    vec2 uv = top ? p.xz : (an.x > an.z ? p.zy : p.xy);
    // Walls darken a little toward the pavement, like weathered paint.
    float grime = top ? 1.0 : 1.0 - 0.13 * (1.0 - smoothstep(0.2, 1.8, p.y));
    if (id == 1) { // plaster: soft washes, fine brush, rain streaks
      float m = sFbm(uv * 0.45);
      float f = sNoise(uv * 7.0);
      c *= 0.9 + 0.17 * m + 0.05 * (f - 0.5);
      float streak = sNoise(vec2(uv.x * 2.4, uv.y * 0.22));
      if (!top) c *= 1.0 - 0.08 * smoothstep(0.6, 0.92, streak);
      return c * grime;
    }
    if (id == 2) { // brick courses with mortar
      if (top) return c * (0.9 + 0.1 * sNoise(uv * 3.0));
      vec2 b = uv * vec2(1.0 / 0.52, 1.0 / 0.24);
      float row = floor(b.y);
      b.x += mod(row, 2.0) * 0.5;
      vec2 f = fract(b);
      float mortar = clamp(step(f.x, 0.07) + step(f.y, 0.12), 0.0, 1.0);
      vec3 bc = c * (0.78 + 0.36 * sHash(floor(b))) * (0.94 + 0.12 * sNoise(uv * 9.0));
      return mix(bc, vec3(0.88, 0.83, 0.79), mortar * 0.85) * grime;
    }
    if (id == 3) { // dressed stone blocks with bevelled edges
      vec2 b = uv * vec2(1.0 / 1.1, 1.0 / 0.52);
      b.x += mod(floor(b.y), 2.0) * 0.37;
      vec2 f = fract(b);
      float edge = smoothstep(0.0, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
      return c * (0.84 + 0.14 * sHash(floor(b)) + 0.1 * sNoise(uv * 4.0)) * (0.78 + 0.22 * edge) * grime;
    }
    if (id == 4) { // wood planks and grain
      vec2 w = an.x > an.z || top ? uv : uv.yx;
      float grain = sNoise(vec2(w.x * 0.9, w.y * 16.0));
      float gap = step(0.92, fract(w.y * 4.5));
      return c * (0.84 + 0.22 * grain) * (1.0 - 0.28 * gap);
    }
    if (id == 5) { // roof gravel and felt
      return c * (0.87 + 0.1 * sHash(floor(uv * 16.0)) + 0.1 * sFbm(uv * 0.6));
    }
    if (id == 6) { // asphalt: speckle, patches, cracks
      float crack = smoothstep(0.025, 0.0, abs(sNoise(uv * 1.3) - 0.5)) * step(0.55, sNoise(uv * 0.35 + 4.0));
      return c * (0.84 + 0.12 * sHash(floor(uv * 24.0)) + 0.16 * sFbm(uv * 0.3)) * (1.0 - 0.3 * crack);
    }
    if (id == 7) { // paving slabs
      vec2 b = uv / 0.75;
      vec2 f = fract(b);
      float gap = step(min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)), 0.045);
      return c * (0.9 + 0.12 * sHash(floor(b)) + 0.07 * sNoise(uv * 5.0)) * (1.0 - 0.2 * gap);
    }
    if (id == 8) { // foliage: dappled leaf clusters, lighter on top; turns autumn orange at sunset
      float cl = sFbm(p.xz * 2.3 + p.y * 1.9);
      return c * (0.82 + 0.34 * smoothstep(0.35, 0.72, cl) + 0.16 * max(n.y, 0.0));
    }
    if (id == 9) { // clay / glazed roof tiles
      float rows = fract(uv.y * 3.4);
      float arc = sin(uv.x * 11.0) * 0.5 + 0.5;
      return c * (0.78 + 0.26 * smoothstep(0.0, 0.75, rows)) * (0.9 + 0.12 * arc);
    }
    if (id == 10) { // bark
      return c * (0.78 + 0.32 * sNoise(vec2((p.x + p.z) * 7.0, p.y * 2.0)));
    }
    if (id == 11) { // grass
      return c * (0.84 + 0.2 * sFbm(p.xz * 0.8) + 0.08 * sHash(floor(p.xz * 20.0)));
    }
    return c;
  }

  // Autumn: green leaves turn orange and gold (blossom stays pink). Runs on the
  // final colour, after the vertex colour is applied.
  vec3 autumnShift(vec3 c, vec3 p) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float pick = sHash(floor(p.xz * 0.7) + floor(p.y * 0.5));
    vec3 fall = mix(vec3(0.97, 0.58, 0.27), vec3(0.99, 0.76, 0.33), pick) * (0.55 + 0.7 * l);
    float green = smoothstep(0.02, 0.12, c.g - max(c.r, c.b));
    return mix(c, fall, uAutumn * green);
  }

  // Gouache finish over everything: the patterns above are softened to a hint,
  // then big soft washes and dry-brush streaks give flat colour a painted grain.
  vec3 surfaceDetail(float sid, vec3 p, vec3 n, vec3 c) {
    vec3 r = surfaceDetailRaw(sid, p, n, c);
    int id = int(sid + 0.5);
    if (id != 8 && id != 0) r = mix(c, r, 0.5);
    vec3 an = abs(n);
    vec2 uv = an.y > 0.6 ? p.xz : (an.x > an.z ? p.zy : p.xy);
    float wash = sFbm(uv * 0.18 + 11.0);
    float dry = sNoise(vec2(uv.x * 0.7 + uv.y * 0.15, uv.y * 7.0));
    r *= 0.95 + 0.09 * wash;
    r *= 1.0 + 0.045 * smoothstep(0.55, 0.9, dry) - 0.03 * smoothstep(0.45, 0.1, dry);
    return r;
  }
`;
