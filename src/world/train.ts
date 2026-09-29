import * as THREE from 'three';
import { InkedBuilder, GeoBuilder } from './geo';
import type { Materials } from './materials';
import { TRAIN_Y, TRAIN_Z } from './city';

const CAR_LEN = 9;
const CARS = 6;

/**
 * The elevated train. It waits off-screen and is called in by the music
 * (usually on a section change), then glides across the whole view.
 */
export class Train {
  readonly group = new THREE.Group();
  private active = false;
  private speed = 0;
  private relX = 0;
  private endRel = 0;

  constructor(mats: Materials) {
    const ink = new InkedBuilder(0.07);
    const lit = new GeoBuilder();
    const body = '#a9b3e6';
    const stripe = '#7a86cc';
    for (let i = 0; i < CARS; i++) {
      const cx = -i * (CAR_LEN + 0.5);
      ink.box(cx, 1.7, 0, CAR_LEN, 2.8, 2.6, body);
      ink.box(cx, 3.2, 0, CAR_LEN - 0.3, 0.25, 2.4, '#d6dcf7');
      ink.fill.box(cx, 0.9, 0, CAR_LEN + 0.02, 0.35, 2.62, stripe);
      for (let w = -CAR_LEN / 2 + 1; w < CAR_LEN / 2 - 0.6; w += 1.3) {
        lit.quad(cx + w + 0.3, 2.1, 1.32, 0.9, 0.9, 'pz', '#ffffff');
      }
      // Doors
      ink.fill.quad(cx - CAR_LEN / 4, 1.65, 1.315, 0.9, 2.1, 'pz', '#8e98d6');
      ink.fill.quad(cx + CAR_LEN / 4, 1.65, 1.315, 0.9, 2.1, 'pz', '#8e98d6');
    }
    const add = (g: THREE.BufferGeometry, m: THREE.Material, shadow = false) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = shadow;
      this.group.add(mesh);
    };
    add(ink.fill.build(), mats.toon, true);
    add(ink.outline.build(), mats.ink);
    add(lit.build(), mats.windowLit);
    this.group.position.set(0, TRAIN_Y, TRAIN_Z);
    this.group.visible = false;
  }

  get running(): boolean {
    return this.active;
  }

  /** Send the train across, entering just off the left edge of view. */
  dispatch(duration = 14, startRel = -110) {
    if (this.active) return;
    const half = 110;
    this.relX = startRel;
    this.endRel = half + CARS * (CAR_LEN + 0.5);
    this.speed = (this.endRel - this.relX) / duration;
    this.group.visible = true;
    this.active = true;
  }

  /** Position is tracked relative to the camera so drift never matters. */
  update(dt: number, cameraX: number) {
    if (!this.active) return;
    this.relX += this.speed * dt;
    this.group.position.x = cameraX + this.relX;
    if (this.relX > this.endRel) {
      this.active = false;
      this.group.visible = false;
    }
  }
}
