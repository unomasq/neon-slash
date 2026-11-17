import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Points, PointsMaterial } from 'three';
import { fxState } from '../fx/bus';
import type { Palette } from './palette';
import { getGlowTexture } from './util';

const MAX = 500;
const COUNTS = [0, 150, 250, 500];
const X = 6.5, Y0 = -3, Y1 = 5.2, Z_NEAR = 6, Z_FAR = -45;

/** Пылинки, плывущие к камере. */
export class Dust {
  readonly object3d = new Group();
  private palette?: Palette;
  private pts: Points;
  private geo = new BufferGeometry();
  private mat: PointsMaterial;
  private pos = new Float32Array(MAX * 3);
  private spd = new Float32Array(MAX);
  private n = 0;

  constructor(palette?: Palette) {
    this.palette = palette;
    for (let i = 0; i < MAX; i++) {
      this.pos[i * 3] = (Math.random() * 2 - 1) * X;
      this.pos[i * 3 + 1] = Y0 + Math.random() * (Y1 - Y0);
      this.pos[i * 3 + 2] = Z_FAR + Math.random() * (Z_NEAR - Z_FAR);
      this.spd[i] = 2 + Math.random() * 2;
    }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.mat = new PointsMaterial({
      size: 0.045, map: getGlowTexture(), transparent: true, opacity: 0.7, blending: AdditiveBlending,
      depthWrite: false, sizeAttenuation: true,
    });
    this.pts = new Points(this.geo, this.mat);
    this.pts.frustumCulled = false;
    this.object3d.add(this.pts);
    this.setQuality(fxState.quality);
  }

  setQuality(q: 0 | 1 | 2 | 3): void {
    this.n = COUNTS[q];
    this.geo.setDrawRange(0, this.n);
    this.object3d.visible = this.n > 0;
  }

  update(dt: number): void {
    if (this.n === 0) return;
    const p = this.pos, range = Z_NEAR - Z_FAR;
    for (let i = 0; i < this.n; i++) {
      let z = p[i * 3 + 2] + this.spd[i] * dt;
      if (z > Z_NEAR) z -= range;
      p[i * 3 + 2] = z;
    }
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    const bp = fxState.beatPulse;
    this.mat.size = 0.045 * (1 + bp);
    this.mat.opacity = Math.min(1, 0.55 * (1 + bp));
    if (this.palette) this.mat.color.copy(this.palette.current.dust);
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
