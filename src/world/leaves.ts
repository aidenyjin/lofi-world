import * as THREE from 'three';
import { FOLIAGE } from '../palette';
import type { Materials } from './materials';

const COUNT = 260;

interface Leaf {
  p: THREE.Vector3;
  fall: number;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  sway: number;
  phase: number;
  size: number;
}

/**
 * Autumn leaves drifting through the diorama. Wind gusts come from the
 * music: every bar gives a nudge and hi-hats keep them fluttering.
 */
export class Leaves {
  readonly mesh: THREE.InstancedMesh;
  private leaves: Leaf[] = [];
  private gust = 0;
  private flutter = 0;
  private dummy = new THREE.Object3D();

  constructor(mats: Materials, private center: () => THREE.Vector3) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, mats.leaf, COUNT);
    this.mesh.frustumCulled = false;
    const color = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const leaf: Leaf = {
        p: new THREE.Vector3(),
        fall: 0,
        spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 2),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        sway: 0.6 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        size: 0.28 + Math.random() * 0.25,
      };
      this.respawn(leaf, true);
      this.leaves.push(leaf);
      this.mesh.setColorAt(i, color.set(FOLIAGE[i % FOLIAGE.length]));
    }
  }

  private respawn(leaf: Leaf, anywhere: boolean) {
    const c = this.center();
    leaf.p.set(
      c.x + (Math.random() - 0.5) * 90 - (anywhere ? 0 : 20),
      anywhere ? Math.random() * 34 : 26 + Math.random() * 10,
      c.z + (Math.random() - 0.6) * 70,
    );
    leaf.fall = 0.9 + Math.random() * 1.2;
  }

  /** Called on every bar downbeat. */
  gustNow(strength = 1) {
    this.gust = Math.min(3, this.gust + 1.4 * strength);
  }

  /** Called on hi-hats; keeps the spin lively. */
  flutterNow(v: number) {
    this.flutter = Math.min(1.5, this.flutter + v * 0.25);
  }

  update(dt: number, time: number, density: number) {
    this.gust *= Math.exp(-dt * 0.9);
    this.flutter *= Math.exp(-dt * 4);
    const c = this.center();
    const wind = 1.2 + this.gust * 3.5;
    const visible = Math.floor(COUNT * Math.min(1, Math.max(0.15, density)));
    for (let i = 0; i < COUNT; i++) {
      const L = this.leaves[i];
      if (i >= visible) {
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      L.p.y -= L.fall * dt * (1 - Math.min(0.6, this.gust * 0.2));
      L.p.x += (wind + Math.sin(time * L.sway + L.phase) * 1.5) * dt;
      L.p.z += Math.cos(time * L.sway * 0.7 + L.phase) * 0.6 * dt;
      const spinRate = 1 + this.flutter + this.gust * 0.5;
      L.rot.x += L.spin.x * dt * spinRate;
      L.rot.y += L.spin.y * dt * spinRate;
      L.rot.z += L.spin.z * dt * spinRate;
      if (L.p.y < 0 || L.p.x > c.x + 55 || L.p.x < c.x - 70) this.respawn(L, false);
      this.dummy.position.copy(L.p);
      this.dummy.rotation.copy(L.rot);
      this.dummy.scale.setScalar(L.size);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
