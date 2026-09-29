import * as THREE from 'three';
import { bus, type SectionName } from '../events';
import { createResolvedPalette, samplePalette, sunDirection } from '../palette';
import { Post } from '../fx/post';
import { CityChunk, CHUNK_W, CANAL_Z, districtAt, type District } from './city';
import { Materials } from './materials';
import { Sky, Skyline } from './sky';
import { Leaves } from './leaves';
import { Boats, Birds, Particles, Fireflies } from './life';
import { Traffic, Railway } from './transport';
import { CanalWater } from './water';
import { setRailSeed, railZ, railY, railSlope, inTunnel, DECK_H } from './rail';

export interface WorldOptions {
  seed: number;
  /** Fixed time of day (0..1), or null to let the day cycle. */
  fixedTime: number | null;
  /** Seconds for a full day/night loop. */
  dayLength: number;
}

// The camera: one street-level ride, always travelling forward (+X) through
// the city down the corridor. Only what that camera can see is built in detail.
interface Shot {
  height: number;
  lateral: number; // camera z
  ahead: number; // how far ahead it looks
  lookY: number;
  lookZ: number;
  focus: number; // DOF focus distance
  aperture: number;
  speed: number; // travel speed, units/s
}


const DISTRICT_LIFT: Record<District, number> = { canal: 0, street: -0.35, market: -0.3, park: -0.1 };

const SHOTS = {
  // Gliding down the canal at boat height, under string lights and bridges.
  canal: { height: 3.6, lateral: CANAL_Z, ahead: 30, lookY: 2.8, lookZ: CANAL_Z, focus: 20, aperture: 0.45, speed: 3.2 },
} satisfies Record<string, Shot>;

function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.8, 1200);

  private mats = new Materials();
  private post: Post;
  private sky = new Sky();
  private skyline: Skyline;
  private railway: Railway;
  private leaves: Leaves;
  private traffic: Traffic;
  private boats: Boats;
  private birds: Birds;
  private particles = new Particles();
  private fireflies = new Fireflies();
  private neonFlicker = 0;
  private water: CanalWater;
  private basePixelRatio = 1;
  private chunks = new Map<string, CityChunk>();
  private farSkyline: Skyline;

  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight();
  private palette = createResolvedPalette();
  private sunDir = new THREE.Vector3();

  private clock = new THREE.Timer();
  private elapsed = 0;
  private camX = 0;
  private shot: Shot = { ...SHOTS.canal };
  private shotTarget: Shot = SHOTS.canal;
  private shotSpeed = 0.35;
  private lookTarget = new THREE.Vector3();
  private groundLift = 0;
  private railLift = 0;

  // Music-driven state
  private beatPulse = 0;
  private kickPulse = 0;
  private lastBeatAt = -1;
  private beatSeconds = 0.8;
  private mood = 0;
  private moodTarget = 0;
  private leafDensity = 0.35;

  timeOfDay = 0;
  debugNoPost = false;
  /** Debug: fixed camera [x, y, z, targetX, targetY, targetZ] relative to the drift. */
  debugCam: number[] | null = null;

  constructor(canvas: HTMLCanvasElement, private opts: WorldOptions) {
    setRailSeed(opts.seed);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    // Phones and tablets: fewer pixels, smaller shadows, lighter blur.
    const lowPower = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    this.basePixelRatio = Math.min(window.devicePixelRatio, lowPower ? 1.25 : 2);
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // soft via shadow.radius
    // The post pipeline asks for one shadow update per frame (the canal
    // reflection renders the scene again and must reuse it).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.NoToneMapping;

    const gl = this.renderer.extensions;
    const halfFloat = gl.has('EXT_color_buffer_half_float') || gl.has('EXT_color_buffer_float');
    this.post = new Post(2, 2, halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, lowPower ? 0 : 4);
    if (lowPower) this.post.uniforms.uMaxBlur.value = 6;
    this.skyline = new Skyline(opts.seed, this.sky.skyUniforms);
    // A second skyline behind the far bank, mirrored across the canal.
    this.farSkyline = new Skyline(opts.seed ^ 0x5eed, this.sky.skyUniforms);
    this.farSkyline.group.scale.z = -1;
    this.farSkyline.group.position.z = 2 * CANAL_Z;
    this.railway = new Railway(this.mats);
    this.leaves = new Leaves(this.mats, () => this.lookTarget);
    this.traffic = new Traffic(this.mats, (x) => districtAt(this.opts.seed, Math.floor(x / CHUNK_W)) === 'street');
    this.boats = new Boats(this.mats);
    this.birds = new Birds(this.mats);
    this.water = new CanalWater(this.renderer);

    this.scene.fog = new THREE.Fog(0xffffff, 45, 430);
    this.scene.add(this.sky.mesh, this.skyline.group, this.farSkyline.group, this.railway.group, this.leaves.mesh, this.traffic.group, this.boats.group, this.birds.mesh, this.particles.points, this.fireflies.points, this.water.mesh, this.hemi, this.sun, this.sun.target);

    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 360;
    this.sun.shadow.mapSize.setScalar(lowPower ? 1024 : 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;

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
        this.leafDensity = 0.3;
        break;
      case 'groove':
        this.leafDensity = 0.7;
        this.railway.dispatch(this.camX);
        break;
      case 'bridge':
        this.leafDensity = 0.9;
        this.railway.dispatch(this.camX);
        this.leaves.gustNow(2);
        break;
      case 'breakdown':
        this.leafDensity = 0.4;
        break;
    }
  }

  /**
   * Never let the camera pass through the viaduct, a platform or a train:
   * near the line, push it above the trains or below the deck.
   */
  private keepClearOfRailway(p: THREE.Vector3) {
    if (inTunnel(p.x)) return;
    const across = Math.abs(p.z - railZ(p.x)) / Math.sqrt(1 + railSlope(p.x) ** 2);
    if (across > 6.5) return;
    const top = railY(p.x);
    const lo = top - DECK_H - 1.5;
    const hi = top + 4.6;
    if (p.y > lo && p.y < hi) p.y = p.y > (lo + hi) / 2 || lo < 1 ? hi : lo;
  }

  /** Start the journey somewhere else along the city. */
  startAt(x: number) {
    this.camX = x;
    this.traffic.reset(x);
    for (const c of this.chunks.values()) c.dispose();
    this.chunks.clear();
    this.updateChunks(true);
  }

  /** Debug: send a train through now. */
  dispatchTrain() {
    this.railway.debugPlace(this.camX);
  }

  private resize() {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    // Cap the render size (~1440p) so big monitors stay smooth.
    const maxPr = Math.min(this.basePixelRatio, 2560 / Math.max(w, 1), 1440 / Math.max(h, 1));
    this.renderer.setPixelRatio(Math.max(1, maxPr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep a similar horizontal field of view on portrait screens.
    this.camera.fov = w / h < 1 ? 50 : 32;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
  }

  private canalInView(): boolean {
    for (let i = Math.floor((this.camX - 4) / CHUNK_W); i <= Math.floor((this.camX + 380) / CHUNK_W); i++) {
      if (districtAt(this.opts.seed, i) === 'canal') return true;
    }
    return false;
  }

  private updateChunks(all = false) {
    // Only ahead: the street camera always looks forward, so nothing behind it is ever in view.
    const from = Math.floor((this.camX - 4) / CHUNK_W);
    const to = Math.floor((this.camX + 330) / CHUNK_W);
    let built = 0;
    for (let i = from; i <= to; i++) {
      for (const mirrored of [false, true]) {
        const key = `${i}${mirrored ? 'm' : ''}`;
        if (this.chunks.has(key)) continue;
        if (!all && built >= 1) return; // spread generation across frames
        const chunk = new CityChunk(i, this.opts.seed, this.mats, mirrored);
        this.scene.add(chunk.group);
        this.chunks.set(key, chunk);
        built++;
      }
    }
    for (const [key, c] of this.chunks) {
      if (c.index < from || c.index > to + 1) {
        c.dispose();
        this.chunks.delete(key);
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

    // --- Camera -------------------------------------------------------------
    const s = this.shot;
    const g = this.shotTarget;
    const r = this.shotSpeed;
    s.speed = damp(s.speed, g.speed, r, dt);
    this.camX += s.speed * dt;
    s.height = damp(s.height, g.height, r, dt);
    s.lateral = damp(s.lateral, g.lateral, r, dt);
    s.ahead = damp(s.ahead, g.ahead, r, dt);
    s.lookY = damp(s.lookY, g.lookY, r, dt);
    s.lookZ = damp(s.lookZ, g.lookZ, r, dt);
    s.focus = damp(s.focus, g.focus, r * 1.4, dt);
    s.aperture = damp(s.aperture, g.aperture, r * 1.4, dt);
    // At ground level, settle to each district: boat height on the canal,
    // eye level on streets and market lanes.
    const ahead = districtAt(this.opts.seed, Math.floor((this.camX + 12) / CHUNK_W));
    this.groundLift = damp(this.groundLift, DISTRICT_LIFT[ahead], 0.5, dt);
    // Street level stays dead centre and looks straight down the corridor (just a
    // faint bob); the high views drift gently like a drone.
    const low = Math.max(0, 1 - (s.height - 3.6) / 10);
    const high = 1 - low;
    const weave = Math.sin(t * 0.11) * 2.5 * high;
    const bob = Math.sin(t * 0.9) * 0.05 * low + Math.sin(t * 0.21) * 0.4 * high;
    this.camera.position.set(this.camX, s.height + bob + this.groundLift * low, s.lateral + weave);
    this.lookTarget.set(this.camX + s.ahead, s.lookY + this.groundLift * low, s.lookZ + (weave * 0.4 + Math.sin(t * 0.07) * 2.5) * high);
    // Rise (or dip) smoothly ahead of the railway instead of snapping.
    let need = 0;
    for (const ahead of [0, 8, 16, 26]) {
      const probe = this.camera.position.clone();
      probe.x += ahead;
      const before = probe.y;
      this.keepClearOfRailway(probe);
      if (Math.abs(probe.y - before) > Math.abs(need)) need = probe.y - before;
    }
    this.railLift = damp(this.railLift, need, need > this.railLift ? 4 : 0.8, dt);
    this.camera.position.y += this.railLift;
    this.keepClearOfRailway(this.camera.position);
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
    // Centre the shadow map on the stretch ahead that the street camera sees up close.
    const focusPoint = new THREE.Vector3(this.camX + 55, 0, CANAL_Z);
    this.sun.target.position.copy(focusPoint);
    this.sun.position.copy(focusPoint).addScaledVector(this.sunDir, 150);
    (this.scene.fog as THREE.Fog).color.copy(p.haze);
    this.neonFlicker *= Math.exp(-dt * 14);
    this.mats.update(p, this.beatPulse, t, this.leaves.wind, this.neonFlicker);
    this.mats.windows.update(p, this.sunDir, t, this.beatPulse);
    this.sky.update(p, this.sunDir, this.camera.position, t);
    this.skyline.update(this.camX, p);
    this.farSkyline.update(this.camX, p);

    // --- World --------------------------------------------------------------
    this.updateChunks();
    this.railway.update(dt, this.camX);
    this.leaves.update(dt, t, this.leafDensity);
    this.traffic.update(dt, this.camX);
    this.boats.update(dt, this.camX, t, this.beatPulse, (x) => districtAt(this.opts.seed, Math.floor(x / CHUNK_W)) === 'canal');
    this.birds.update(dt, this.camX, t, this.beatSeconds, this.mats.ink.color);
    const chimneys: THREE.Vector3[] = [];
    const fountains: THREE.Vector3[] = [];
    for (const c of this.chunks.values()) {
      chimneys.push(...c.chimneys);
      fountains.push(...c.fountains);
    }
    this.particles.update(dt, this.camX, chimneys, fountains, this.leaves.wind, p.nightness, p.haze, this.renderer.domElement.height);
    this.fireflies.update(t, this.camX, p.nightness, this.beatPulse);
    this.water.update(this.camX, p, t, this.beatPulse);
    // The reflection re-renders the whole scene: only when there's canal water in view.
    this.water.mesh.visible = this.canalInView();

    // --- Post ---------------------------------------------------------------
    this.post.update(this.camera, p, t, this.sunDir);
    const u = this.post.uniforms;
    u.uFocus.value = s.focus;
    u.uAperture.value = s.aperture;
    u.uMood.value = this.mood;
    u.uPulse.value = this.kickPulse;
    if (this.debugNoPost) {
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
    }
    else this.post.render(this.renderer, this.scene, this.camera);
  }
}
