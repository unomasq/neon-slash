import {
  AdditiveBlending, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry,
} from 'three';
import { HIT_Z_PERFECT } from '../game/tuning';
import { fxState } from '../fx/bus';
import { glow } from './util';
import type { Palette } from './palette';

const HX = 5, Y0 = -3.2, Y1 = 5.5;

/** Неоновая «линия удара» на z = HIT_Z_PERFECT: пол + боковые стойки + слабая «стена». */
export class JudgeLine {
  readonly group = new Group();
  private core: MeshBasicMaterial;
  private halo: MeshBasicMaterial;
  private wall: MeshBasicMaterial;
  private postCore: MeshBasicMaterial;
  private postHalo: MeshBasicMaterial;
  private t = 0;
  private palette?: Palette;
  private base = new Color(0x9ffcff);

  constructor(palette?: Palette) {
    this.palette = palette;
    const mk = (k: number, opacity: number, additive: boolean) => new MeshBasicMaterial({
      color: glow(0x9ffcff, k), transparent: opacity < 1, opacity, side: DoubleSide, depthWrite: false, fog: false,
      blending: additive ? AdditiveBlending : undefined,
    });
    this.core = mk(2.5, 1, false);
    this.halo = mk(0.9, 0.28, true);
    this.wall = mk(1, 0.03, true);
    // стойки: эмиссия ×0.35, ореол opacity ×0.4 (отдельные материалы, чтобы не трогать пол)
    this.postCore = mk(2.5 * 0.35, 1, false);
    this.postHalo = mk(0.9, 0.28 * 0.4, true);
    const z = HIT_Z_PERFECT;
    const plane = (w: number, h: number, mat: MeshBasicMaterial, x: number, y: number, flat: boolean) => {
      const m = new Mesh(new PlaneGeometry(w, h), mat);
      m.position.set(x, y, z);
      if (flat) m.rotation.x = -Math.PI / 2;
      m.frustumCulled = false;
      this.group.add(m);
    };
    const yf = Y0 + 0.02, hh = Y1 - Y0, yc = (Y0 + Y1) / 2;
    plane(HX * 2, 0.1, this.core, 0, yf, true);       // яркая линия на полу
    plane(HX * 2, 0.7, this.halo, 0, yf + 0.01, true); // ореол-полоска (видна и без bloom)
    for (const sx of [-HX, HX]) {
      plane(0.035, hh, this.postCore, sx, yc, false);
      plane(0.2, hh, this.postHalo, sx, yc, false);
    }
    plane(HX * 2, hh, this.wall, 0, yc, false);
  }

  update(dt: number, boost = 1): void {
    this.t += dt;
    const k = (1 + 0.15 * Math.sin(this.t * Math.PI * 2)) * (1 + 1.2 * fxState.beatPulse + 0.5 * fxState.bass) * boost;
    const base = this.palette ? this.palette.current.judge : this.base;
    this.core.color.copy(base).multiplyScalar(2.5 * k);
    this.halo.color.copy(base).multiplyScalar(0.9);
    this.halo.opacity = Math.min(1, 0.28 * k);
    this.postCore.color.copy(base).multiplyScalar(2.5 * 0.35 * k);
    this.postHalo.color.copy(base).multiplyScalar(0.9);
    this.postHalo.opacity = Math.min(1, 0.28 * 0.4 * k);
  }
}
