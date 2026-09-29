import { World } from './world/world';
import { LofiEngine } from './music/engine';
import * as Tone from 'tone';
import { bus } from './events';

// URL options:
//   ?seed=123       reproduce a world (the current seed is written to the URL)
//   ?t=0.3          freeze the time of day (0 golden hour, .2 dusk, .35 night, .75 day)
//   ?day=900        seconds per full day/night cycle (default 1200)
//   ?shot=vista     lock the camera to a shot (canal | rooftops | vista)
//   ?silent         run the visual clock without audio, no click needed
//   ?train          send a train through immediately
//   ?x=400          start further along the city
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const dayLength = Number(params.get('day')) || 1200;

params.set('seed', String(seed));
try {
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
} catch {
  // Sandboxed embeds may not allow URL changes; the seed just won't be shareable.
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const world = new World(canvas, { seed, fixedTime, dayLength });
const shot = params.get('shot');
if (shot === 'canal' || shot === 'rooftops' || shot === 'vista') world.snapShot(shot);
else if (shot === 'city') world.snapShot('rooftops');
if (params.has('x')) world.startAt(Number(params.get('x')));
if (params.has('train')) world.dispatchTrain();
world.debugNoPost = params.has('nopost');
if (params.has('cam')) world.debugCam = params.get('cam')!.split(',').map(Number);

const engine = new LofiEngine(seed);
const start = document.getElementById('start')!;
const hudChord = document.getElementById('hud-chord')!;
const hudTime = document.getElementById('hud-time')!;
const hud = document.getElementById('hud')!;

let started = false;
async function begin(silent: boolean) {
  if (started) return;
  started = true;
  start.classList.add('hidden');
  if (silent) {
    engine.startSilent();
    return;
  }
  try {
    await engine.start();
  } catch (err) {
    console.warn('Audio unavailable, running visuals only', err);
    engine.startSilent();
  }
}

document.getElementById('play')!.addEventListener('click', () => begin(false));

// Dev-only handle for debugging from the console.
if (import.meta.env.DEV) Object.assign(window, { __lofi: { world, engine, Tone } });
if (params.has('silent')) begin(true);

const muteBtn = document.getElementById('mute')!;
const fullBtn = document.getElementById('full')!;
function toggleMute() {
  engine.setMuted(!engine.muted);
  muteBtn.textContent = engine.muted ? '🔇' : '🔊';
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
muteBtn.addEventListener('click', toggleMute);
fullBtn.addEventListener('click', toggleFullscreen);
// iPhone Safari has no element fullscreen; hide the button there.
if (!document.fullscreenEnabled) fullBtn.hidden = true;

window.addEventListener('keydown', (e) => {
  if (e.key === 'm') toggleMute();
  if (e.key === 'h') hud.hidden = !hud.hidden;
  if (e.key === 'f') toggleFullscreen();
});

// Resume audio when coming back to the tab (mobile browsers suspend it).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && started) Tone.getContext().resume().catch(() => {});
});

bus.on('chord', ({ name }) => {
  hudChord.textContent = `${name} · ${engine.sectionLabel} · ${engine.bpm} bpm`;
});

function timeLabel(t: number): string {
  if (t < 0.12 || t > 0.9) return 'golden hour';
  if (t < 0.22) return 'dusk';
  if (t < 0.55) return 'night';
  if (t < 0.66) return 'dawn';
  return 'day';
}

function loop() {
  world.frame();
  hudTime.textContent = timeLabel(world.timeOfDay);
  requestAnimationFrame(loop);
}
loop();
