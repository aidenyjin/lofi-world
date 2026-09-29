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
  const size = 1024;
  const [c, g] = canvas(size, size);
  const rng = new Rng(seed);
  g.fillStyle = '#f4f0ec';
  g.fillRect(0, 0, size, size);
  // Broad washes, drawn with wrap-around so the texture tiles.
  for (let i = 0; i < 900; i++) {
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
// Hand-painted-looking shop and billboard signs.

const SIGN_A = ['SUNSET', 'MOON', 'HONEY', 'LUCKY', 'SLOW', 'PEACH', 'CLOUD', 'VELVET', 'OLD PORT', 'MINT', 'PAPER', 'SLEEPY'];
const SIGN_B = ['RECORDS', 'NOODLES', 'COFFEE', 'BAKERY', 'LAUNDRY', 'BOOKS', 'VINYL', 'TEA HOUSE', 'ARCADE', 'SALVAGE', 'RAMEN', 'FLOWERS', 'RADIO'];
const SIGN_BG = ['#e9786f', '#f6b94f', '#8a7fd0', '#6fa7e0', '#f28fb0', '#57b39a', '#d96a58'];

export type UVRect = [number, number, number, number];

export interface SignAtlas {
  tex: THREE.CanvasTexture;
  /** 4:1 shop signs and billboards. */
  wide: UVRect[];
  /** 1:4 vertical neon blade signs. */
  tall: UVRect[];
  /** 2:1 small shopfront boards. */
  small: UVRect[];
  /** Chinatown: 1:4 vertical signs and 4:1 gold-on-red boards. */
  cjkTall: UVRect[];
  cjkWide: UVRect[];
  /** 1:1 painted murals for the arts district. */
  murals: UVRect[];
}

const NEON_WORDS = ['HOTEL', 'BAR', 'RAMEN', 'JAZZ', 'CAFE', 'VINYL', 'BOOKS', 'NOODLE', 'LOFI', 'TEA', 'DINER', 'RADIO'];
const NEON_COLORS = ['#ff8fb1', '#8fe3ff', '#ffe08a', '#b6a2ff', '#9dffc8', '#ffb38a'];
const SMALL_WORDS = ['OPEN', 'FRUIT', 'FLOWERS', 'BREAD', 'PHO', 'TOYS', 'PLANTS', 'MILK', 'FISH', 'CAMERA', 'TAILOR', 'SOUP'];

let atlas: SignAtlas | null = null;

/**
 * Every sign in the city comes from one shared 2048px canvas so chunks never
 * allocate textures of their own. Layout: rows 0-3 hold 16 wide signs (4 per
 * row), the right-hand strip holds 12 vertical neon blades, and the bottom
 * band holds 16 small shop boards.
 */
export function signAtlas(): SignAtlas {
  if (atlas) return atlas;
  const S = 2048;
  const SH = 4096;
  const [c, g] = canvas(S, SH);
  const rng = new Rng(4242);
  const font = (px: number) => `900 ${px}px "Arial Black", "Trebuchet MS", sans-serif`;
  const wide: UVRect[] = [];
  const tall: UVRect[] = [];
  const small: UVRect[] = [];
  const toUV = (x: number, y: number, w: number, h: number): UVRect => [x / S, 1 - (y + h) / SH, (x + w) / S, 1 - y / SH];

  // Wide signs: 4 x 4 grid of 384x96 in the left 1536px, top 512px... scaled x1.33.
  const WW = 384, WH = 96;
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 4; col++) {
      const x = col * WW, y = r * (WH + 32);
      g.fillStyle = rng.pick(SIGN_BG);
      g.fillRect(x, y, WW, WH);
      if (rng.chance(0.4)) {
        const grad = g.createLinearGradient(0, y, 0, y + WH);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, 'rgba(255,214,120,0.55)');
        g.fillStyle = grad;
        g.fillRect(x, y, WW, WH);
      }
      g.strokeStyle = INK;
      g.lineWidth = 8;
      g.strokeRect(x + 4, y + 4, WW - 8, WH - 8);
      g.fillStyle = '#fff4df';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const text = `${rng.pick(SIGN_A)} ${rng.pick(SIGN_B)}`;
      fitText(g, text, WW - 30, 48, font);
      g.fillText(text, x + WW / 2, y + WH / 2 + 3);
      wide.push(toUV(x, y, WW, WH));
    }
  }

  // Neon blades: 12 of 96x384 across the right side.
  const TW = 96, TH = 384;
  for (let i = 0; i < 12; i++) {
    const x = 1560 + (i % 4) * (TW + 26);
    const y = Math.floor(i / 4) * (TH + 40);
    const glow = NEON_COLORS[i % NEON_COLORS.length];
    g.fillStyle = '#3b2a45';
    g.fillRect(x, y, TW, TH);
    g.strokeStyle = glow;
    g.lineWidth = 6;
    g.strokeRect(x + 8, y + 8, TW - 16, TH - 16);
    const word = NEON_WORDS[i];
    g.fillStyle = glow;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const px = Math.min(64, (TH - 40) / word.length);
    g.font = font(px);
    g.shadowColor = glow;
    g.shadowBlur = 14;
    [...word].forEach((ch, k) => g.fillText(ch, x + TW / 2, y + 24 + px * 0.55 + k * ((TH - 48) / word.length)));
    g.shadowBlur = 0;
    tall.push(toUV(x, y, TW, TH));
  }

  // Small boards: 16 of 192x96 along the bottom.
  const BW = 192, BH = 96;
  for (let i = 0; i < 16; i++) {
    const x = (i % 8) * (BW + 12);
    const y = 1300 + Math.floor(i / 8) * (BH + 24);
    g.fillStyle = rng.pick(['#fff1d6', '#f6e1b8', '#e6f0ff', '#ffe3ea']);
    g.fillRect(x, y, BW, BH);
    g.strokeStyle = INK;
    g.lineWidth = 6;
    g.strokeRect(x + 3, y + 3, BW - 6, BH - 6);
    g.fillStyle = rng.pick(['#d96a58', '#5b6fb0', '#57907a', '#a0588a']);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const word = SMALL_WORDS[i % SMALL_WORDS.length];
    fitText(g, word, BW - 24, 44, font);
    g.fillText(word, x + BW / 2, y + BH / 2 + 3);
    small.push(toUV(x, y, BW, BH));
  }

  // --- Chinatown signs (bottom half of the atlas) -------------------------
  const cjkTall: UVRect[] = [];
  const cjkWide: UVRect[] = [];
  const TALL_WORDS = ['中華街', '麵館', '茶室', '福', '龍門', '書店', '花屋', '食堂'];
  const WIDE_WORDS = ['中華街', '龍鳳茶樓', '福記麵家', '金月餅店', '平安藥房', '明星唱片', '好運餃子', '茶'];
  const cjkFont = (px: number) => `900 ${px}px "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Hiragino Sans", sans-serif`;
  for (let i = 0; i < 8; i++) {
    const x = (i % 8) * 250 + 20;
    const y = 2100;
    const w = 110, h = 440;
    g.fillStyle = i % 2 ? '#b8463f' : '#2f6b56';
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#f4c95d';
    g.lineWidth = 8;
    g.strokeRect(x + 7, y + 7, w - 14, h - 14);
    g.fillStyle = '#f4c95d';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const word = TALL_WORDS[i];
    const px = Math.min(84, (h - 60) / word.length);
    g.font = cjkFont(px);
    [...word].forEach((ch, k) => g.fillText(ch, x + w / 2, y + 30 + px * 0.6 + k * ((h - 60) / word.length)));
    cjkTall.push(toUV(x, y, w, h));
  }
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * 500 + 12;
    const y = 2600 + Math.floor(i / 4) * 150;
    const w = 470, h = 118;
    g.fillStyle = '#b8463f';
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#f4c95d';
    g.lineWidth = 8;
    g.strokeRect(x + 6, y + 6, w - 12, h - 12);
    g.fillStyle = '#f4c95d';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const word = WIDE_WORDS[i];
    g.font = cjkFont(Math.min(80, (w - 60) / word.length));
    g.fillText(word, x + w / 2, y + h / 2 + 4);
    cjkWide.push(toUV(x, y, w, h));
  }

  // --- Murals: bold painted scenes for gable walls --------------------------
  const murals: UVRect[] = [];
  for (let i = 0; i < 6; i++) {
    const x = (i % 3) * 680 + 10;
    const y = 2920 + Math.floor(i / 3) * 580;
    const M = 560;
    paintMural(g, x, y, M, new Rng(900 + i), i);
    murals.push(toUV(x, y, M, M));
  }

  const tex = toTexture(c);
  tex.anisotropy = 16;
  atlas = { tex, wide, tall, small, cjkTall, cjkWide, murals };
  return atlas;
}

/** A bold, flat mural: sunsets, waves, a big cat, plants, a record, a moon. */
function paintMural(g: CanvasRenderingContext2D, x: number, y: number, M: number, rng: Rng, kind: number) {
  const pal = ['#f28fb0', '#8fd1b5', '#f6c453', '#7fb3e8', '#b99ae0', '#f5a25d', '#e9786f', '#fff1d6', '#3b2a3a'];
  g.save();
  g.beginPath();
  g.rect(x, y, M, M);
  g.clip();
  g.fillStyle = rng.pick(pal);
  g.fillRect(x, y, M, M);
  const cx = x + M / 2, cy = y + M / 2;
  switch (kind % 6) {
    case 0: // sunset stripes and a sun
      for (let k = 0; k < 7; k++) {
        g.fillStyle = pal[(k + 2) % 7];
        g.fillRect(x, y + M * 0.5 + k * M * 0.07, M, M * 0.07);
      }
      g.fillStyle = '#f6c453';
      g.beginPath();
      g.arc(cx, y + M * 0.5, M * 0.28, Math.PI, 0);
      g.fill();
      break;
    case 1: // waves
      for (let k = 0; k < 9; k++) {
        g.strokeStyle = pal[k % 5 + 1];
        g.lineWidth = M * 0.045;
        g.beginPath();
        for (let t = 0; t <= M; t += 8) g.lineTo(x + t, y + M * 0.1 + k * M * 0.1 + Math.sin(t / M * 12 + k) * M * 0.03);
        g.stroke();
      }
      break;
    case 2: // a big sleepy cat face
      g.fillStyle = '#f5a25d';
      g.beginPath();
      g.arc(cx, cy + M * 0.08, M * 0.32, 0, Math.PI * 2);
      g.moveTo(cx - M * 0.3, cy - M * 0.05);
      g.lineTo(cx - M * 0.22, cy - M * 0.38);
      g.lineTo(cx - M * 0.05, cy - M * 0.2);
      g.moveTo(cx + M * 0.3, cy - M * 0.05);
      g.lineTo(cx + M * 0.22, cy - M * 0.38);
      g.lineTo(cx + M * 0.05, cy - M * 0.2);
      g.fill();
      g.strokeStyle = '#3b2a3a';
      g.lineWidth = M * 0.025;
      g.beginPath();
      g.arc(cx - M * 0.12, cy + M * 0.05, M * 0.06, 0.2, Math.PI - 0.2);
      g.moveTo(cx + M * 0.18, cy + M * 0.05);
      g.arc(cx + M * 0.12, cy + M * 0.05, M * 0.06, 0.2, Math.PI - 0.2);
      g.stroke();
      break;
    case 3: // monstera leaves
      for (let k = 0; k < 7; k++) {
        g.fillStyle = k % 2 ? '#57b39a' : '#8fd1b5';
        g.beginPath();
        g.ellipse(x + rng.range(0, M), y + rng.range(0, M), M * 0.22, M * 0.1, rng.range(0, 3), 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 4: // a vinyl record
      g.fillStyle = '#3b2a3a';
      g.beginPath();
      g.arc(cx, cy, M * 0.36, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#5a4a5a';
      g.lineWidth = 3;
      for (let r = 0.12; r < 0.35; r += 0.03) {
        g.beginPath();
        g.arc(cx, cy, M * r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#f28fb0';
      g.beginPath();
      g.arc(cx, cy, M * 0.1, 0, Math.PI * 2);
      g.fill();
      break;
    default: // moon and stars
      g.fillStyle = '#2f3550';
      g.fillRect(x, y, M, M);
      g.fillStyle = '#fff1d6';
      g.beginPath();
      g.arc(cx + M * 0.1, cy - M * 0.05, M * 0.25, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2f3550';
      g.beginPath();
      g.arc(cx + M * 0.2, cy - M * 0.12, M * 0.22, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f6c453';
      for (let k = 0; k < 30; k++) g.fillRect(x + rng.range(0, M), y + rng.range(0, M), 6, 6);
  }
  // Painted border and a little brush texture
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  for (let k = 0; k < 60; k++) {
    g.lineWidth = rng.range(2, 8);
    g.beginPath();
    const sx = x + rng.range(0, M), sy = y + rng.range(0, M);
    g.moveTo(sx, sy);
    g.lineTo(sx + rng.range(-40, 40), sy + rng.range(-10, 10));
    g.stroke();
  }
  g.restore();
}

/** Soft radial glow for lamp light pools and water reflections. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

/** Painterly puff for chimney smoke and fountain spray. */
export function puffTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const rng = new Rng(9);
  for (let i = 0; i < 7; i++) {
    const x = 32 + rng.range(-10, 10), y = 32 + rng.range(-10, 10), r = rng.range(10, 20);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return toTexture(c);
}

function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, px: number, font: (px: number) => string) {
  g.font = font(px);
  while (g.measureText(text).width > maxW && px > 12) {
    px -= 2;
    g.font = font(px);
  }
}
