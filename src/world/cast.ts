import * as THREE from 'three';

// The rooftop residents: hand-painted gouache cut-outs generated with
// Krea 2 Turbo + the "bold gouache urban sketch" LoRA (see tools/sprites).
// Only these two match the target style so far; more are coming.
// Sizes are the cut-out PNG dimensions so aspect ratios are known up front.

export type Pose = 'stand' | 'sit';

export interface CastMember {
  id: string;
  pose: Pose;
  width: number;
  height: number;
  /** Height in world units (a building floor is 2.6). */
  worldHeight: number;
  /** How much they groove on the beat (readers and painters bob less). */
  bounce: number;
}

export const CAST: readonly CastMember[] = [
  { id: 'bear-read', pose: 'sit', width: 449, height: 512, worldHeight: 3.0, bounce: 0.45 },
  { id: 'bunny-paint', pose: 'stand', width: 429, height: 512, worldHeight: 3.3, bounce: 0.5 },
];

const loader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();

/** Shared texture per cast member; loads lazily and pops in when ready. */
export function castTexture(member: CastMember): THREE.Texture {
  let tex = textures.get(member.id);
  if (!tex) {
    tex = loader.load(`${import.meta.env.BASE_URL}sprites/${member.id}.webp`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textures.set(member.id, tex);
  }
  return tex;
}
