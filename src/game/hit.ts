import type { ActiveCube } from '../scene';
import type { Dir8, Vec2 } from '../types';
import {
  DIR_TOLERANCE_DEG, HIT_BOX_PAD, INST_DIR_MIN_STEP, SWING_DIR_MIN_PATH, SWING_DIR_WINDOW, SWING_HISTORY_MS,
} from './tuning';

export interface V3 { x: number; y: number; z: number }
export interface Seg { a: V3; b: V3 }

/** История движения кончика одной руки: swingDir, угол и пиковая скорость. */
export class HandSwing {
  private ts: number[] = [];
  private xs: number[] = [];
  private ys: number[] = [];
  private sp: number[] = [];
  private an: (number | null)[] = [];
  swingDir: Dir8 | null = null;
  /** угол от «вверх» по часовой, 0..360, null если направление не определено */
  angle: number | null = null;
  peakSpeed = 0;
  speed = 0;

  reset(): void {
    this.ts.length = 0; this.xs.length = 0; this.ys.length = 0; this.sp.length = 0; this.an.length = 0;
    this.swingDir = null; this.angle = null; this.peakSpeed = 0; this.speed = 0;
  }

  push(now: number, tip: Vec2, speed: number, visible: boolean): void {
    if (!visible) { this.reset(); return; }
    const m = this.ts.length - 1;
    let inst: number | null = null;
    if (m >= 0) {
      const ix = tip.x - this.xs[m]!, iy = tip.y - this.ys[m]!;
      if (Math.hypot(ix, iy) >= INST_DIR_MIN_STEP) inst = (Math.atan2(ix, iy) * 180 / Math.PI + 360) % 360;
    }
    this.ts.push(now); this.xs.push(tip.x); this.ys.push(tip.y); this.sp.push(speed); this.an.push(inst);
    while (this.ts.length > 1 && now - this.ts[0]! > SWING_HISTORY_MS) {
      this.ts.shift(); this.xs.shift(); this.ys.shift(); this.sp.shift(); this.an.shift();
    }
    this.speed = speed;
    let pk = 0;
    for (const v of this.sp) if (v > pk) pk = v;
    this.peakSpeed = pk;
    let i = 0;
    while (i < this.ts.length - 1 && now - this.ts[i]! > SWING_DIR_WINDOW) i++;
    const n = this.ts.length - 1;
    const dx = this.xs[n]! - this.xs[i]!, dy = this.ys[n]! - this.ys[i]!;
    if (Math.hypot(dx, dy) < SWING_DIR_MIN_PATH) { this.swingDir = null; this.angle = null; return; }
    const deg = Math.atan2(dx, dy) * 180 / Math.PI;
    this.angle = (deg + 360) % 360;
    this.swingDir = ((Math.round(deg / 45) % 8 + 8) % 8) as Dir8;
  }

  /** Был ли за последние windowMs момент, когда мгновенное направление совпало с want и скорость >= minSpeed. */
  hadDirMatch(now: number, want: Dir8, minSpeed: number, windowMs: number): boolean {
    for (let k = this.ts.length - 1; k >= 0 && now - this.ts[k]! <= windowMs; k--) {
      const a = this.an[k];
      if (a !== null && a !== undefined && this.sp[k]! >= minSpeed && angleMatches(a, want)) return true;
    }
    return false;
  }
}

/** Отрезок–AABB (slab). */
function segHitsBox(a: V3, b: V3, c: V3, r: number): boolean {
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const o = [a.x - c.x, a.y - c.y, a.z - c.z];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const di = d[i]!, oi = o[i]!;
    if (Math.abs(di) < 1e-9) {
      if (oi < -r || oi > r) return false;
    } else {
      let ta = (-r - oi) / di, tb = (r - oi) / di;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Расстояние от точки до отрезка в 3D. */
export function distToSeg(p: V3, s: Seg): number {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, dz = s.b.z - s.a.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy + (p.z - s.a.z) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (s.a.x + dx * t), p.y - (s.a.y + dy * t), p.z - (s.a.z + dz * t));
}

const _a: V3 = { x: 0, y: 0, z: 0 };
const _b: V3 = { x: 0, y: 0, z: 0 };
const _s: Seg = { a: _a, b: _b };
const lerp3 = (o: V3, p: V3, q: V3, t: number): void => {
  o.x = p.x + (q.x - p.x) * t; o.y = p.y + (q.y - p.y) * t; o.z = p.z + (q.z - p.z) * t;
};

/** Свип в 3D: отрезки t=0..1 (шаг 0.25) между prev и cur против AABB куба и по расстоянию до центра. */
export function sweepHit3D(prev: Seg | null, cur: Seg, cube: ActiveCube, pad = HIT_BOX_PAD): boolean {
  const r = cube.half + pad;
  const c: V3 = { x: cube.x, y: cube.y, z: cube.z };
  if (segHitsBox(cur.a, cur.b, c, r)) return true;
  if (!prev) return false;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    lerp3(_a, prev.a, cur.a, t);
    lerp3(_b, prev.b, cur.b, t);
    if (segHitsBox(_a, _b, c, r)) return true;
    if (distToSeg(c, _s) <= r) return true;
  }
  return false;
}

/** Совпадение по точному углу взмаха (градусы от «вверх» по часовой). */
export function angleMatches(angle: number, want: Dir8): boolean {
  if (want === 'any') return true;
  let d = Math.abs(angle - want * 45) % 360;
  if (d > 180) d = 360 - d;
  return d <= DIR_TOLERANCE_DEG;
}

export function sliceDirFromDir8(d: Dir8): Vec2 {
  if (d === 'any') return { x: 0, y: -1 };
  const a = (d * Math.PI) / 4;
  return { x: Math.sin(a), y: Math.cos(a) };
}

export interface P2 { x: number; y: number }
export interface Box2 { minX: number; minY: number; maxX: number; maxY: number }

/** Отрезок–прямоугольник 2D (slab). */
function seg2HitsBox(ax: number, ay: number, bx: number, by: number, b: Box2): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (let i = 0; i < 2; i++) {
    const d = i ? dy : dx, o = i ? ay : ax, lo = i ? b.minY : b.minX, hi = i ? b.maxY : b.maxX;
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

/** Расстояние от точки до отрезка в 2D. */
export function distToSeg2(px: number, py: number, a: P2, b: P2): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

const _p: P2 = { x: 0, y: 0 };
const _q: P2 = { x: 0, y: 0 };

/** Свип в экранных единицах: отрезки между prev и cur (t=0..1 шаг 0.25) против бокса и по расстоянию центра. */
export function sweepHitScreen(prevA: P2 | null, prevB: P2 | null, curA: P2, curB: P2, box: Box2): boolean {
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  const hw = (box.maxX - box.minX) / 2;
  if (seg2HitsBox(curA.x, curA.y, curB.x, curB.y, box) || distToSeg2(cx, cy, curA, curB) <= hw) return true;
  if (!prevA || !prevB) return false;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    _p.x = prevA.x + (curA.x - prevA.x) * t; _p.y = prevA.y + (curA.y - prevA.y) * t;
    _q.x = prevB.x + (curB.x - prevB.x) * t; _q.y = prevB.y + (curB.y - prevB.y) * t;
    if (seg2HitsBox(_p.x, _p.y, _q.x, _q.y, box) || distToSeg2(cx, cy, _p, _q) <= hw) return true;
  }
  return false;
}
