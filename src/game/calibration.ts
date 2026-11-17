/** Калибровка задержки: метроном на Web Audio + поиск пиков взмаха рядом с каждым щелчком. */

export const CAL_BPM = 90;
export const CAL_CLICKS = 4;
export const CAL_LEAD_S = 1.5;
const WIN_BEFORE_MS = 300;
const WIN_AFTER_MS = 600;
const MIN_PEAK = 6; // ед/с, как SWING_SPEED_MIN
export const CAL_MAX_MS = 350;
export const CAL_BEAT_MS = 60000 / CAL_BPM;

/** Простой щелчок на осцилляторе, независимо от Tone */
export class ClickSynth {
  private ctx: AudioContext | null = null;

  async ensure(): Promise<AudioContext> {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  /** Планирует щелчок через `afterSec` секунд; возвращает performance.now()-время, когда его услышит игрок */
  click(afterSec: number, accent: boolean): number {
    const ctx = this.ctx!;
    const t = ctx.currentTime + afterSec;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
    const out = (ctx.outputLatency || ctx.baseLatency || 0) * 1000;
    return performance.now() + afterSec * 1000 + out;
  }

  dispose(): void { void this.ctx?.close(); this.ctx = null; }
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Медиана смещений (мс); первый отбрасывается, если сильно отличается. null — данных мало */
export function computeOffset(offsets: (number | null)[]): number | null {
  const v = offsets.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  let use = v;
  if (offsets[0] !== null && v.length >= 3) {
    const rest = v.slice(1);
    if (Math.abs(v[0]! - median(rest)) > 150) use = rest;
  }
  return Math.round(Math.min(CAL_MAX_MS, Math.max(0, median(use))));
}

export class Calibrator {
  readonly clickTimes: number[] = [];
  private samples: { t: number; v: number }[] = [];
  private synth = new ClickSynth();
  running = false;
  offsets: (number | null)[] = [];

  async start(): Promise<void> {
    await this.synth.ensure();
    this.samples = [];
    this.clickTimes.length = 0;
    this.offsets = [];
    for (let i = 0; i < CAL_CLICKS; i++) {
      this.clickTimes.push(this.synth.click(CAL_LEAD_S + (i * CAL_BEAT_MS) / 1000, i === 0));
    }
    this.running = true;
  }

  stop(): void { this.running = false; }

  dispose(): void { this.running = false; this.synth.dispose(); }

  push(now: number, leftPeak: number, rightPeak: number): void {
    if (!this.running) return;
    this.samples.push({ t: now, v: Math.max(leftPeak, rightPeak) });
  }

  get finished(): boolean {
    return this.running && performance.now() > this.clickTimes[CAL_CLICKS - 1]! + WIN_AFTER_MS + 100;
  }

  /** Вызывать после finished; возвращает мс или null */
  finish(): number | null {
    this.running = false;
    this.offsets = this.clickTimes.map((tc) => {
      let best: { t: number; v: number } | null = null;
      for (const s of this.samples) {
        if (s.t < tc - WIN_BEFORE_MS || s.t > tc + WIN_AFTER_MS) continue;
        if (s.v >= MIN_PEAK && (!best || s.v > best.v)) best = s; // строго больше: берём первый максимум
      }
      return best ? best.t - tc : null;
    });
    return computeOffset(this.offsets);
  }
}
