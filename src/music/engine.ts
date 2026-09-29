import * as Tone from 'tone';
import { bus, type SectionName } from '../events';
import { Rng } from '../rng';
import {
  PROGRESSIONS, bassNote, chordMood, chordName, melodyPool, midiToFreq, pickProgression, voice, type Chord,
} from './theory';

// A small procedural lofi band: dusty keys, boom-bap drums, round bass, the
// odd melody fragment, all through a warm low-pass and vinyl crackle.
// The sequencer runs on the audio clock and every musical event is
// forwarded to the world via Tone's Draw scheduler, so visuals land on the
// beat you hear rather than the one being scheduled ahead.

interface Section {
  name: SectionName;
  bars: number;
  drums: boolean;
  hats: boolean;
  bass: boolean;
  melody: boolean;
  prog: 'A' | 'B';
  filter: number;
}

const FIRST_CYCLE: Section[] = [
  { name: 'intro', bars: 4, drums: false, hats: false, bass: false, melody: false, prog: 'A', filter: 1900 },
];
const CYCLE: Section[] = [
  { name: 'groove', bars: 8, drums: true, hats: true, bass: true, melody: false, prog: 'A', filter: 4200 },
  { name: 'groove', bars: 8, drums: true, hats: true, bass: true, melody: true, prog: 'A', filter: 4200 },
  { name: 'bridge', bars: 8, drums: true, hats: true, bass: true, melody: true, prog: 'B', filter: 3400 },
  { name: 'breakdown', bars: 4, drums: false, hats: true, bass: false, melody: false, prog: 'A', filter: 1500 },
];

const KICKS = [[0, 10], [0, 7, 10], [0, 3, 10], [0, 10, 11]];
const KEYS_COMP = [[0], [0, 10], [0, 6], [0, 14]];
const BASS_PATTERNS = [[0, 10], [0, 7, 10], [0, 3, 8], [0, 11]];

type Instruments = ReturnType<typeof buildBand>;

export class LofiEngine {
  readonly bpm: number;
  private rng: Rng;
  private band: Instruments | null = null;
  private fallbackTimer: number | null = null;

  private step = 0;
  private bar = 0;
  private sections: Section[] = [...FIRST_CYCLE, ...CYCLE];
  private sectionIndex = -1;
  private barsLeftInSection = 0;
  private key: number;
  private progA: number;
  private progB: number;
  private kick = KICKS[0];
  private comp = KEYS_COMP[0];
  private bassPattern = BASS_PATTERNS[0];
  private voicingCenter = 62;
  private currentChord: Chord | null = null;
  private melodyNote = 72;

  chordLabel = '';
  sectionLabel: SectionName = 'intro';

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x10f1);
    this.bpm = this.rng.int(70, 84);
    this.key = this.rng.int(0, 11);
    this.progA = pickProgression(this.rng);
    this.progB = pickProgression(this.rng, this.progA);
  }

  /** Start with real audio. Must be called from a user gesture. */
  async start(): Promise<void> {
    await Tone.start();
    this.band = buildBand();
    await Tone.loaded();
    // Deliver visual events even if a frame runs late (default drops after
    // 0.25s), so slow devices never miss a chord or section change.
    Tone.getDraw().expiration = 1.5;
    const transport = Tone.getTransport();
    transport.bpm.value = this.bpm;
    transport.swing = 0.22;
    transport.swingSubdivision = '16n';
    transport.scheduleRepeat((time) => this.tick(time), '16n', 0);
    this.band.crackle.start();
    transport.start('+0.15');
  }

  /** Visual-only clock for when audio isn't available. */
  startSilent(): void {
    const stepMs = 60000 / this.bpm / 4;
    this.fallbackTimer = window.setInterval(() => this.tick(0), stepMs);
  }

  setMuted(muted: boolean): void {
    Tone.getDestination().mute = muted;
  }

  get muted(): boolean {
    return Tone.getDestination().mute;
  }

  get beatSeconds(): number {
    return 60 / this.bpm;
  }

  stop(): void {
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);
    Tone.getTransport().stop();
  }

  // -------------------------------------------------------------------------

  /** Run `fn` when `time` is actually heard. */
  private at(time: number, fn: () => void) {
    if (this.band) Tone.getDraw().schedule(fn, time);
    else fn();
  }

  private get section(): Section {
    return this.sections[this.sectionIndex];
  }

  private nextSection() {
    this.sectionIndex++;
    if (this.sectionIndex >= this.sections.length) {
      // New cycle: fresh harmony, sometimes a new key, new groove choices.
      this.sections = CYCLE.slice();
      this.sectionIndex = 0;
      if (this.rng.chance(0.5)) this.key = (((this.key + this.rng.pick([5, 7, -2, 3])) % 12) + 12) % 12;
      this.progA = pickProgression(this.rng, this.progA);
      this.progB = pickProgression(this.rng, this.progA);
    }
    const s = this.section;
    this.barsLeftInSection = s.bars;
    this.kick = this.rng.pick(KICKS);
    this.comp = this.rng.pick(KEYS_COMP);
    this.bassPattern = this.rng.pick(BASS_PATTERNS);
    return s;
  }

  private onBar(time: number) {
    if (this.barsLeftInSection <= 0) {
      const s = this.nextSection();
      this.band?.master.frequency.rampTo(s.filter, this.beatSeconds * 2, time);
      const bar = this.bar;
      this.at(time, () => {
        this.sectionLabel = s.name;
        bus.emit('section', { name: s.name, bar });
      });
    }
    this.barsLeftInSection--;
    const bar = this.bar;
    this.at(time, () => bus.emit('bar', { bar, time }));
  }

  private chordAt(beatInProg: number): { chord: Chord; start: number; index: number } {
    const prog = PROGRESSIONS[this.section.prog === 'A' ? this.progA : this.progB];
    let acc = 0;
    for (let i = 0; i < prog.length; i++) {
      if (beatInProg < acc + prog[i].beats) return { chord: prog[i], start: acc, index: i };
      acc += prog[i].beats;
    }
    return { chord: prog[0], start: 0, index: 0 };
  }

  private tick(time: number) {
    const s = this.step % 16;
    if (s === 0) this.onBar(time);
    const sec = this.section;
    const rng = this.rng;
    const b = this.band;
    const hum = () => (b ? rng.range(0, 0.012) : 0);
    const beatLen = this.beatSeconds;

    // --- Harmony ------------------------------------------------------------
    const beatInProg = (this.bar % 4) * 4 + s / 4;
    if (s % 4 === 0) {
      const { chord, start, index } = this.chordAt(beatInProg);
      if (start === beatInProg) {
        this.currentChord = chord;
        const notes = voice(this.key, chord, this.voicingCenter);
        this.voicingCenter = notes.reduce((a, n) => a + n, 0) / notes.length;
        const name = chordName(this.key, chord);
        const mood = chordMood(chord);
        this.at(time, () => {
          this.chordLabel = name;
          bus.emit('chord', { name, mood, index });
        });
        if (b) {
          const dur = chord.beats * beatLen * 0.92;
          notes.forEach((n, i) => {
            b.keys.triggerAttackRelease(midiToFreq(n), dur, time + i * 0.02 + hum(), rng.range(0.45, 0.62));
          });
          if (sec.bass) b.bass.triggerAttackRelease(midiToFreq(bassNote(this.key, chord)), beatLen * 1.4, time + hum(), 0.85);
        }
      }
    }
    const chord = this.currentChord;
    if (b && chord) {
      // Re-comp the chord softly on pattern steps (not on the downbeat).
      if (s !== 0 && this.comp.includes(s) && rng.chance(0.8)) {
        const notes = voice(this.key, chord, this.voicingCenter);
        notes.forEach((n, i) => b.keys.triggerAttackRelease(midiToFreq(n), beatLen * 0.9, time + i * 0.015 + hum(), rng.range(0.25, 0.38)));
      }
      if (sec.bass && s !== 0 && this.bassPattern.includes(s)) {
        const root = bassNote(this.key, chord);
        const note = rng.chance(0.3) ? root + 7 : rng.chance(0.2) ? root + 12 : root;
        b.bass.triggerAttackRelease(midiToFreq(note), beatLen * 0.45, time + hum(), rng.range(0.6, 0.8));
      }
      if (sec.melody) {
        const phraseBar = this.bar % 4;
        const p = s % 2 === 0 ? [0.32, 0.2, 0.3, 0.06][phraseBar] : 0.05;
        if (rng.chance(p)) {
          const pool = melodyPool(this.key, chord);
          // Random walk toward nearby chord tones keeps it singable.
          const near = pool.filter((n) => Math.abs(n - this.melodyNote) <= 5);
          this.melodyNote = rng.pick(near.length ? near : pool);
          b.lead.triggerAttackRelease(midiToFreq(this.melodyNote), rng.chance(0.3) ? beatLen : beatLen / 2, time + hum(), rng.range(0.4, 0.6));
        }
      }
    }

    // --- Drums --------------------------------------------------------------
    if (sec.drums) {
      if (this.kick.includes(s)) {
        if (b) {
          b.kick.triggerAttackRelease('C1', '8n', time + hum() * 0.3, s === 0 ? 0.95 : 0.75);
          b.duck.gain.cancelScheduledValues(time);
          b.duck.gain.setValueAtTime(0.72, time);
          b.duck.gain.linearRampToValueAtTime(1, time + beatLen * 0.6);
        }
        this.at(time, () => bus.emit('kick', {}));
      }
      if (s === 4 || s === 12) b?.snare.triggerAttackRelease('16n', time + hum(), rng.range(0.75, 0.9));
      else if ((s === 15 || s === 7) && rng.chance(0.18)) b?.snare.triggerAttackRelease('32n', time + hum(), 0.22);
    }
    // Hats; the intro's last bar gets a hat lead-in before the drums drop.
    const hatsOn = sec.hats || (sec.name === 'intro' && this.barsLeftInSection === 0);
    const onBeat = s % 2 === 0;
    if (hatsOn && (onBeat || rng.chance(0.12))) {
      const v = (s % 4 === 0 ? 0.5 : onBeat ? 0.36 : 0.2) * rng.range(0.8, 1.1);
      if (s === 14 && rng.chance(0.2)) b?.openHat.triggerAttackRelease('8n', time + hum(), 0.35);
      else b?.hat.triggerAttackRelease('32n', time + hum(), v);
      if (onBeat) this.at(time, () => bus.emit('hat', { velocity: v }));
    }

    if (s % 4 === 0) {
      const beat = s / 4;
      const bar = this.bar;
      this.at(time, () => bus.emit('beat', { beat, bar, time }));
    }

    this.step++;
    if (this.step % 16 === 0) this.bar++;
  }
}

// ---------------------------------------------------------------------------

function buildBand() {
  // Master: everything → low-pass → glue compressor → limiter → out.
  const master = new Tone.Filter({ type: 'lowpass', frequency: 1900, rolloff: -12, Q: 0.4 });
  const comp = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.02, release: 0.25 });
  const limiter = new Tone.Limiter(-1.5);
  master.chain(comp, limiter, Tone.getDestination());
  Tone.getDestination().volume.value = -1;

  const reverb = new Tone.Reverb({ decay: 3.8, preDelay: 0.03, wet: 1 });
  reverb.connect(master);
  const send = (node: Tone.ToneAudioNode, amount: number) => {
    const g = new Tone.Gain(amount);
    node.connect(g);
    g.connect(reverb);
  };

  // Keys: a soft FM electric piano with chorus and slow tape wobble,
  // ducked by the kick for a gentle pump.
  const duck = new Tone.Gain(1).connect(master);
  const wobble = new Tone.Vibrato({ frequency: 0.35, depth: 0.06 }).connect(duck);
  const chorus = new Tone.Chorus({ frequency: 0.7, delayTime: 3.5, depth: 0.45, wet: 0.35 }).start().connect(wobble);
  const keysTone = new Tone.Filter({ type: 'lowpass', frequency: 2400, Q: 0.3 }).connect(chorus);
  const keys = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 1,
    modulationIndex: 1.6,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.005, decay: 2.2, sustain: 0.18, release: 1.6 },
    modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.05, release: 0.6 },
    volume: -12,
  }).connect(keysTone);
  keys.maxPolyphony = 24;
  send(keysTone, 0.35);

  const bass = new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    filter: { Q: 0.8, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.01, decay: 0.35, sustain: 0.55, release: 0.35 },
    filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.25, release: 0.4, baseFrequency: 160, octaves: 2 },
    volume: -9,
  }).connect(master);

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.045,
    octaves: 5,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 },
    volume: -5,
  }).connect(master);

  const snareTone = new Tone.Filter({ type: 'bandpass', frequency: 1900, Q: 0.7 }).connect(master);
  const snare = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
    volume: -9,
  }).connect(snareTone);
  send(snareTone, 0.5);

  const hatTone = new Tone.Filter({ type: 'highpass', frequency: 7000 }).connect(master);
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
    volume: -20,
  }).connect(hatTone);
  const openHat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.002, decay: 0.28, sustain: 0 },
    volume: -24,
  }).connect(hatTone);

  const leadDelay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.32, wet: 0.28 }).connect(master);
  const lead = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.012, decay: 0.45, sustain: 0.12, release: 0.9 },
    volume: -19,
  }).connect(leadDelay);
  send(lead, 0.4);

  const crackle = new Tone.Player({ url: crackleBuffer(), loop: true, volume: -17 }).toDestination();

  return { master, keys, bass, kick, snare, hat, openHat, lead, duck, crackle };
}

/** Four seconds of vinyl: faint hiss, soft rumble and random pops. */
function crackleBuffer(): Tone.ToneAudioBuffer {
  const sr = Tone.getContext().sampleRate;
  const len = Math.floor(sr * 4);
  const data = new Float32Array(len);
  let rumble = 0;
  for (let i = 0; i < len; i++) {
    rumble = rumble * 0.995 + (Math.random() - 0.5) * 0.02;
    data[i] = (Math.random() - 0.5) * 0.012 + rumble * 0.4;
  }
  const pops = Math.floor(len / sr) * 22;
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(Math.random() * (len - 200));
    const amp = Math.random() < 0.1 ? 0.5 : 0.08 + Math.random() * 0.15;
    const decay = 10 + Math.random() * 60;
    for (let j = 0; j < 120; j++) data[at + j] += amp * Math.exp(-j / decay) * (j % 2 ? -1 : 1);
  }
  return Tone.ToneAudioBuffer.fromArray(data);
}
