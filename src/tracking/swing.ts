import type { Dir8, Vec2 } from '../types';
import { SWING_DIR_MIN_PATH, SWING_DIR_WINDOW_MS, SWING_MAX_WINDOW_MS, SWING_SPEED_MAX, SWING_SPEED_MIN, SWING_WINDOW_MS } from '../config';
import { RingBuffer } from './smoothing';

const OUTLIER_MAX_DT_MS = 100; // выбросы ищем только при отсчётах не старше этого
const CAPACITY = 16; // хватает на SWING_MAX_WINDOW_MS при 30+ детекциях/с

/** Направление по вектору (x вправо, y вверх): 0 = вверх, по часовой стрелке */
function dir8(x: number, y: number): Dir8 {
  const deg = Math.atan2(x, y) * 180 / Math.PI;
  return ((Math.round(deg / 45) % 8 + 8) % 8) as Dir8;
}

/** Скорость и направление взмаха по детекциям кончика; окна заданы по времени, не по числу отсчётов */
export class SwingDetector {
  readonly velocity: Vec2 = { x: 0, y: 0 };
  speed = 0;
  direction: Dir8 | null = null;
  /** Максимальная скорость между соседними детекциями за последние SWING_MAX_WINDOW_MS, ед/с */
  peakSpeed = 0;
  /** Направление суммарного перемещения за SWING_DIR_WINDOW_MS; null, если путь < SWING_DIR_MIN_PATH */
  swingDir: Dir8 | null = null;
  private buf = new RingBuffer(CAPACITY);

  push(tip: Vec2, t: number): void {
    const b = this.buf;
    if (b.length > 0) {
      const l = b.newestIndex(), dt = t - b.ts[l]!;
      // выброс: скачок быстрее SWING_SPEED_MAX при свежем предыдущем отсчёте — позицию принимаем, историю скорости сбрасываем
      if (dt > 0 && dt <= OUTLIER_MAX_DT_MS && Math.hypot(tip.x - b.xs[l]!, tip.y - b.ys[l]!) / (dt / 1000) > SWING_SPEED_MAX) {
        b.clear();
      }
    }
    b.push(tip.x, tip.y, t);
    if (b.length < 2) { this.zero(); return; }
    const n = b.newestIndex();
    const tn = b.ts[n]!, xn = b.xs[n]!, yn = b.ys[n]!;
    // идём от новых к старым: опорная точка скорости — первая старше SWING_WINDOW_MS (иначе самая старая в пределах MAX)
    let vi = -1, di = -1, peak = 0;
    let prev = n;
    for (let k = 1; k < b.length; k++) {
      const i = b.fromNewest(k);
      const age = tn - b.ts[i]!;
      if (age > SWING_MAX_WINDOW_MS) break;
      const pdt = (b.ts[prev]! - b.ts[i]!) / 1000;
      if (pdt > 0) peak = Math.max(peak, Math.hypot(b.xs[prev]! - b.xs[i]!, b.ys[prev]! - b.ys[i]!) / pdt);
      prev = i;
      if (vi < 0 || age <= SWING_WINDOW_MS || (vi >= 0 && tn - b.ts[vi]! < SWING_WINDOW_MS)) vi = i;
      if (age <= SWING_DIR_WINDOW_MS) di = i;
    }
    this.peakSpeed = peak;
    if (vi < 0) { this.velocity.x = 0; this.velocity.y = 0; this.speed = 0; this.direction = null; }
    else {
      const dt = (tn - b.ts[vi]!) / 1000;
      if (dt > 0) {
        this.velocity.x = (xn - b.xs[vi]!) / dt;
        this.velocity.y = (yn - b.ys[vi]!) / dt;
        this.speed = Math.hypot(this.velocity.x, this.velocity.y);
        this.direction = this.speed >= SWING_SPEED_MIN ? dir8(this.velocity.x, this.velocity.y) : null;
      }
    }
    this.swingDir = null;
    if (di >= 0) {
      const dx = xn - b.xs[di]!, dy = yn - b.ys[di]!;
      if (Math.hypot(dx, dy) >= SWING_DIR_MIN_PATH) this.swingDir = dir8(dx, dy);
    }
  }

  reset(): void { this.buf.clear(); this.zero(); }

  private zero(): void {
    this.velocity.x = 0; this.velocity.y = 0; this.speed = 0; this.direction = null; this.peakSpeed = 0; this.swingDir = null;
  }
}
