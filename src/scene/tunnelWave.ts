import { AdditiveBlending, Group, LineBasicMaterial, LineSegments, BufferGeometry, Float32BufferAttribute } from 'three';
import { fx } from '../fx/bus';
import type { Palette } from './palette';

const X = 7, Y0 = -3.2, Y1 = 5.5;
const Z_START = 4, Z_END = -45, DUR = 0.6;

/** Ударная волна на дропе: яркое кольцо-рамка бежит по тоннелю от игрока вглубь. */
export class TunnelWave {
  readonly object3d = new Group();
  private palette?: Palette;
  private ring: LineSegments;
  private mat: LineBasicMaterial;
  private t = DUR;
  private off: () => void;

  constructor(palette?: Palette) {
    this.palette = palette;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(
      [-X, Y0, 0, X, Y0, 0, X, Y0, 0, X, Y1, 0, X, Y1, 0, -X, Y1, 0, -X, Y1, 0, -X, Y0, 0], 3));
    this.mat = new LineBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
    this.ring = new LineSegments(g, this.mat);
    this.ring.frustumCulled = false;
    this.object3d.add(this.ring);
    this.object3d.visible = false;
    this.off = fx.on('drop', () => { this.t = 0; });
  }

  update(dt: number): void {
    if (this.t >= DUR) { this.object3d.visible = false; return; }
    this.t += dt;
    const k = Math.min(1, this.t / DUR);
    this.object3d.visible = k < 1;
    this.ring.position.z = Z_START + (Z_END - Z_START) * k;
    const f = (1 - k) * (1 - k) * 6;
    if (this.palette) this.mat.color.copy(this.palette.current.judge).lerp(this.palette.current.tunnel, 0.3).multiplyScalar(f);
    else this.mat.color.setRGB(f, f, f);
  }

  dispose(): void {
    this.off();
    this.ring.geometry.dispose();
    this.mat.dispose();
  }
}
