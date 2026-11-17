/** Кольцевой буфер последних N точек с временными метками (без аллокаций в push) */
export class RingBuffer {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly ts: Float64Array;
  private head = 0; // индекс следующей записи
  private n = 0;
  private cap: number;
  constructor(capacity: number) {
    this.cap = capacity;
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.ts = new Float64Array(capacity);
  }
  get length(): number { return this.n; }
  push(x: number, y: number, t: number): void {
    this.xs[this.head] = x; this.ys[this.head] = y; this.ts[this.head] = t;
    this.head = (this.head + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }
  /** Индекс элемента: 0 = самый старый, length-1 = самый новый */
  private idx(i: number): number { return (this.head - this.n + i + this.cap * 2) % this.cap; }
  /** Индекс элемента с конца: 0 = самый новый */
  fromNewest(i: number): number { return this.idx(this.n - 1 - i); }
  oldestIndex(): number { return this.idx(0); }
  newestIndex(): number { return this.idx(this.n - 1); }
  clear(): void { this.head = 0; this.n = 0; }
}
