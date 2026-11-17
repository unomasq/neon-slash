import type { Dir8, Hand, HitKind, Note } from '../types';
import type { CubeRec } from './diag';
import {
  PRACTICE_ANY_COUNT, PRACTICE_DIR_INTERVAL_S, PRACTICE_FIRST_S, PRACTICE_INTERVAL_S, PRACTICE_MID_COUNT,
  PRACTICE_MID_INTERVAL_S, SWING_SPEED_MIN_HIT,
} from './tuning';

export interface Clock { getTime(): number }

export class PracticeClock implements Clock {
  private t0 = performance.now();
  private pausedAt: number | null = null;
  getTime(): number { return ((this.pausedAt ?? performance.now()) - this.t0) / 1000; }
  pause(): void { if (this.pausedAt === null) this.pausedAt = performance.now(); }
  resume(): void {
    if (this.pausedAt === null) return;
    this.t0 += performance.now() - this.pausedAt;
    this.pausedAt = null;
  }
}

const SEQ: Dir8[] = [4, 2, 4, 6];

/** Бесконечный генератор нот: 10 'any' каждые 2 с, 10 'any' каждые 1.2 с, затем направления 4/2/6 каждые 1.5 с. */
export class PracticeGen {
  private n = 0;
  private nextTime = PRACTICE_FIRST_S;

  ensure(songTime: number, notes: Note[], lead: number): void {
    while (this.nextTime <= songTime + lead + PRACTICE_INTERVAL_S) {
      const i = this.n++;
      const time = this.nextTime;
      const hand: Hand = i % 2 === 0 ? 'left' : 'right';
      let dir: Dir8 = 'any';
      let step = PRACTICE_INTERVAL_S;
      if (i >= PRACTICE_ANY_COUNT) step = PRACTICE_MID_INTERVAL_S;
      if (i >= PRACTICE_ANY_COUNT + PRACTICE_MID_COUNT) {
        step = PRACTICE_DIR_INTERVAL_S;
        dir = SEQ[(i - PRACTICE_ANY_COUNT - PRACTICE_MID_COUNT) % SEQ.length]!;
      }
      notes.push({ id: i, time, hand, dir, lane: hand === 'left' ? 1 : 2, row: 1 });
      this.nextTime += step;
    }
  }
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const arrow = (d: number | null): string => (d === null ? '?' : ARROWS[d] ?? '?');

/** Текст причины результата для режима тренировки. */
export function describeResult(kind: HitKind, note: Note, rec: CubeRec, lastDir: number | null, _half: number): string {
  switch (kind) {
    case 'good': { const e = Math.abs(rec.errMs); return e < 60 ? 'Попал! Идеально' : e < 120 ? 'Попал! Хорошо' : 'Попал!'; }
    case 'wrongColor': return `Не тот цвет: это куб для ${note.hand === 'left' ? 'левой' : 'правой'} руки`;
    case 'wrongDir': return `Не то направление: было ${arrow(lastDir)}, нужно ${arrow(note.dir === 'any' ? null : note.dir)}`;
    default:
      if (!rec.visible) return 'Мимо: руку не видно';
      if (rec.minDist !== null && rec.minDist > 0.15) return `Мимо: лезвие прошло в стороне (${rec.minDist})`;
      if (rec.maxSpeed < SWING_SPEED_MIN_HIT) return `Мимо: слишком медленно (${rec.maxSpeed})`;
      if (rec.otherMinDist !== null && (rec.minDist === null || rec.otherMinDist < rec.minDist)) {
        return 'Мимо: ближе была другая рука';
      }
      return 'Мимо: не вовремя (ударь, когда куб рядом)';
  }
}
