import type { HitKind } from '../types';

export class ScoreState {
  score = 0;
  combo = 0;
  maxCombo = 0;
  hits = 0;
  misses = 0;
  total = 0;

  get multiplier(): number {
    return this.combo >= 40 ? 8 : this.combo >= 20 ? 4 : this.combo >= 10 ? 2 : 1;
  }

  get accuracy(): number {
    return this.total > 0 ? this.hits / this.total : 0;
  }

  registerHit(timingErrorMs: number): number {
    const acc = Math.max(0, 1 - Math.abs(timingErrorMs) / 180);
    const pts = Math.round(100 + 50 * acc) * this.multiplier;
    this.score += pts;
    this.combo++;
    this.hits++;
    this.total++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    return pts;
  }

  registerFail(_kind: HitKind): void {
    this.combo = 0;
    this.misses++;
    this.total++;
  }

  reset(): void {
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.hits = 0; this.misses = 0; this.total = 0;
  }
}
