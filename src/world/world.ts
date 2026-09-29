import * as THREE from 'three';
import { bus, type SectionName } from '../events';
import { createResolvedPalette, samplePalette, sunDirection } from '../palette';
import { Post } from '../fx/post';
import { CityChunk, CHUNK_W, TRAIN_Z } from './city';
import { Materials } from './materials';
import { Sky, Skyline } from './sky';
import { Train } from './train';
import { Leaves } from './leaves';
import { Traffic, Boats, Birds, Particles, Fireflies } from './life';

export interface WorldOptions {
  seed: number;
  /** Fixed time of day (0..1), or null to let the day cycle. */
  fixedTime: number | null;
  /** Seconds for a full day/night loop. */
  dayLength: number;
}

// Camera "shots". The director eases between them on section changes, the
// way a lofi video cuts to a new vista when the track moves on.
interface Shot {
  height: number;
  back: number; // camera z
  lookY: number;
  lookZ: number;
  focus: number; // DOF focus distance
  aperture: number;
}

const SHOTS: Record<'rooftops' | 'city' | 'vista', Shot> = {
  rooftops: { height: 29, back: 30, lookY: 6, lookZ: -24, focus: 52, aperture: 0.75 },
  city: { height: 23, back: 32, lookY: 9, lookZ: -34, focus: 60, aperture: 0.6 },
  vista: { height: 12, back: 30, lookY: 10.5, lookZ: -85, focus: TRAIN_Z * -1 + 30, aperture: 0.9 },
};

const DRIFT = 1.5; // world units per second

function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 1200);

  private mats = new Materials();
  private post: Post;
  private sky = new Sky();
  private skyline: Skyline;
  private train: Train;
  private leaves: Leaves;
  private traffic: Traffic;
  private boats: Boats;
  private birds: Birds;
  private particles = new Particles();
  private fireflies = new Fireflies();
  private neonFlicker = 0;
  private chunks = new Map<number, CityChunk>();

  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight();
  private palette = createResolvedPalette();
  private sunDir = new THREE.Vector3();

  private clock = new THREE.Timer();
  private elapsed = 0;
  private camX = 0;
  private shot: Shot = { ...SHOTS.city };
  private shotTarget: Shot = SHOTS.city;
  private shotSpeed = 0.35;
  private lookTarget = new THREE.Vector3();

  // Music-driven state
  private beatPulse = 0;
  private kickPulse = 0;
  private beatPhase = 0;
  private lastBeatAt = -1;
  private beatSeconds = 0.8;
  private mood = 0;
  private moodTarget = 0;
  private leafDensity = 0.35;
  private shotToggle = false;

  timeOfDay = 0;
  debugNoPost = false;
  /** Debug: fixed camera [x, y, z, targetX, targetY, targetZ] relative to the drift. */
  debugCam: number[] | null = null;

  constructor(canvas: HTMLCanvasElement, private opts: WorldOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    // Phones and tablets: fewer pixels, smaller shadows, lighter blur.
    const lowPower = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.25 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;

    const gl = this.renderer.extensions;
    const halfFloat = gl.has('EXT_color_buffer_half_float') || gl.has('EXT_color_buffer_float');
    this.post = new Post(2, 2, halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType);
    if (lowPower) this.post.uniforms.uMaxBlur.value = 6;
    this.skyline = new Skyline(opts.seed, this.sky.skyUniforms);
    this.train = new Train(this.mats);
    this.leaves = new Leaves(this.mats, () => this.lookTarget);
    this.traffic = new Traffic(this.mats);
    this.boats = new Boats(this.mats);
    this.birds = new Birds(this.mats);

    this.scene.fog = new THREE.Fog(0xffffff, 45, 300);
    this.scene.add(this.sky.mesh, this.skyline.group, this.train.group, this.leaves.mesh, this.traffic.group, this.boats.group, this.birds.mesh, this.particles.points, this.fireflies.points, this.hemi, this.sun, this.sun.target);

    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -75;
    sc.right = 75;
    sc.top = 75;
    sc.bottom = -75;
    sc.near = 1;
    sc.far = 320;
    this.sun.shadow.mapSize.setScalar(lowPower ? 1024 : 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;

    this.timeOfDay = opts.fixedTime ?? 0.02;
    this.updateChunks(true);
    this.listen();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private listen() {
    bus.on('beat', ({ beat }) => {
      const now = this.elapsed;
      if (this.lastBeatAt >= 0) {
        // Measure the real beat length from arrivals; smooths out jitter.
        const measured = now - this.lastBeatAt;
        if (measured > 0.3 && measured < 1.5) this.beatSeconds = this.beatSeconds * 0.8 + measured * 0.2;
      }
      this.lastBeatAt = now;
      this.beatPulse = beat === 0 ? 1 : 0.7;
    });
    bus.on('kick', () => {
      this.particles.kick();
      this.kickPulse = 1;
    });
    bus.on('hat', ({ velocity }) => {
      this.leaves.flutterNow(velocity);
      if (Math.random() < 0.12) this.neonFlicker = 1;
    });
    bus.on('bar', ({ bar }) => this.leaves.gustNow(bar % 4 === 0 ? 1 : 0.35));
    bus.on('chord', ({ mood }) => {
      this.moodTarget = mood === 'warm' ? 0.7 : -0.7;
    });
    bus.on('section', ({ name }) => this.onSection(name));
  }

  private onSection(name: SectionName) {
    if (name !== 'intro') this.birds.startle();
    switch (name) {
      case 'intro':
        this.setShot(SHOTS.city, 0.25);
        this.leafDensity = 0.3;
        break;
      case 'groove':
        this.shotToggle = !this.shotToggle;
        this.setShot(this.shotToggle ? SHOTS.rooftops : SHOTS.city, 0.3);
        this.leafDensity = 0.7;
        if (Math.random() < 0.5) this.train.dispatch(16);
        break;
      case 'bridge':
        // Pull focus out to the train line and send a train through.
        this.setShot(SHOTS.vista, 0.25);
        this.leafDensity = 0.9;
        this.train.dispatch(14);
        this.leaves.gustNow(2);
        break;
      case 'breakdown':
        this.setShot({ ...SHOTS.rooftops, aperture: 1.3, focus: 46 }, 0.3);
        this.leafDensity = 0.4;
        break;
    }
  }

  private shotLocked = false;

  private setShot(shot: Shot, speed: number) {
    if (this.shotLocked) return;
    this.shotTarget = shot;
    this.shotSpeed = speed;
  }

  /** For screenshots/debugging: jump straight to a named shot. */
  snapShot(name: keyof typeof SHOTS) {
    this.shotLocked = true;
    this.shotTarget = SHOTS[name];
    this.shot = { ...SHOTS[name] };
  }

  /** Debug: send a train through now. */
  dispatchTrain() {
    this.train.dispatch(40, 30);
  }

  private resize() {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep a similar horizontal field of view on portrait screens.
    this.camera.fov = w / h < 1 ? 50 : 32;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
  }

  private updateChunks(all = false) {
    const from = Math.floor((this.camX - 95) / CHUNK_W);
    const to = Math.floor((this.camX + 115) / CHUNK_W);
    let built = 0;
    for (let i = from; i <= to; i++) {
      if (this.chunks.has(i)) continue;
      if (!all && built >= 1) break; // spread generation across frames
      const chunk = new CityChunk(i, this.opts.seed, this.mats);
      this.scene.add(chunk.group);
      this.chunks.set(i, chunk);
      built++;
    }
    for (const [i, c] of this.chunks) {
      if (i < from - 1 || i > to + 1) {
        c.dispose();
        this.chunks.delete(i);
      }
    }
  }

  frame() {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;
    const t = this.elapsed;

    if (this.opts.fixedTime === null) this.timeOfDay = (this.timeOfDay + dt / this.opts.dayLength) % 1;

    // --- Music-driven values ------------------------------------------------
    this.beatPulse *= Math.exp(-dt * 5);
    this.kickPulse *= Math.exp(-dt * 9);
    this.mood = damp(this.mood, this.moodTarget, 0.6, dt);
    this.beatPhase = this.lastBeatAt >= 0 ? Math.min(1, (t - this.lastBeatAt) / this.beatSeconds) : (t / 0.8) % 1;

    // --- Camera -------------------------------------------------------------
    this.camX += DRIFT * dt;
    const s = this.shot;
    const g = this.shotTarget;
    const r = this.shotSpeed;
    s.height = damp(s.height, g.height, r, dt);
    s.back = damp(s.back, g.back, r, dt);
    s.lookY = damp(s.lookY, g.lookY, r, dt);
    s.lookZ = damp(s.lookZ, g.lookZ, r, dt);
    s.focus = damp(s.focus, g.focus, r * 1.4, dt);
    s.aperture = damp(s.aperture, g.aperture, r * 1.4, dt);
    const swayX = Math.sin(t * 0.13) * 1.2;
    const swayY = Math.sin(t * 0.21) * 0.5;
    this.camera.position.set(this.camX + swayX, s.height + swayY, s.back);
    this.lookTarget.set(this.camX + 4, s.lookY, s.lookZ);
    if (this.debugCam) {
      const [cx, cy, cz, tx, ty, tz] = this.debugCam;
      this.camera.position.set(this.camX + cx, cy, cz);
      this.lookTarget.set(this.camX + tx, ty, tz);
    }
    this.camera.lookAt(this.lookTarget);

    // --- Palette & lights ---------------------------------------------------
    const p = samplePalette(this.timeOfDay, this.palette);
    sunDirection(this.timeOfDay, this.sunDir);
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunIntensity;
    const focusPoint = new THREE.Vector3(this.camX, 0, -30);
    this.sun.target.position.copy(focusPoint);
    this.sun.position.copy(focusPoint).addScaledVector(this.sunDir, 150);
    (this.scene.fog as THREE.Fog).color.copy(p.haze);
    this.neonFlicker *= Math.exp(-dt * 14);
    this.mats.update(p, this.beatPulse, t, this.leaves.wind, this.neonFlicker);
    this.sky.update(p, this.sunDir, this.camera.position, t);
    this.skyline.update(this.camX, p);

    // --- World --------------------------------------------------------------
    this.updateChunks();
    this.train.update(dt, this.camX);
    this.leaves.update(dt, t, this.leafDensity);
    this.traffic.update(dt, this.camX, t);
    this.boats.update(dt, this.camX, t, this.beatPulse);
    this.birds.update(dt, this.camX, t, this.beatSeconds, this.mats.ink.color);
    const chimneys: THREE.Vector3[] = [];
    const fountains: THREE.Vector3[] = [];
    for (const c of this.chunks.values()) {
      chimneys.push(...c.chimneys);
      fountains.push(...c.fountains);
    }
    this.particles.update(dt, this.camX, chimneys, fountains, this.leaves.wind, p.nightness, p.haze, this.renderer.domElement.height);
    this.fireflies.update(t, this.camX, p.nightness, this.beatPulse);
    this.bobResidents();

    // --- Post ---------------------------------------------------------------
    this.post.update(this.camera, p, t);
    const u = this.post.uniforms;
    u.uFocus.value = s.focus;
    u.uAperture.value = s.aperture;
    u.uMood.value = this.mood;
    u.uPulse.value = this.kickPulse;
    u.uLeakPos.value.set(this.sunDir.x > 0 ? 0.9 : 0.1, 1.05);
    if (this.debugNoPost) this.renderer.render(this.scene, this.camera);
    else this.post.render(this.renderer, this.scene, this.camera);
  }

  private bobResidents() {
    // Everyone nods on the beat: a quick squash on the hit, easing back up.
    const hit = Math.pow(1 - this.beatPhase, 3);
    for (const c of this.chunks.values()) {
      for (const r of c.residents) {
        const k = hit * 0.07 * r.bounce;
        const sway = Math.sin(this.elapsed * 1.3 + r.phase) * 0.015;
        r.sprite.scale.set(r.baseScale.x * (1 + k * 0.6), r.baseScale.y * (1 - k + sway), 1);
      }
    }
  }
}
