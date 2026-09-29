import type { Mood } from '../events';
import type { Rng } from '../rng';

// Jazz-ish harmony for lofi: 7th/9th/13th chords, rootless voicings,
// and simple voice leading so chord changes glide instead of jump.

export type Quality = 'maj9' | 'maj7' | 'm9' | 'm7' | 'm11' | '9' | '13' | '9sus' | '7';

const VOICINGS: Record<Quality, number[]> = {
  maj9: [4, 7, 11, 14],
  maj7: [0, 4, 7, 11],
  m9: [3, 7, 10, 14],
  m7: [0, 3, 7, 10],
  m11: [3, 10, 14, 17],
  '9': [4, 7, 10, 14],
  '13': [4, 10, 14, 21],
  '9sus': [5, 10, 14, 19],
  '7': [0, 4, 7, 10],
};

const LABEL: Record<Quality, string> = {
  maj9: 'maj9', maj7: 'maj7', m9: 'm9', m7: 'm7', m11: 'm11', '9': '9', '13': '13', '9sus': '9sus4', '7': '7',
};

export interface Chord {
  root: number; // semitones above the key
  q: Quality;
  beats: number;
}

// Each progression totals 16 beats (four bars).
export const PROGRESSIONS: Chord[][] = [
  // ii – V – I – vi
  [{ root: 2, q: 'm9', beats: 4 }, { root: 7, q: '13', beats: 4 }, { root: 0, q: 'maj9', beats: 4 }, { root: 9, q: 'm9', beats: 4 }],
  // I – vi – ii – Vsus
  [{ root: 0, q: 'maj7', beats: 4 }, { root: 9, q: 'm7', beats: 4 }, { root: 2, q: 'm9', beats: 4 }, { root: 7, q: '9sus', beats: 4 }],
  // IV – III7 – vi – v/I7  ("Just the two of us")
  [{ root: 5, q: 'maj9', beats: 4 }, { root: 4, q: '9', beats: 4 }, { root: 9, q: 'm9', beats: 4 }, { root: 7, q: 'm7', beats: 2 }, { root: 0, q: '9', beats: 2 }],
  // vi – IV – I – Vsus
  [{ root: 9, q: 'm9', beats: 4 }, { root: 5, q: 'maj9', beats: 4 }, { root: 0, q: 'maj9', beats: 4 }, { root: 7, q: '9sus', beats: 4 }],
  // iii – vi – ii – V
  [{ root: 4, q: 'm7', beats: 4 }, { root: 9, q: 'm9', beats: 4 }, { root: 2, q: 'm11', beats: 4 }, { root: 7, q: '13', beats: 4 }],
  // I – I – IV – iv  (the borrowed minor iv, instant nostalgia)
  [{ root: 0, q: 'maj9', beats: 4 }, { root: 0, q: 'maj7', beats: 4 }, { root: 5, q: 'maj9', beats: 4 }, { root: 5, q: 'm9', beats: 4 }],
];

const NOTE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export function chordName(key: number, c: Chord): string {
  return NOTE_NAMES[(((key + c.root) % 12) + 12) % 12] + LABEL[c.q];
}

export function chordMood(c: Chord): Mood {
  return c.q.startsWith('m') ? 'cool' : 'warm';
}

/**
 * Voice the chord near the previous one. Returns MIDI note numbers.
 * `center` tracks the average pitch of the last voicing.
 */
export function voice(key: number, c: Chord, center: number): number[] {
  const root = 48 + key + c.root;
  return VOICINGS[c.q]
    .map((iv) => {
      let n = root + iv;
      while (n < center - 7) n += 12;
      while (n > center + 7) n -= 12;
      return n;
    })
    .sort((a, b) => a - b)
    .filter((n, i, arr) => i === 0 || n !== arr[i - 1]);
}

export function bassNote(key: number, c: Chord): number {
  let n = 36 + key + c.root;
  while (n > 45) n -= 12;
  return n;
}

/** Chord tones + 9th in a singing register, for melody fragments. */
export function melodyPool(key: number, c: Chord): number[] {
  const root = 60 + key + c.root;
  const tones = VOICINGS[c.q].map((iv) => root + (iv % 12));
  const pool = tones.flatMap((n) => [n, n + 12]).filter((n) => n >= 62 && n <= 81);
  return pool.length ? pool : [root + 12];
}

export function pickProgression(rng: Rng, avoid?: number): number {
  let i = rng.int(0, PROGRESSIONS.length - 1);
  if (i === avoid) i = (i + 1) % PROGRESSIONS.length;
  return i;
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
