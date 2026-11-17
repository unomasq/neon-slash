import { ONE_EURO_BETA, ONE_EURO_D_CUTOFF, ONE_EURO_MIN_CUTOFF } from '../config';

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** One Euro filter для скаляра; время в миллисекундах */
export class OneEuro {
  private x = 0; private dx = 0; private t = 0;
  private inited = false;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  constructor(minCutoff = ONE_EURO_MIN_CUTOFF, beta = ONE_EURO_BETA, dCutoff = ONE_EURO_D_CUTOFF) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
  }
  filter(v: number, tMs: number): number {
    if (!this.inited) { this.x = v; this.dx = 0; this.t = tMs; this.inited = true; return v; }
    const dt = (tMs - this.t) / 1000;
    if (dt <= 0) return this.x;
    this.t = tMs;
    const rawD = (v - this.x) / dt;
    this.dx += (rawD - this.dx) * alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (v - this.x) * alpha(cutoff, dt);
    return this.x;
  }
  reset(): void { this.inited = false; }
}

export class OneEuroVec2 {
  readonly value = { x: 0, y: 0 };
  private fx: OneEuro;
  private fy: OneEuro;
  constructor(minCutoff = ONE_EURO_MIN_CUTOFF, beta = ONE_EURO_BETA) {
    this.fx = new OneEuro(minCutoff, beta); this.fy = new OneEuro(minCutoff, beta);
  }
  push(x: number, y: number, tMs: number): { x: number; y: number } {
    this.value.x = this.fx.filter(x, tMs);
    this.value.y = this.fy.filter(y, tMs);
    return this.value;
  }
  reset(): void { this.fx.reset(); this.fy.reset(); }
}
