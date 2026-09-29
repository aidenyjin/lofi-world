import * as THREE from 'three';
import { InkedBuilder, GeoBuilder } from './geo';
import type { Materials } from './materials';
import { railStep, railYaw, trackPoint, RAIL_Y } from './rail';
import { CANAL_Z, TRAM_STREET, BUS_STREET } from './city';

// Everything on wheels. Road vehicles live in lanes and follow the one in
// front (so they queue instead of overlapping); buses and trams stop now and
// then as if at a stop. Trains run on both tracks of the curved viaduct.

const AHEAD = 320;
const BEHIND = 70;

type Kind = 'car' | 'van' | 'bus' | 'tram' | 'taxi';

interface Vehicle {
  obj: THREE.Group;
  kind: Kind;
  x: number;
  speed: number;
  maxSpeed: number;
  length: number;
  dwell: number;
  nextStop: number;
}

interface Lane {
  z: number;
  dir: 1 | -1;
  vehicles: Vehicle[];
  /** Only drive where this is true (corridor lanes exist only in street districts). */
  corridor: boolean;
}

const BODY = ['#f0a497', '#a9c9f0', '#f8dea0', '#bde2d0', '#c8b5e6', '#fff1d6', '#e9786f', '#8fb3e0'];

function group(ink: InkedBuilder, lights: GeoBuilder, tail: GeoBuilder, glass: GeoBuilder, mats: Materials): THREE.Group {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(ink.fill.build(), mats.toon);
  fill.castShadow = true;
  fill.receiveShadow = true;
  g.add(fill, new THREE.Mesh(ink.outline.build(), mats.ink));
  if (!glass.empty) g.add(new THREE.Mesh(glass.build(), mats.windowLit));
  if (!lights.empty) g.add(new THREE.Mesh(lights.build(), mats.bulb));
  if (!tail.empty) g.add(new THREE.Mesh(tail.build(), mats.emissive));
  return g;
}

const BULB = new THREE.IcosahedronGeometry(1, 1);
const WHEEL = new THREE.CylinderGeometry(1, 1, 1, 12);
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const eul = new THREE.Euler();

function wheels(ink: InkedBuilder, xs: number[], halfW: number, r: number) {
  for (const x of xs) {
    for (const z of [-halfW, halfW]) {
      q.setFromEuler(eul.set(Math.PI / 2, 0, 0));
      ink.fill.geometry(WHEEL, m4.compose(new THREE.Vector3(x, r, z), q, new THREE.Vector3(r, 0.22, r)), '#3b3240');
    }
  }
}

function lamps(lights: GeoBuilder, tail: GeoBuilder, len: number, y: number, halfW: number) {
  for (const z of [-halfW + 0.2, halfW - 0.2]) {
    lights.geometry(BULB, m4.makeScale(0.1, 0.08, 0.1).setPosition(len / 2 + 0.02, y, z), '#ffffff');
    tail.box(-len / 2 - 0.02, y, z, 0.04, 0.12, 0.2, '#ff5a4a');
  }
}

/** A small car or van pointing along +X, wheels on the ground. */
function buildCar(mats: Materials, color: string, kind: Kind): { obj: THREE.Group; length: number } {
  const ink = new InkedBuilder(0.06);
  const lights = new GeoBuilder();
  const tail = new GeoBuilder();
  const glass = new GeoBuilder();
  const van = kind === 'van';
  const L = van ? 2.8 : 2.4;
  ink.box(0, 0.5, 0, L, 0.55, 1.2, color);
  if (van) {
    ink.box(-0.25, 1.1, 0, 2.2, 0.7, 1.15, color);
    glass.box(0.86, 1.15, 0, 0.02, 0.45, 1.0, '#ffffff');
  } else {
    ink.box(-0.1, 1.0, 0, 1.4, 0.5, 1.1, kind === 'taxi' ? '#f6c453' : color);
    glass.box(0.6, 1.0, 0, 0.02, 0.36, 0.96, '#ffffff');
    glass.box(-0.1, 1.02, 0.56, 1.2, 0.32, 0.01, '#ffffff');
    glass.box(-0.1, 1.02, -0.56, 1.2, 0.32, 0.01, '#ffffff');
    if (kind === 'taxi') tail.box(-0.1, 1.33, 0, 0.4, 0.14, 0.25, '#ffe08a');
  }
  ink.fill.box(L / 2 - 0.01, 0.38, 0, 0.04, 0.12, 1.0, '#d9d2e0'); // bumper
  wheels(ink, [L / 2 - 0.55, -L / 2 + 0.55], 0.6, 0.25);
  lamps(lights, tail, L, 0.55, 0.6);
  return { obj: group(ink, lights, tail, glass, mats), length: L };
}

/** A two-door city bus with a lit window band and destination sign. */
function buildBus(mats: Materials, color: string): { obj: THREE.Group; length: number } {
  const ink = new InkedBuilder(0.07);
  const lights = new GeoBuilder();
  const tail = new GeoBuilder();
  const glass = new GeoBuilder();
  const L = 7.2;
  ink.box(0, 1.45, 0, L, 2.3, 2.3, color);
  ink.fill.box(0, 0.55, 0, L + 0.02, 0.5, 2.32, '#fff1d6');
  ink.box(0, 2.68, 0, L - 0.6, 0.16, 2.0, '#e9e4ff');
  for (let x = -L / 2 + 0.9; x < L / 2 - 0.9; x += 1.15) {
    glass.box(x, 1.75, 1.16, 0.95, 0.8, 0.01, '#ffffff');
    glass.box(x, 1.75, -1.16, 0.95, 0.8, 0.01, '#ffffff');
  }
  glass.box(L / 2 + 0.005, 1.75, 0, 0.01, 1.0, 2.0, '#ffffff');
  tail.box(L / 2 + 0.01, 2.4, 0, 0.02, 0.25, 1.4, '#ffb38a'); // destination sign
  for (const dx of [L / 2 - 1.1, -0.3]) ink.fill.box(dx, 1.2, 1.161, 0.9, 1.8, 0.01, '#8e98d6');
  wheels(ink, [L / 2 - 1.3, -L / 2 + 1.4], 1.1, 0.42);
  lamps(lights, tail, L, 0.75, 1.1);
  return { obj: group(ink, lights, tail, glass, mats), length: L };
}

/** An articulated two-section tram with a pantograph. */
function buildTram(mats: Materials, color: string): { obj: THREE.Group; length: number } {
  const ink = new InkedBuilder(0.07);
  const lights = new GeoBuilder();
  const tail = new GeoBuilder();
  const glass = new GeoBuilder();
  const S = 6.2;
  const L = S * 2 + 0.6;
  for (const cx of [S / 2 + 0.3, -S / 2 - 0.3]) {
    ink.box(cx, 1.55, 0, S, 2.5, 2.3, color);
    ink.fill.box(cx, 0.5, 0, S + 0.02, 0.45, 2.32, '#fff1d6');
    for (let x = cx - S / 2 + 0.8; x < cx + S / 2 - 0.6; x += 1.2) {
      glass.box(x, 1.85, 1.16, 1.0, 0.95, 0.01, '#ffffff');
      glass.box(x, 1.85, -1.16, 1.0, 0.95, 0.01, '#ffffff');
    }
    ink.fill.geometry(new THREE.CylinderGeometry(1.15, 1.15, S, 12, 1, false, 0, Math.PI), m4.compose(new THREE.Vector3(cx, 2.8, 0), q.setFromEuler(eul.set(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 0.25)), '#e9e4ff');
  }
  ink.fill.box(0, 1.55, 0, 0.6, 2.2, 2.0, '#6b5c78'); // articulation
  glass.box(L / 2 + 0.005, 1.9, 0, 0.01, 1.1, 2.0, '#ffffff');
  glass.box(-L / 2 - 0.005, 1.9, 0, 0.01, 1.1, 2.0, '#ffffff');
  tail.box(L / 2 + 0.01, 2.6, 0, 0.02, 0.25, 1.2, '#ffe08a');
  // Pantograph
  q.setFromEuler(eul.set(0, 0, 0.7));
  ink.fill.geometry(new THREE.BoxGeometry(1, 1, 1), m4.compose(new THREE.Vector3(1.2, 3.4, 0), q, new THREE.Vector3(1.3, 0.06, 0.06)), '#4a3a48');
  q.setFromEuler(eul.set(0, 0, -0.7));
  ink.fill.geometry(new THREE.BoxGeometry(1, 1, 1), m4.compose(new THREE.Vector3(1.9, 3.4, 0), q, new THREE.Vector3(1.3, 0.06, 0.06)), '#4a3a48');
  ink.fill.box(1.55, 3.85, 0, 0.1, 0.06, 1.2, '#4a3a48');
  wheels(ink, [L / 2 - 1.2, 0, -L / 2 + 1.2], 1.05, 0.35);
  lamps(lights, tail, L, 0.8, 1.1);
  return { obj: group(ink, lights, tail, glass, mats), length: L };
}

export class Traffic {
  readonly group = new THREE.Group();
  private lanes: Lane[] = [];

  constructor(private mats: Materials, private isStreet: (x: number) => boolean) {
    let c = 0;
    const add = (lane: Lane, count: number, make: () => { obj: THREE.Group; length: number; kind: Kind; maxSpeed: number }) => {
      for (let i = 0; i < count; i++) {
        const v = make();
        v.obj.rotation.y = lane.dir === 1 ? 0 : Math.PI;
        v.obj.position.z = lane.z;
        this.group.add(v.obj);
        lane.vehicles.push({
          obj: v.obj, kind: v.kind, length: v.length, maxSpeed: v.maxSpeed,
          x: -BEHIND + (i + Math.random() * 0.5) * ((AHEAD + BEHIND) / count),
          speed: v.maxSpeed, dwell: 0, nextStop: 15 + Math.random() * 30,
        });
      }
      this.lanes.push(lane);
    };
    const roadMix = () => {
      const r = Math.random();
      const kind: Kind = r < 0.14 ? 'bus' : r < 0.26 ? 'van' : r < 0.36 ? 'taxi' : 'car';
      if (kind === 'bus') return { ...buildBus(this.mats, BODY[c++ % BODY.length]), kind, maxSpeed: 3.6 + Math.random() };
      return { ...buildCar(this.mats, BODY[c++ % BODY.length], kind), kind, maxSpeed: 4.5 + Math.random() * 2.5 };
    };
    // Tram street: a tram line both ways.
    for (const dir of [1, -1] as const) {
      add({ z: TRAM_STREET + dir * 0.75, dir, vehicles: [], corridor: false }, 3, () => ({ ...buildTram(this.mats, dir === 1 ? '#f6c453' : '#8fd1b5'), kind: 'tram', maxSpeed: 4.2 }));
    }
    // Bus street and the corridor's street districts: mixed traffic.
    for (const dir of [1, -1] as const) {
      add({ z: BUS_STREET + dir * 0.8, dir, vehicles: [], corridor: false }, 7, roadMix);
      add({ z: CANAL_Z + dir * 1.0, dir, vehicles: [], corridor: true }, 9, roadMix);
    }
  }

  /** Spread every lane's vehicles around a new camera position. */
  reset(camX: number) {
    for (const lane of this.lanes) {
      const n = lane.vehicles.length;
      lane.vehicles.forEach((v, i) => {
        v.x = camX - BEHIND + 10 + ((i + 0.3 + Math.random() * 0.4) / n) * (AHEAD + BEHIND - 20);
        v.speed = v.maxSpeed;
      });
    }
  }

  /** Smallest bumper-to-bumper gap in any lane (for tests). */
  minGap(): number {
    let g = Infinity;
    for (const lane of this.lanes) {
      const vs = [...lane.vehicles].sort((a, b) => a.x - b.x);
      for (let i = 1; i < vs.length; i++) g = Math.min(g, vs[i].x - vs[i - 1].x - (vs[i].length + vs[i - 1].length) / 2);
    }
    return g;
  }

  update(dt: number, camX: number) {
    for (const lane of this.lanes) {
      const vs = lane.vehicles;
      // Front of the queue first.
      vs.sort((a, b) => (b.x - a.x) * lane.dir);
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        let target = v.maxSpeed;
        if ((v.kind === 'bus' || v.kind === 'tram') && !lane.corridor) {
          v.nextStop -= dt;
          if (v.nextStop <= 0) {
            v.dwell = 3 + Math.random() * 2;
            v.nextStop = 25 + Math.random() * 25;
          }
        }
        if (v.dwell > 0) {
          v.dwell -= dt;
          target = 0;
        }
        if (i > 0) {
          const ahead = vs[i - 1];
          const gap = (ahead.x - v.x) * lane.dir - (ahead.length + v.length) / 2;
          target = Math.min(target, Math.max(0, (gap - 1.2) * 1.1));
        }
        const accel = target > v.speed ? 2.2 : 7;
        v.speed += THREE.MathUtils.clamp(target - v.speed, -accel * dt, accel * dt);
        v.x += v.speed * lane.dir * dt;
        if (i > 0) {
          // Hard guarantee: never overlap the one in front.
          const ahead = vs[i - 1];
          const minGap = (ahead.length + v.length) / 2 + 0.6;
          if ((ahead.x - v.x) * lane.dir < minGap) v.x = ahead.x - lane.dir * minGap;
        }
      }
      // Recycle vehicles that left the view window to the other end of the queue.
      let minX = Infinity, maxX = -Infinity;
      for (const v of vs) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
      }
      for (const v of vs) {
        const sp = v.length + 3 + Math.random() * 12;
        if (v.x < camX - BEHIND) {
          v.x = Math.max(maxX + sp, camX + AHEAD - 20);
          maxX = v.x;
          v.speed = v.maxSpeed * 0.8;
        } else if (v.x > camX + AHEAD) {
          v.x = Math.min(minX - sp, camX - BEHIND + 20);
          minX = v.x;
          v.speed = v.maxSpeed * 0.8;
        }
        v.obj.position.x = v.x;
        v.obj.visible = !lane.corridor || (this.isStreet(v.x - v.length / 2 - 1) && this.isStreet(v.x + v.length / 2 + 1));
      }
    }
  }
}

// ---------------------------------------------------------------------------

const CAR_LEN = 9.5;
const CAR_GAP = 0.6;

/** A train of articulated cars on one track of the viaduct. */
class TrainSet {
  readonly group = new THREE.Group();
  private cars: THREE.Group[] = [];
  private headX = 0;
  private active = false;
  private speed = 14;
  private wait = 0;

  constructor(mats: Materials, private dir: 1 | -1, private offset: number, livery: string, stripe: string, count: number) {
    for (let i = 0; i < count; i++) {
      const lead = i === 0 || i === count - 1;
      const car = buildTrainCar(mats, livery, stripe, lead, i === 0 ? 1 : i === count - 1 ? -1 : 0);
      this.cars.push(car);
      this.group.add(car);
    }
    this.group.visible = false;
    this.wait = 4 + Math.random() * 10;
  }

  get running() {
    return this.active;
  }

  /** Debug: put the train in view right now. */
  placeNear(camX: number) {
    this.dispatch(camX);
    this.headX = camX + 95;
  }

  dispatch(camX: number) {
    if (this.active) return;
    this.active = true;
    this.speed = 13 + Math.random() * 4;
    // Enter from well behind (eastbound) or well ahead (westbound).
    this.headX = this.dir === 1 ? camX - 120 : camX + AHEAD + 40;
    this.group.visible = true;
  }

  update(dt: number, camX: number) {
    if (!this.active) {
      this.wait -= dt;
      if (this.wait <= 0) this.dispatch(camX);
      return;
    }
    this.headX = railStep(this.headX, this.speed * this.dir * dt);
    let x = this.headX;
    for (let i = 0; i < this.cars.length; i++) {
      // Each car's centre sits half a car behind the previous coupling.
      const cx = railStep(x, -this.dir * CAR_LEN / 2);
      const p = trackPoint(cx, this.offset);
      const car = this.cars[i];
      car.position.set(p.x, RAIL_Y, p.z);
      car.rotation.y = railYaw(cx) + (this.dir === 1 ? 0 : Math.PI);
      x = railStep(x, -this.dir * (CAR_LEN + CAR_GAP));
    }
    const tail = x;
    const gone = this.dir === 1 ? tail > camX + AHEAD + 60 : tail < camX - 160;
    if (gone) {
      this.active = false;
      this.group.visible = false;
      this.wait = 18 + Math.random() * 25;
    }
  }
}

function buildTrainCar(mats: Materials, livery: string, stripe: string, cab: boolean, cabDir: number): THREE.Group {
  const ink = new InkedBuilder(0.07);
  const lights = new GeoBuilder();
  const tail = new GeoBuilder();
  const glass = new GeoBuilder();
  const L = CAR_LEN, W = 2.7, H = 2.9;
  ink.box(0, H / 2 + 0.55, 0, L, H, W, livery);
  ink.fill.box(0, 0.95, 0, L + 0.02, 0.28, W + 0.02, stripe);
  ink.fill.box(0, 2.95, 0, L + 0.02, 0.1, W + 0.02, stripe);
  // Rounded roof
  q.setFromEuler(eul.set(0, 0, Math.PI / 2));
  ink.fill.geometry(new THREE.CylinderGeometry(W / 2, W / 2, L - 0.2, 14, 1, false, 0, Math.PI), m4.compose(new THREE.Vector3(0, H + 0.55, 0), q, new THREE.Vector3(1, 1, 0.22)), '#e9e4ff');
  // Window band and doors on both sides
  for (let x = -L / 2 + 1.0; x < L / 2 - 0.8; x += 1.25) {
    if (Math.abs(x - L / 4) < 0.6 || Math.abs(x + L / 4) < 0.6) continue;
    glass.box(x, 2.25, W / 2 + 0.005, 1.0, 0.85, 0.01, '#ffffff');
    glass.box(x, 2.25, -W / 2 - 0.005, 1.0, 0.85, 0.01, '#ffffff');
  }
  for (const dx of [L / 4, -L / 4]) {
    for (const z of [W / 2 + 0.01, -W / 2 - 0.01]) ink.fill.box(dx, 1.9, z, 1.0, 2.1, 0.01, '#8e98d6');
  }
  // Bogies
  for (const bx of [L / 2 - 1.8, -L / 2 + 1.8]) {
    ink.fill.box(bx, 0.35, 0, 2.2, 0.45, W - 0.3, '#4a3a48');
    wheels(ink, [bx - 0.6, bx + 0.6], W / 2 - 0.25, 0.32);
  }
  if (cab) {
    // Sloped nose, windscreen, headlights and a destination board
    const nx = (L / 2 + 0.5) * cabDir;
    q.setFromEuler(eul.set(0, 0, -0.5 * cabDir));
    ink.fill.geometry(new THREE.BoxGeometry(1, 1, 1), m4.compose(new THREE.Vector3(nx - 0.2 * cabDir, 2.3, 0), q, new THREE.Vector3(1.2, 1.6, W - 0.1)), livery);
    glass.box(nx + 0.05 * cabDir, 2.55, 0, 0.02, 0.8, W - 0.5, '#ffffff');
    for (const z of [-0.8, 0.8]) lights.geometry(BULB, m4.makeScale(0.13, 0.1, 0.13).setPosition(nx + 0.45 * cabDir, 1.3, z), '#ffffff');
    tail.box(nx - 0.1 * cabDir, 3.2, 0, 0.02, 0.3, 1.4, '#ffb38a');
    // Pantograph
    ink.fill.box(-cabDir * 1.5, 4.15, 0, 0.1, 0.06, 1.4, '#4a3a48');
    q.setFromEuler(eul.set(0, 0, 0.6));
    ink.fill.geometry(new THREE.BoxGeometry(1, 1, 1), m4.compose(new THREE.Vector3(-cabDir * 1.5 - 0.35, 3.85, 0), q, new THREE.Vector3(1.0, 0.06, 0.06)), '#4a3a48');
  }
  const g = group(ink, lights, tail, glass, mats);
  // Local +X is the direction of travel for a car facing forward.
  return g;
}

export class Railway {
  readonly group = new THREE.Group();
  private trains: TrainSet[];

  constructor(mats: Materials) {
    this.trains = [
      new TrainSet(mats, 1, -1.05, '#a9b3e6', '#7a86cc', 6),
      new TrainSet(mats, -1, 1.05, '#fff1d6', '#e9786f', 5),
    ];
    for (const t of this.trains) this.group.add(t.group);
  }

  /** Called on section changes: send a train if one isn't already running. */
  dispatch(camX: number) {
    const idle = this.trains.find((t) => !t.running);
    idle?.dispatch(camX);
  }

  debugPlace(camX: number) {
    this.trains[0].placeNear(camX);
  }

  update(dt: number, camX: number) {
    for (const t of this.trains) t.update(dt, camX);
  }
}
