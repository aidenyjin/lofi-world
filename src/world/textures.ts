import * as THREE from 'three';
import { Rng } from '../rng';
import { INK } from '../palette';

// Everything here is drawn at runtime on 2D canvases. These stand in for
// hand-painted art until real sprites arrive; swapping them for PNGs only
// means replacing the texture, not the scene code.

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 3-band ramp for MeshToonMaterial: soft pastel shadows, not black. */
export function toonGradient(): THREE.DataTexture {
  const data = new Uint8Array([188, 188, 188, 255, 228, 228, 228, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Near-white mottled brush strokes; multiplied over vertex colours. */
export function brushTexture(seed = 7): THREE.CanvasTexture {
  const size = 512;
  const [c, g] = canvas(size, size);
  const rng = new Rng(seed);
  g.fillStyle = '#f4f0ec';
  g.fillRect(0, 0, size, size);
  // Broad washes, drawn with wrap-around so the texture tiles.
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(40, 160);
    const w = rng.range(8, 30);
    const ang = rng.range(-0.35, 0.35) + (rng.chance(0.5) ? 0 : Math.PI / 2);
    const light = rng.chance(0.55);
    g.strokeStyle = light ? `rgba(255,255,255,${rng.range(0.15, 0.45)})` : `rgba(200,185,190,${rng.range(0.06, 0.16)})`;
    g.lineWidth = w;
    g.lineCap = 'round';
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
        g.stroke();
      }
    }
  }
  // Fine speckle for paper tooth.
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.next() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A single white leaf with an ink edge; tinted per instance. */
export function leafTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.translate(32, 32);
  g.rotate(-0.6);
  g.beginPath();
  g.moveTo(0, -26);
  g.bezierCurveTo(18, -14, 16, 12, 0, 26);
  g.bezierCurveTo(-16, 12, -18, -14, 0, -26);
  g.fillStyle = '#ffffff';
  g.fill();
  g.strokeStyle = 'rgba(80,40,40,0.55)';
  g.lineWidth = 3;
  g.stroke();
  g.beginPath();
  g.moveTo(0, -20);
  g.lineTo(0, 22);
  g.strokeStyle = 'rgba(120,60,40,0.35)';
  g.lineWidth = 2;
  g.stroke();
  return toTexture(c);
}

/** Soft dark ellipse used as a blob shadow under sprites. */
export function blobShadowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(60,30,70,0.55)');
  grad.addColorStop(1, 'rgba(60,30,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

// ---------------------------------------------------------------------------
// Placeholder characters: chunky Cult-of-the-Lamb-ish animal folk with thick
// ink outlines. Each is drawn once per (species, outfit, pose) and cached.

export type Species = 'bear' | 'bunny' | 'cat' | 'sheep' | 'fox' | 'frog';
export type Pose = 'stand' | 'sit' | 'read' | 'paint';

export const SPECIES: readonly Species[] = ['bear', 'bunny', 'cat', 'sheep', 'fox', 'frog'];
export const POSES: readonly Pose[] = ['stand', 'sit', 'read', 'paint'];

const FUR: Record<Species, string> = {
  bear: '#f7f1ea', bunny: '#f4c6c9', cat: '#f2b36b', sheep: '#fff8f0', fox: '#ee8b52', frog: '#9fd49a',
};
const SHIRTS = ['#e9786f', '#f6c453', '#7fb3e8', '#b99ae0', '#f39bb5', '#8fd1b5', '#f5a25d'];

const spriteCache = new Map<string, THREE.CanvasTexture>();

export function characterTexture(species: Species, pose: Pose, shirt: number): THREE.CanvasTexture {
  const key = `${species}-${pose}-${shirt}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const W = 256;
  const H = 320;
  const [c, g] = canvas(W, H);
  const fur = FUR[species];
  const shirtColor = SHIRTS[shirt % SHIRTS.length];
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = 9;
  g.strokeStyle = INK;

  const blob = (fill: string, path: () => void) => {
    g.beginPath();
    path();
    g.fillStyle = fill;
    g.fill();
    g.stroke();
  };

  const sitting = pose !== 'stand' && pose !== 'paint';
  const baseY = H - 14;
  const bodyTop = sitting ? 170 : 150;
  const cx = W / 2;

  // Legs
  if (sitting) {
    blob('#6d6a8c', () => g.roundRect(cx - 56, baseY - 42, 112, 40, 18));
  } else {
    blob('#6d6a8c', () => g.roundRect(cx - 42, baseY - 70, 34, 70, 14));
    blob('#6d6a8c', () => g.roundRect(cx + 8, baseY - 70, 34, 70, 14));
  }
  // Body / shirt
  blob(shirtColor, () => g.roundRect(cx - 62, bodyTop, 124, (sitting ? baseY - 36 : baseY - 60) - bodyTop, 40));

  // Ears (behind head)
  const headY = bodyTop - 40;
  const earFill = fur;
  switch (species) {
    case 'bear':
      blob(earFill, () => g.arc(cx - 48, headY - 44, 20, 0, Math.PI * 2));
      blob(earFill, () => g.arc(cx + 48, headY - 44, 20, 0, Math.PI * 2));
      break;
    case 'bunny':
      blob(earFill, () => g.ellipse(cx - 26, headY - 92, 16, 52, -0.15, 0, Math.PI * 2));
      blob(earFill, () => g.ellipse(cx + 26, headY - 92, 16, 52, 0.15, 0, Math.PI * 2));
      break;
    case 'cat':
    case 'fox':
      blob(earFill, () => {
        g.moveTo(cx - 62, headY - 10);
        g.lineTo(cx - 48, headY - 82);
        g.lineTo(cx - 12, headY - 50);
        g.closePath();
      });
      blob(earFill, () => {
        g.moveTo(cx + 62, headY - 10);
        g.lineTo(cx + 48, headY - 82);
        g.lineTo(cx + 12, headY - 50);
        g.closePath();
      });
      break;
    case 'sheep':
      blob('#f6cfc4', () => g.ellipse(cx - 66, headY, 24, 12, 0.5, 0, Math.PI * 2));
      blob('#f6cfc4', () => g.ellipse(cx + 66, headY, 24, 12, -0.5, 0, Math.PI * 2));
      break;
    case 'frog':
      blob(earFill, () => g.arc(cx - 36, headY - 48, 24, 0, Math.PI * 2));
      blob(earFill, () => g.arc(cx + 36, headY - 48, 24, 0, Math.PI * 2));
      break;
  }

  // Head
  if (species === 'sheep') {
    // Fluffy cloud head
    g.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.moveTo(cx + Math.cos(a) * 44 + 24, headY + Math.sin(a) * 40);
      g.arc(cx + Math.cos(a) * 44, headY + Math.sin(a) * 40, 24, 0, Math.PI * 2);
    }
    g.fillStyle = fur;
    g.fill();
    g.stroke();
    blob('#f6cfc4', () => g.ellipse(cx, headY + 8, 34, 38, 0, 0, Math.PI * 2));
  } else {
    blob(fur, () => g.ellipse(cx, headY, 64, 56, 0, 0, Math.PI * 2));
  }

  // Face
  const eyeColor = INK;
  g.fillStyle = eyeColor;
  g.beginPath();
  g.arc(cx - 22, headY - 2, 8, 0, Math.PI * 2);
  g.arc(cx + 22, headY - 2, 8, 0, Math.PI * 2);
  g.fill();
  {
    g.fillStyle = species === 'frog' ? '#e98a7e' : '#e46a6a';
    g.beginPath();
    g.ellipse(cx, headY + 18, 9, 6, 0, 0, Math.PI * 2);
    g.fill();
    // Blush
    g.fillStyle = 'rgba(240,110,120,0.35)';
    g.beginPath();
    g.ellipse(cx - 40, headY + 16, 12, 7, 0, 0, Math.PI * 2);
    g.ellipse(cx + 40, headY + 16, 12, 7, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Props
  if (pose === 'read') {
    blob('#f6e6c4', () => {
      g.moveTo(cx - 58, bodyTop + 30);
      g.lineTo(cx, bodyTop + 44);
      g.lineTo(cx + 58, bodyTop + 30);
      g.lineTo(cx + 58, bodyTop + 88);
      g.lineTo(cx, bodyTop + 100);
      g.lineTo(cx - 58, bodyTop + 88);
      g.closePath();
    });
    g.beginPath();
    g.moveTo(cx, bodyTop + 44);
    g.lineTo(cx, bodyTop + 100);
    g.stroke();
  } else if (pose === 'paint') {
    // Wide sun hat
    blob('#f7d45a', () => g.ellipse(cx, headY - 44, 92, 18, 0, 0, Math.PI * 2));
    blob('#f7d45a', () => g.ellipse(cx, headY - 58, 44, 26, 0, Math.PI, Math.PI * 2));
    // Brush arm
    g.beginPath();
    g.moveTo(cx + 50, bodyTop + 30);
    g.lineTo(cx + 104, bodyTop - 20);
    g.stroke();
  } else if (pose === 'sit' && species === 'bear') {
    // Mug
    blob('#fff1d6', () => g.roundRect(cx + 30, bodyTop + 30, 34, 40, 8));
  }

  const tex = toTexture(c);
  spriteCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Hand-painted-looking shop and billboard signs.

const SIGN_A = ['SUNSET', 'MOON', 'HONEY', 'LUCKY', 'SLOW', 'PEACH', 'CLOUD', 'VELVET', 'OLD PORT', 'MINT', 'PAPER', 'SLEEPY'];
const SIGN_B = ['RECORDS', 'NOODLES', 'COFFEE', 'BAKERY', 'LAUNDRY', 'BOOKS', 'VINYL', 'TEA HOUSE', 'ARCADE', 'SALVAGE', 'RAMEN', 'FLOWERS', 'RADIO'];
const SIGN_BG = ['#e9786f', '#f6b94f', '#8a7fd0', '#6fa7e0', '#f28fb0', '#57b39a', '#d96a58'];

export function signTexture(rng: Rng): { tex: THREE.CanvasTexture; aspect: number } {
  const stacked = rng.chance(0.35);
  const W = stacked ? 256 : 512;
  const H = stacked ? 320 : 160;
  const [c, g] = canvas(W, H);
  const bg = rng.pick(SIGN_BG);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // Faded sunset band like the "SUNSET SALVAGE" billboard.
  if (rng.chance(0.4)) {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,214,120,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = INK;
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  g.fillStyle = '#fff4df';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const a = rng.pick(SIGN_A);
  const b = rng.pick(SIGN_B);
  const font = (px: number) => `900 ${px}px "Arial Black", "Trebuchet MS", sans-serif`;
  if (stacked) {
    g.font = font(52);
    fitText(g, a, W - 30, 52, font);
    g.fillText(a, W / 2, H * 0.36);
    fitText(g, b, W - 30, 52, font);
    g.fillText(b, W / 2, H * 0.64);
  } else {
    const text = `${a} ${b}`;
    fitText(g, text, W - 40, 70, font);
    g.fillText(text, W / 2, H / 2 + 4);
  }
  return { tex: toTexture(c), aspect: W / H };
}

function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, px: number, font: (px: number) => string) {
  g.font = font(px);
  while (g.measureText(text).width > maxW && px > 12) {
    px -= 2;
    g.font = font(px);
  }
}
