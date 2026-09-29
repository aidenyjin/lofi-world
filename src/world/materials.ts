import * as THREE from 'three';
import { INK, type ResolvedPalette } from '../palette';
import { brushTexture, toonGradient, blobShadowTexture, leafTexture } from './textures';

// Shared materials. Everything that reacts to time of day or to the music
// is updated in one place (`update`) so chunks never need to know about it.

const WINDOW_DAY = new THREE.Color('#5d6a9c');
const WINDOW_GLOW = new THREE.Color('#ffd98a');
const BULB_DAY = new THREE.Color('#fff2cf');
const BULB_NIGHT = new THREE.Color('#ffcf73');

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

  /** Flat cut-outs (sprites, signs) multiply by this each frame. */
  readonly spriteTint = new THREE.Color('#ffffff');
  private readonly tinted = new Set<THREE.Material & { color: THREE.Color }>();

  private spriteMats = new Map<THREE.Texture, THREE.SpriteMaterial>();

  constructor() {
    const g = this.gradient;
    g.colorSpace = THREE.NoColorSpace;
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

  update(p: ResolvedPalette, beatPulse: number): void {
    const n = p.nightness;
    this.spriteTint.copy(p.spriteTint);
    for (const m of this.tinted) m.color.copy(this.spriteTint);

    // Glass picks up the sky by day; lit windows glow warmer as night falls.
    this.windowDark.color.copy(WINDOW_DAY).lerp(p.skyTop, 0.35).multiplyScalar(1 - 0.45 * n);
    this.windowLit.color.copy(this.windowDark.color).lerp(WINDOW_GLOW, Math.min(1, n * 1.15));

    // String-light bulbs: soft by day, warm and breathing with the beat at night.
    this.bulb.color.copy(BULB_DAY).lerp(BULB_NIGHT, n).multiplyScalar(0.9 + n * (0.35 + 0.35 * beatPulse));

    this.leaf.color.copy(p.spriteTint);
    this.ink.color.set(INK).lerp(p.shadowLift, 0.15);
  }
}
