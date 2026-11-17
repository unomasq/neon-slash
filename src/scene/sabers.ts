import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage,
  Color, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3,
} from 'three';
import { COLORS, SABER_LENGTH, SABER_SMOOTH_TAU_MS } from '../config';
import { SABER_FORWARD, SABER_TILT } from '../game/tuning';
import type { Hand, Vec2 } from '../types';
import { fxState } from '../fx/bus';
import { glow } from './util';

const TRAIL_MAX = 24;
const TRAIL_BY_TIER = [12, 16, 20, 24];
const BRIGHT_BY_TIER = [1, 1.25, 1.5, 1.8];
const HALO_BY_TIER = [1, 1.2, 1.4, 1.7];
const BLADE_T = 0.07;
const HANDLE_T = 0.12;
const HANDLE_LEN = 0.3;
const UP = new Vector3(0, 1, 0);
const _dir = new Vector3();
const _q = new Quaternion();

class Saber {
  readonly group = new Group();
  readonly a = new Vector3();
  readonly b = new Vector3();
  private blade: Mesh;
  private halo: Mesh;
  private haloMat: MeshBasicMaterial;
  private handle: Mesh;
  private core: Mesh;
  private coreMat: MeshBasicMaterial;
  private bladeBase: Color;
  private trailBase: Color;
  private trailGeo: BufferGeometry;
  private colAttr: BufferAttribute;
  private trailN = TRAIL_BY_TIER[0];
  private tier = 0;
  private haloK = 1;
  private trail: Mesh;
  private bladeMat: MeshBasicMaterial;
  private handleMat: MeshBasicMaterial;
  private trailMat: MeshBasicMaterial;
  private pos = new Float32Array(TRAIL_MAX * 2 * 3);
  private posAttr: BufferAttribute;
  private alpha = 0;
  private target = false;
  private reset = true;
  private lastSet = 0;
  private sm = false; // сглаженное состояние инициализировано (snap при появлении)
  private ax = 0; private ay = 0; private bx = 0; private by = 0; // сглаженные рукоять и кончик (xy)
  // середина лезвия и кончик (xyz) текущего кадра, для трейла
  private mx = 0; private my = 0; private mz = 0; private tx = 0; private ty = 0; private tz = 0;

  constructor(hand: Hand, geo: BoxGeometry) {
    const hex = COLORS[hand];
    this.bladeBase = glow(hex, 3);
    this.trailBase = glow(hex, 2);
    this.bladeMat = new MeshBasicMaterial({ color: this.bladeBase.clone(), transparent: true, fog: false, depthWrite: false });
    this.coreMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false, depthWrite: false });
    this.coreMat.color.multiplyScalar(2);
    this.handleMat = new MeshBasicMaterial({ color: 0x555560, transparent: true, fog: false });
    this.blade = new Mesh(geo, this.bladeMat);
    this.handle = new Mesh(geo, this.handleMat);
    this.haloMat = new MeshBasicMaterial({
      color: glow(hex, 1.2), transparent: true, opacity: 0, blending: AdditiveBlending,
      depthWrite: false, fog: false,
    });
    this.core = new Mesh(geo, this.coreMat);
    this.core.renderOrder = 2;
    this.core.visible = false;
    this.halo = new Mesh(geo, this.haloMat);
    this.halo.visible = false;

    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    this.colAttr = new BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 4), 4);
    g.setAttribute('color', this.colAttr);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) {
      const p = i * 2;
      idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
    g.setIndex(idx);
    this.trailGeo = g;
    this.setTrailLen(TRAIL_BY_TIER[0]);
    this.trailMat = new MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: AdditiveBlending,
      side: DoubleSide, depthWrite: false, fog: false,
    });
    this.trail = new Mesh(g, this.trailMat);
    this.trail.frustumCulled = false;
    this.group.add(this.trail, this.blade, this.core, this.handle, this.halo);
    this.group.visible = false;
  }

  set(wrist: Vec2, tip: Vec2, visible: boolean): void {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastSet) / 1000));
    this.lastSet = now;
    if (visible && !this.target) { this.sm = false; if (this.alpha < 0.05) this.reset = true; } // появление: snap без пружины
    this.target = visible;
    if (!visible) return; // цель замораживается, при скрытии держим последнюю позу и гасим
    let dx = tip.x - wrist.x, dy = tip.y - wrist.y;
    const l2 = Math.hypot(dx, dy);
    if (l2 < 1e-3) { dx = 0; dy = 1; } else { dx /= l2; dy /= l2; }
    const L = SABER_LENGTH;
    const tx = wrist.x + dx * L * SABER_TILT, ty = wrist.y + dy * L * SABER_TILT;
    if (!this.sm) { this.ax = wrist.x; this.ay = wrist.y; this.bx = tx; this.by = ty; this.sm = true; }
    else {
      // экспоненциальное сглаживание по dt: движение непрерывно между детекциями; отрезок для столкновений берётся отсюда же
      const k = 1 - Math.exp(-dt * 1000 / SABER_SMOOTH_TAU_MS);
      this.ax += (wrist.x - this.ax) * k; this.ay += (wrist.y - this.ay) * k;
      this.bx += (tx - this.bx) * k; this.by += (ty - this.by) * k;
    }
    this.a.set(this.ax, this.ay, 0);
    this.b.set(this.bx, this.by, -L * SABER_FORWARD);
    _dir.subVectors(this.b, this.a);
    const len = _dir.length();
    _dir.divideScalar(len);
    _q.setFromUnitVectors(UP, _dir);
    const hl = Math.min(HANDLE_LEN, len * 0.4);
    const bl = len - hl;
    this.handle.quaternion.copy(_q);
    this.handle.position.copy(this.a).addScaledVector(_dir, hl / 2);
    this.handle.scale.set(HANDLE_T, hl, HANDLE_T);
    this.blade.quaternion.copy(_q);
    this.blade.position.copy(this.a).addScaledVector(_dir, hl + bl / 2);
    this.blade.scale.set(BLADE_T, bl, BLADE_T);
    this.halo.position.copy(this.blade.position);
    this.halo.quaternion.copy(_q);
    this.halo.scale.set(BLADE_T * 3.5 * this.haloK, bl, BLADE_T * 3.5 * this.haloK);
    this.core.position.copy(this.blade.position);
    this.core.quaternion.copy(_q);
    this.core.scale.set(BLADE_T * 0.55, bl, BLADE_T * 0.55);
    this.mx = (this.a.x + this.b.x) / 2; this.my = (this.a.y + this.b.y) / 2; this.mz = (this.a.z + this.b.z) / 2;
    this.tx = this.b.x; this.ty = this.b.y; this.tz = this.b.z;
  }

  private setTrailLen(n: number): void {
    this.trailN = n;
    const col = this.colAttr.array as Float32Array;
    const c = this.trailBase;
    for (let i = 0; i < n; i++) {
      const al = 0.7 * (1 - i / (n - 1));
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 4;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; col[o + 3] = al;
      }
    }
    this.colAttr.needsUpdate = true;
    this.trailGeo.setDrawRange(0, (n - 1) * 6);
    this.reset = true;
  }

  private applyTier(t: number): void {
    this.tier = t;
    this.bladeMat.color.copy(this.bladeBase).multiplyScalar(BRIGHT_BY_TIER[t]);
    this.haloK = HALO_BY_TIER[t];
    this.core.visible = t >= 3;
    this.setTrailLen(TRAIL_BY_TIER[t]);
  }

  setHalo(on: boolean): void { this.halo.visible = on; }

  warmShow(): () => void {
    const gv = this.group.visible, hv = this.halo.visible;
    this.group.visible = true; this.halo.visible = true;
    return () => { this.group.visible = gv; this.halo.visible = hv; };
  }

  update(dt: number): void {
    if (fxState.tier !== this.tier) this.applyTier(fxState.tier);
    this.alpha += ((this.target ? 1 : 0) - this.alpha) * Math.min(1, dt * 10);
    if (!this.target && this.alpha < 0.01) this.alpha = 0;
    this.group.visible = this.alpha > 0;
    if (!this.group.visible) return;
    this.bladeMat.opacity = this.alpha;
    this.handleMat.opacity = this.alpha;
    this.trailMat.opacity = this.alpha;
    this.coreMat.opacity = this.alpha;
    this.haloMat.opacity = this.alpha * 0.25;
    const p = this.pos;
    if (this.reset) {
      for (let i = 0; i < this.trailN; i++) this.put(i);
      this.reset = false;
    } else {
      p.copyWithin(6, 0, (this.trailN - 1) * 6); // сдвиг истории
      this.put(0);
    }
    this.posAttr.needsUpdate = true;
  }

  private put(i: number): void {
    const o = i * 6;
    this.pos[o] = this.mx; this.pos[o + 1] = this.my; this.pos[o + 2] = this.mz;
    this.pos[o + 3] = this.tx; this.pos[o + 4] = this.ty; this.pos[o + 5] = this.tz;
  }
}

export class Sabers {
  readonly group = new Group();
  private geo = new BoxGeometry(1, 1, 1);
  private sabers: Record<Hand, Saber>;

  constructor() {
    this.sabers = { left: new Saber('left', this.geo), right: new Saber('right', this.geo) };
    this.group.add(this.sabers.left.group, this.sabers.right.group);
  }

  setSaber(hand: Hand, wrist: Vec2, tip: Vec2, visible: boolean): void {
    this.sabers[hand].set(wrist, tip, visible);
  }

  getSegment(hand: Hand): { a: Vector3; b: Vector3 } {
    return this.sabers[hand];
  }

  setHalo(on: boolean): void {
    this.sabers.left.setHalo(on);
    this.sabers.right.setHalo(on);
  }

  warmShow(): () => void {
    const a = this.sabers.left.warmShow(), b = this.sabers.right.warmShow();
    return () => { a(); b(); };
  }

  update(dt: number): void {
    this.sabers.left.update(dt);
    this.sabers.right.update(dt);
  }
}
