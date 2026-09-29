import * as THREE from 'three';
import { InkedBuilder, GeoBuilder } from './geo';
import type { Materials } from './materials';
import { railStep, railYaw, trackPoint, trainY, nextStation, TRACK_OFFSET } from './rail';
import { CANAL_Z, TRAM_STREET, BUS_STREET, CHUNK_W } from './city';

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
  /** The next junction and whether this vehicle will turn there. */
  plan: { jx: number; turn: boolean } | null;
}

interface Lane {
  z: number;
  dir: 1 | -1;
  vehicles: Vehicle[];
  /** The corridor's lanes: fed only by cars turning in from the avenues. */
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
  const L = 6.2;
  ink.box(0, 1.3, 0, L, 2.0, 2.0, color);
  ink.fill.box(0, 0.5, 0, L + 0.02, 0.42, 2.02, '#fff1d6');
  ink.box(0, 2.38, 0, L - 0.6, 0.14, 1.75, '#e9e4ff');
  for (let x = -L / 2 + 0.8; x < L / 2 - 0.8; x += 1.0) {
    glass.box(x, 1.55, 1.01, 0.82, 0.7, 0.01, '#ffffff');
    glass.box(x, 1.55, -1.01, 0.82, 0.7, 0.01, '#ffffff');
  }
  glass.box(L / 2 + 0.005, 1.55, 0, 0.01, 0.9, 1.75, '#ffffff');
  tail.box(L / 2 + 0.01, 2.12, 0, 0.02, 0.22, 1.2, '#ffb38a'); // destination sign
  for (const dx of [L / 2 - 0.95, -0.3]) ink.fill.box(dx, 1.05, 1.011, 0.8, 1.55, 0.01, '#8e98d6');
  wheels(ink, [L / 2 - 1.1, -L / 2 + 1.2], 0.95, 0.36);
  lamps(lights, tail, L, 0.65, 0.95);
  return { obj: group(ink, lights, tail, glass, mats), length: L };
}

/** An articulated two-section tram with a pantograph. */
function buildTram(mats: Materials, color: string): { obj: THREE.Group; length: number } {
  const ink = new InkedBuilder(0.07);
  const lights = new GeoBuilder();
  const tail = new GeoBuilder();
  const glass = new GeoBuilder();
  const S = 5.0;
  const L = S * 2 + 0.5;
  for (const cx of [S / 2 + 0.3, -S / 2 - 0.3]) {
    ink.box(cx, 1.35, 0, S, 2.1, 2.0, color);
    ink.fill.box(cx, 0.45, 0, S + 0.02, 0.38, 2.02, '#fff1d6');
    for (let x = cx - S / 2 + 0.8; x < cx + S / 2 - 0.6; x += 1.2) {
      glass.box(x, 1.6, 1.01, 0.9, 0.8, 0.01, '#ffffff');
      glass.box(x, 1.6, -1.01, 0.9, 0.8, 0.01, '#ffffff');
    }
    ink.fill.geometry(new THREE.CylinderGeometry(1.0, 1.0, S, 12, 1, false, 0, Math.PI), m4.compose(new THREE.Vector3(cx, 2.4, 0), q.setFromEuler(eul.set(0, 0, Math.PI / 2)), new THREE.Vector3(0.22, 1, 1)), '#e9e4ff');
  }
  ink.fill.box(0, 1.35, 0, 0.5, 1.9, 1.7, '#6b5c78'); // articulation
  glass.box(L / 2 + 0.005, 1.65, 0, 0.01, 0.95, 1.7, '#ffffff');
  glass.box(-L / 2 - 0.005, 1.65, 0, 0.01, 0.95, 1.7, '#ffffff');
  tail.box(L / 2 + 0.01, 2.25, 0, 0.02, 0.22, 1.0, '#ffe08a');
  // Pantograph
  q.setFromEuler(eul.set(0, 0, 0.7));
  ink.fill.geometry(new THREE.BoxGeometry(1, 1, 1), m4.compose(new THREE.Vector3(1.0, 2.9, 0), q, new THREE.Vector3(1.1, 0.05, 0.05)), '#4a3a48');
  q.setFromEuler(eul.set(0, 0, -0.7));
  ink.fill.geometry(new THREE.BoxGeometry(1, 1, 1), m4.compose(new THREE.Vector3(1.6, 2.9, 0), q, new THREE.Vector3(1.1, 0.05, 0.05)), '#4a3a48');
  ink.fill.box(1.3, 3.3, 0, 0.08, 0.05, 1.0, '#4a3a48');
  wheels(ink, [L / 2 - 1.0, 0, -L / 2 + 1.0], 0.9, 0.3);
  lamps(lights, tail, L, 0.7, 0.95);
  return { obj: group(ink, lights, tail, glass, mats), length: L };
}

/** Where a turning car is heading: off the corridor or onto it, on either bank. */
type RouteKind = 'outMain' | 'inMain' | 'outMir' | 'inMir';

interface Route {
  key: string;
  kind: RouteKind;
  jx: number;
  pts: THREE.Vector2[];
  cum: number[];
  len: number;
  to: Lane;
  joinX: number;
  /** Progress where the final corner starts: wait here until the lane is clear. */
  giveWay: number;
  /** Progress range occupied by the tram tracks (main-bank routes only). */
  tramZone: [number, number] | null;
  riders: Mover[];
}

interface Mover {
  v: Vehicle;
  route: Route;
  s: number;
  cleared: boolean;
}

const R = 1.4; // corner radius
const AV = 0.65; // avenue lanes sit this far either side of the avenue centre
const JUNCTION = 2; // avenue centre, local x within each chunk
const CORRIDOR_CAP = 8;
const MIR_STREET = 2 * CANAL_Z - TRAM_STREET;

export class Traffic {
  readonly group = new THREE.Group();
  private lanes: Lane[] = [];
  private tramLanes: Lane[] = [];
  private corrPlus!: Lane;
  private corrMinus!: Lane;
  private busPlus!: Lane;
  private mirMinus!: Lane;
  private routes = new Map<string, Route>();
  /** Road vehicles currently off-stage, waiting to drive back in at the edge of the view. */
  private spare: Vehicle[] = [];
  private camX = 0;

  constructor(private mats: Materials, private isStreet: (x: number) => boolean) {
    let c = 0;
    const lane = (z: number, dir: 1 | -1, corridor = false): Lane => {
      const l: Lane = { z, dir, vehicles: [], corridor };
      this.lanes.push(l);
      return l;
    };
    const make = (l: Lane, v: { obj: THREE.Group; length: number; kind: Kind; maxSpeed: number }, i: number, count: number) => {
      this.group.add(v.obj);
      const veh: Vehicle = {
        obj: v.obj, kind: v.kind, length: v.length, maxSpeed: v.maxSpeed,
        x: -BEHIND + (i + Math.random() * 0.5) * ((AHEAD + BEHIND) / count),
        speed: v.maxSpeed, dwell: 0, nextStop: 15 + Math.random() * 30, plan: null,
      };
      this.place(veh, l);
      l.vehicles.push(veh);
    };
    const roadMix = (allowBus: boolean) => {
      const r = Math.random();
      const kind: Kind = allowBus && r < 0.14 ? 'bus' : r < 0.26 ? 'van' : r < 0.36 ? 'taxi' : 'car';
      if (kind === 'bus') return { ...buildBus(this.mats, BODY[c++ % BODY.length]), kind, maxSpeed: 3.6 + Math.random() };
      return { ...buildCar(this.mats, BODY[c++ % BODY.length], kind), kind, maxSpeed: 4.5 + Math.random() * 2.5 };
    };
    // Tram street: a tram line both ways.
    for (const dir of [1, -1] as const) {
      const l = lane(TRAM_STREET + dir * 0.75, dir);
      this.tramLanes.push(l);
      for (let i = 0; i < 3; i++) make(l, { ...buildTram(this.mats, dir === 1 ? '#f6c453' : '#8fd1b5'), kind: 'tram', maxSpeed: 4.2 }, i, 3);
    }
    // Bus street (main bank) and the first street on the far bank: mixed traffic.
    this.busPlus = lane(BUS_STREET + 0.8, 1);
    const busMinus = lane(BUS_STREET - 0.8, -1);
    const mirPlus = lane(MIR_STREET + 0.8, 1);
    this.mirMinus = lane(MIR_STREET - 0.8, -1);
    for (const l of [this.busPlus, busMinus]) for (let i = 0; i < 8; i++) make(l, roadMix(true), i, 8);
    for (const l of [mirPlus, this.mirMinus]) for (let i = 0; i < 6; i++) make(l, roadMix(false), i, 6);
    // The corridor's street districts: filled only by cars turning in from the avenues.
    this.corrPlus = lane(CANAL_Z + 1.0, 1, true);
    this.corrMinus = lane(CANAL_Z - 1.0, -1, true);
    for (let i = 0; i < 10; i++) {
      const v = roadMix(false);
      this.group.add(v.obj);
      this.spare.push({ obj: v.obj, kind: v.kind, length: v.length, maxSpeed: v.maxSpeed, x: 0, speed: 0, dwell: 0, nextStop: 0, plan: null });
      v.obj.visible = false;
    }
  }

  private place(v: Vehicle, l: Lane) {
    v.obj.rotation.set(0, l.dir === 1 ? 0 : Math.PI, 0);
    v.obj.position.set(v.x, 0, l.z);
    v.obj.visible = true;
  }

  /** Is x a stretch of corridor street that traffic in either direction can reach? */
  private corridorOk(x: number): boolean {
    const k = Math.floor(x / CHUNK_W);
    const l = x - k * CHUNK_W;
    const at = (kk: number) => this.isStreet(kk * CHUNK_W + 1);
    return at(k) && (l < JUNCTION ? at(k - 1) : at(k + 1));
  }

  /** Spread every lane's vehicles around a new camera position. */
  reset(camX: number) {
    this.camX = camX;
    // Gather every road vehicle, then deal them out again.
    const road: Vehicle[] = [...this.spare];
    this.spare = [];
    for (const r of this.routes.values()) for (const m of r.riders) road.push(m.v);
    this.routes.clear();
    for (const l of this.lanes) {
      if (this.tramLanes.includes(l)) continue;
      road.push(...l.vehicles);
      l.vehicles = [];
    }
    road.sort(() => Math.random() - 0.5);
    const deal = (l: Lane, n: number, ok: (x: number) => boolean) => {
      for (let i = 0; i < n && road.length; i++) {
        const x = camX - BEHIND + 10 + ((i + 0.3 + Math.random() * 0.4) / n) * (AHEAD + BEHIND - 20);
        if (!ok(x)) continue;
        const v = road.findIndex((r) => l.corridor ? r.kind !== 'bus' : true);
        if (v < 0) continue;
        const veh = road.splice(v, 1)[0];
        veh.x = x;
        veh.speed = veh.maxSpeed;
        veh.plan = null;
        this.place(veh, l);
        l.vehicles.push(veh);
      }
    };
    deal(this.corrPlus, 14, (x) => this.corridorOk(x));
    deal(this.corrMinus, 14, (x) => this.corridorOk(x));
    const roads = this.lanes.filter((l) => !l.corridor && !this.tramLanes.includes(l));
    for (const l of roads) deal(l, 7, () => true);
    for (const v of road) {
      v.obj.visible = false;
      this.spare.push(v);
    }
    for (const l of this.tramLanes) {
      const n = l.vehicles.length;
      l.vehicles.forEach((v, i) => {
        v.x = camX - BEHIND + 10 + ((i + 0.3 + Math.random() * 0.4) / n) * (AHEAD + BEHIND - 20);
        v.speed = v.maxSpeed;
      });
    }
  }

  /** Smallest bumper-to-bumper gap in any lane or turning route (for tests). */
  minGap(): number {
    let g = Infinity;
    for (const lane of this.lanes) {
      const vs = [...lane.vehicles].sort((a, b) => a.x - b.x);
      for (let i = 1; i < vs.length; i++) g = Math.min(g, vs[i].x - vs[i - 1].x - (vs[i].length + vs[i - 1].length) / 2);
    }
    for (const r of this.routes.values()) {
      const ms = [...r.riders].sort((a, b) => a.s - b.s);
      for (let i = 1; i < ms.length; i++) g = Math.min(g, ms[i].s - ms[i - 1].s - (ms[i].v.length + ms[i - 1].v.length) / 2);
    }
    return g;
  }

  /** Vehicles on turning routes right now (for tests). */
  turning(): number {
    let n = 0;
    for (const r of this.routes.values()) n += r.riders.length;
    return n;
  }

  // ---- Routes: corner, avenue, corner --------------------------------------

  private routeFor(kind: RouteKind, jx: number): Route {
    const key = `${kind}:${jx}`;
    const hit = this.routes.get(key);
    if (hit) return hit;
    const xa = jx + AV, xb = jx - AV;
    const zc = this.corrMinus.z, zp = this.corrPlus.z, zb = this.busPlus.z, zm = this.mirMinus.z;
    // Each route: start, first corner, straight run up the avenue, second corner, end.
    const spec: Record<RouteKind, { a: [number, number]; c1: [number, number]; c2: [number, number]; e: [number, number]; to: Lane }> = {
      outMain: { a: [xa + R, zc], c1: [xa, zc], c2: [xa, zb], e: [xa + R, zb], to: this.busPlus },
      inMain: { a: [xb - R, zb], c1: [xb, zb], c2: [xb, zc], e: [xb - R, zc], to: this.corrMinus },
      outMir: { a: [xb - R, zp], c1: [xb, zp], c2: [xb, zm], e: [xb - R, zm], to: this.mirMinus },
      inMir: { a: [xa + R, zm], c1: [xa, zm], c2: [xa, zp], e: [xa + R, zp], to: this.corrPlus },
    };
    const sp = spec[kind];
    const pts: THREE.Vector2[] = [];
    const corner = (from: THREE.Vector2, c: THREE.Vector2, to: THREE.Vector2) => {
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        pts.push(new THREE.Vector2(u * u * from.x + 2 * u * t * c.x + t * t * to.x, u * u * from.y + 2 * u * t * c.y + t * t * to.y));
      }
    };
    const A = new THREE.Vector2(...sp.a), C1 = new THREE.Vector2(...sp.c1), C2 = new THREE.Vector2(...sp.c2), E = new THREE.Vector2(...sp.e);
    const toward = (p: THREE.Vector2, q2: THREE.Vector2) => p.clone().add(q2.clone().sub(p).setLength(R));
    corner(A, C1, toward(C1, C2));
    const lastCorner = pts.length;
    corner(toward(C2, C1), C2, E);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    let tramZone: [number, number] | null = null;
    if (kind === 'outMain' || kind === 'inMain') {
      // Progress where the avenue crosses the tram street.
      const s0 = cum[lastCorner - 1];
      const zStart = pts[lastCorner - 1].y;
      const dz = (z: number) => s0 + Math.abs(z - zStart);
      const a = dz(TRAM_STREET + (kind === 'inMain' ? -2.1 : 2.1)), b = dz(TRAM_STREET + (kind === 'inMain' ? 2.1 : -2.1));
      tramZone = [Math.min(a, b), Math.max(a, b)];
    }
    const r: Route = {
      key, kind, jx, pts, cum, len: cum[cum.length - 1], to: sp.to, joinX: E.x,
      giveWay: cum[lastCorner], tramZone, riders: [],
    };
    this.routes.set(key, r);
    return r;
  }

  private pointAt(r: Route, s: number, out: THREE.Vector2): number {
    const cum = r.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = THREE.MathUtils.clamp((s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), 0, 1);
    out.copy(r.pts[i - 1]).lerp(r.pts[i], t);
    const d = r.pts[i].clone().sub(r.pts[i - 1]);
    return Math.atan2(-d.y, d.x);
  }

  /** Which route (if any) a lane feeds, and where along x its trigger point sits relative to the junction. */
  private feeds(l: Lane): { kind: RouteKind; off: number } | null {
    if (l === this.corrMinus) return { kind: 'outMain', off: AV + R };
    if (l === this.busPlus) return { kind: 'inMain', off: -AV - R };
    if (l === this.corrPlus) return { kind: 'outMir', off: -AV - R };
    if (l === this.mirMinus) return { kind: 'inMir', off: AV + R };
    return null;
  }

  /** Should a vehicle on lane l turn at junction jx? */
  private decide(v: Vehicle, kind: RouteKind, jx: number): boolean {
    const k = Math.round((jx - JUNCTION) / CHUNK_W);
    const street = (kk: number) => this.isStreet(kk * CHUNK_W + 1);
    if (!street(k)) return false;
    switch (kind) {
      // Leaving the corridor: forced before a dead end, otherwise now and then.
      case 'outMain': return !street(k - 1) || Math.random() < 0.3;
      case 'outMir': return !street(k + 1) || Math.random() < 0.3;
      // Joining it: only where the corridor carries on in the direction of travel.
      case 'inMain': return v.kind !== 'bus' && street(k - 1) && this.corrMinus.vehicles.length < CORRIDOR_CAP && Math.random() < 0.35;
      case 'inMir': return street(k + 1) && this.corrPlus.vehicles.length < CORRIDOR_CAP && Math.random() < 0.35;
    }
  }

  private tramNear(x: number): boolean {
    for (const l of this.tramLanes) for (const t of l.vehicles) if (Math.abs(t.x - x) < t.length / 2 + 7) return true;
    return false;
  }

  /** Is there physically room for a vehicle of length len centred at x right now? */
  private roomAt(l: Lane, x: number, len: number): boolean {
    for (const v of l.vehicles) if (Math.abs(v.x - x) < (v.length + len) / 2 + 0.7) return false;
    return true;
  }

  private laneClear(l: Lane, x: number, len: number): boolean {
    for (const v of l.vehicles) {
      const rel = (v.x - x) * l.dir;
      if (rel > -(v.length / 2 + len / 2 + 7) && rel < v.length / 2 + len / 2 + 2.5) return false;
    }
    return true;
  }

  // ---- Per frame -------------------------------------------------------------

  update(dt: number, camX: number) {
    this.camX = camX;
    const tmp = new THREE.Vector2();
    for (const lane of this.lanes) {
      const vs = lane.vehicles;
      const feed = this.feeds(lane);
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
        // Turning plans: slow for the corner, then hand over to the route.
        let trigger = NaN;
        if (feed) {
          const k = lane.dir === 1
            ? Math.floor((v.x - feed.off - JUNCTION) / CHUNK_W) + 1
            : Math.ceil((v.x - feed.off - JUNCTION) / CHUNK_W) - 1;
          const jx = k * CHUNK_W + JUNCTION;
          if (!v.plan || (v.plan.jx !== jx && !(v.plan.turn && (v.plan.jx + feed.off - v.x) * lane.dir > -0.5))) {
            v.plan = { jx, turn: this.decide(v, feed.kind, jx) };
          }
          if (v.plan.turn) {
            trigger = v.plan.jx + feed.off;
            const d = (trigger - v.x) * lane.dir;
            target = Math.min(target, 2.6 + Math.max(0, d) * 0.45);
          }
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
        if (feed && v.plan?.turn && (v.x - trigger) * lane.dir >= 0) {
          const r = this.routeFor(feed.kind, v.plan.jx);
          const last = r.riders.reduce((m, o) => Math.min(m, o.s - o.v.length / 2), Infinity);
          if (last > v.length / 2 + 0.8) {
            r.riders.push({ v, route: r, s: 0, cleared: false });
            vs.splice(i, 1);
            i--;
            v.plan = null;
            continue;
          }
          // Route is backed up: wait at the corner.
          v.x = trigger;
          v.speed = 0;
        }
      }
      // Recycle vehicles that left the view window.
      let minX = Infinity, maxX = -Infinity;
      for (const v of vs) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
      }
      for (let i = vs.length - 1; i >= 0; i--) {
        const v = vs[i];
        const out = v.x < camX - BEHIND || v.x > camX + AHEAD;
        if (out && lane.corridor) {
          // Corridor cars only ever arrive by the avenues; park this one off-stage.
          vs.splice(i, 1);
          v.obj.visible = false;
          this.spare.push(v);
          continue;
        }
        const sp = v.length + 3 + Math.random() * 12;
        if (v.x < camX - BEHIND) {
          v.x = Math.max(maxX + sp, camX + AHEAD - 20);
          maxX = v.x;
          v.speed = v.maxSpeed * 0.8;
          v.plan = null;
        } else if (v.x > camX + AHEAD) {
          v.x = Math.min(minX - sp, camX - BEHIND + 20);
          minX = v.x;
          v.speed = v.maxSpeed * 0.8;
          v.plan = null;
        }
        v.obj.position.set(v.x, 0, lane.z);
        v.obj.rotation.set(0, lane.dir === 1 ? 0 : Math.PI, 0);
        v.obj.scale.setScalar(this.fade(v.x));
      }
    }

    // Turning cars follow their route, queueing, waiting for trams and giving way at the end.
    for (const [key, r] of this.routes) {
      const ms = r.riders.sort((a, b) => b.s - a.s);
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        const v = m.v;
        let target = Math.min(v.maxSpeed, 4.2);
        const nearCorner = m.s < R * 1.6 || m.s > r.giveWay - 1;
        if (nearCorner) target = Math.min(target, 2.8);
        if (i > 0) {
          const gap = ms[i - 1].s - m.s - (ms[i - 1].v.length + v.length) / 2;
          target = Math.min(target, Math.max(0, (gap - 1.0) * 1.1));
        }
        const front = m.s + v.length / 2;
        if (r.tramZone && front < r.tramZone[0] + 0.05 && front > r.tramZone[0] - 6 && this.tramNear(r.jx)) {
          target = Math.min(target, Math.max(0, (r.tramZone[0] - 0.3 - front) * 1.5));
        }
        if (!m.cleared) {
          if (front >= r.giveWay - 1.2 && this.laneClear(r.to, r.joinX, v.length)) m.cleared = true;
          else if (front > r.giveWay - 6) target = Math.min(target, Math.max(0, (r.giveWay - 0.3 - front) * 1.5));
        }
        const accel = target > v.speed ? 2.2 : 7;
        v.speed += THREE.MathUtils.clamp(target - v.speed, -accel * dt, accel * dt);
        m.s += v.speed * dt;
        if (i > 0) m.s = Math.min(m.s, ms[i - 1].s - (ms[i - 1].v.length + v.length) / 2 - 0.4);
        if (m.s >= r.len && !this.roomAt(r.to, r.joinX, v.length)) {
          // The lane filled up during the corner: wait at the end of it.
          m.s = r.len - 0.001;
          v.speed = 0;
        }
        if (m.s >= r.len) {
          // Merge into the lane.
          ms.splice(i, 1);
          i--;
          v.x = r.joinX + r.to.dir * (m.s - r.len);
          v.plan = { jx: r.jx, turn: false };
          r.to.vehicles.push(v);
          this.place(v, r.to);
          continue;
        }
        const yaw = this.pointAt(r, m.s, tmp);
        v.obj.position.set(tmp.x, 0, tmp.y);
        v.obj.rotation.set(0, yaw, 0);
        v.obj.scale.setScalar(this.fade(tmp.x));
      }
      if (!ms.length && (r.jx < camX - BEHIND - 40 || r.jx > camX + AHEAD + 40)) this.routes.delete(key);
    }
    // Route riders that drifted far out of the window go off-stage too.
    for (const r of this.routes.values()) {
      if (r.jx > camX - BEHIND - 10 && r.jx < camX + AHEAD + 10) continue;
      for (const m of r.riders) {
        m.v.obj.visible = false;
        this.spare.push(m.v);
      }
      r.riders.length = 0;
    }

    // Bring spare vehicles back in at the far edges of the view, where the fog hides them.
    if (this.spare.length) {
      const roads = [this.busPlus, this.mirMinus, ...this.lanes.filter((l) => !l.corridor && !this.tramLanes.includes(l) && l !== this.busPlus && l !== this.mirMinus)];
      for (const l of roads) {
        if (!this.spare.length) break;
        const entry = l.dir === 1 ? camX - BEHIND + 4 : camX + AHEAD - 4;
        const idx = this.spare.findIndex((v) => l.corridor ? v.kind !== 'bus' : true);
        if (idx < 0) break;
        const v = this.spare[idx];
        if (!this.laneClear(l, entry, v.length + 4)) continue;
        this.spare.splice(idx, 1);
        v.x = entry;
        v.speed = v.maxSpeed * 0.8;
        v.plan = null;
        this.place(v, l);
        v.obj.scale.setScalar(this.fade(entry));
        l.vehicles.push(v);
      }
    }
  }

  /** Vehicles shrink away over the last stretch of the view window instead of popping. */
  private fade(x: number): number {
    const a = THREE.MathUtils.clamp((x - (this.camX - BEHIND)) / 12, 0, 1);
    const b = THREE.MathUtils.clamp((this.camX + AHEAD - x) / 30, 0, 1);
    return Math.max(0.001, Math.min(a, b));
  }
}

// ---------------------------------------------------------------------------

const CAR_LEN = 7.2;
const CAR_GAP = 0.45;

/** A train of articulated cars on one track of the viaduct. */
class TrainSet {
  readonly group = new THREE.Group();
  private cars: THREE.Group[] = [];
  private headX = 0;
  private active = false;
  private speed = 0;
  private maxSpeed = 12;
  private wait = 0;
  private dwell = 0;
  private served = NaN;

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
    this.maxSpeed = 11 + Math.random() * 3;
    this.speed = this.maxSpeed;
    this.served = NaN;
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
    // Brake smoothly into the next station and wait there.
    const trainLen = this.cars.length * (CAR_LEN + CAR_GAP);
    const centre = railStep(this.headX, (-this.dir * trainLen) / 2);
    let target = this.maxSpeed;
    if (this.dwell > 0) {
      this.dwell -= dt;
      target = 0;
    } else {
      const st = nextStation(centre - this.dir * 0.5, this.dir);
      if (st && st.x !== this.served) {
        const d = (st.x - centre) * this.dir;
        target = Math.min(target, Math.sqrt(2 * 1.6 * Math.max(0, d)) + 0.3);
        if (d < 0.35) {
          this.dwell = 6 + Math.random() * 3;
          this.served = st.x;
          target = 0;
          this.speed = 0;
        }
      }
    }
    this.speed += THREE.MathUtils.clamp(target - this.speed, -3 * dt, 1.4 * dt);
    this.headX = railStep(this.headX, this.speed * this.dir * dt);
    let x = this.headX;
    for (let i = 0; i < this.cars.length; i++) {
      // Each car's centre sits half a car behind the previous coupling.
      const cx = railStep(x, (-this.dir * CAR_LEN) / 2);
      const p = trackPoint(cx, this.offset);
      const car = this.cars[i];
      const ahead = railStep(cx, 1), behind = railStep(cx, -1);
      const y = trainY(cx);
      car.position.set(p.x, y, p.z);
      car.rotation.set(0, railYaw(cx) + (this.dir === 1 ? 0 : Math.PI), Math.atan2(trainY(ahead) - trainY(behind), 2) * this.dir, 'YZX');
      // Deep in a tunnel it's under the street anyway; skip drawing it.
      car.visible = y > -5.2;
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
  const L = CAR_LEN, W = 2.1, H = 2.25;
  ink.box(0, H / 2 + 0.45, 0, L, H, W, livery);
  ink.fill.box(0, 0.8, 0, L + 0.02, 0.22, W + 0.02, stripe);
  ink.fill.box(0, 2.5, 0, L + 0.02, 0.08, W + 0.02, stripe);
  // Rounded roof
  q.setFromEuler(eul.set(0, 0, Math.PI / 2));
  ink.fill.geometry(new THREE.CylinderGeometry(W / 2, W / 2, L - 0.2, 14, 1, false, 0, Math.PI), m4.compose(new THREE.Vector3(0, H + 0.45, 0), q, new THREE.Vector3(0.22, 1, 1)), '#e9e4ff');
  // Window band and doors on both sides
  for (let x = -L / 2 + 0.8; x < L / 2 - 0.6; x += 0.95) {
    if (Math.abs(x - L / 4) < 0.45 || Math.abs(x + L / 4) < 0.45) continue;
    glass.box(x, 1.85, W / 2 + 0.005, 0.75, 0.65, 0.01, '#ffffff');
    glass.box(x, 1.85, -W / 2 - 0.005, 0.75, 0.65, 0.01, '#ffffff');
  }
  for (const dx of [L / 4, -L / 4]) {
    for (const z of [W / 2 + 0.01, -W / 2 - 0.01]) ink.fill.box(dx, 1.55, z, 0.75, 1.7, 0.01, '#8e98d6');
  }
  // Bogies
  for (const bx of [L / 2 - 1.4, -L / 2 + 1.4]) {
    ink.fill.box(bx, 0.28, 0, 1.7, 0.35, W - 0.3, '#4a3a48');
    wheels(ink, [bx - 0.45, bx + 0.45], W / 2 - 0.2, 0.25);
  }
  if (cab) {
    // Sloped nose, windscreen, headlights and a destination board
    const nx = (L / 2 + 0.35) * cabDir;
    q.setFromEuler(eul.set(0, 0, -0.5 * cabDir));
    ink.fill.geometry(new THREE.BoxGeometry(1, 1, 1), m4.compose(new THREE.Vector3(nx - 0.15 * cabDir, 1.85, 0), q, new THREE.Vector3(0.9, 1.25, W - 0.08)), livery);
    glass.box(nx + 0.04 * cabDir, 2.05, 0, 0.02, 0.6, W - 0.4, '#ffffff');
    for (const z of [-0.6, 0.6]) lights.geometry(BULB, m4.makeScale(0.1, 0.08, 0.1).setPosition(nx + 0.35 * cabDir, 1.05, z), '#ffffff');
    tail.box(nx - 0.08 * cabDir, 2.6, 0, 0.02, 0.24, 1.1, '#ffb38a');
    // Pantograph
    ink.fill.box(-cabDir * 1.2, 3.3, 0, 0.08, 0.05, 1.1, '#4a3a48');
    q.setFromEuler(eul.set(0, 0, 0.6));
    ink.fill.geometry(new THREE.BoxGeometry(1, 1, 1), m4.compose(new THREE.Vector3(-cabDir * 1.2 - 0.28, 3.05, 0), q, new THREE.Vector3(0.8, 0.05, 0.05)), '#4a3a48');
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
      new TrainSet(mats, 1, -TRACK_OFFSET, '#a9b3e6', '#7a86cc', 6),
      new TrainSet(mats, -1, TRACK_OFFSET, '#fff1d6', '#e9786f', 5),
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
