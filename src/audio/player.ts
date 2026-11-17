import * as Tone from 'tone';
import type { Hand } from '../types';
import type { BuildCtx, TrackDef } from './pattern';
import { barDuration, drumEvents, trackDuration } from './pattern';
import { fx, fxState } from '../fx/bus';
import { HitSfx, type HitOpts } from './hitSfx';

export const INTRO_SEC = 4; // вступление: райзер + отсчёт, музыка стартует в time 0

/** Шаг отсчёта, с: доля или две доли, в пределах 0.5–1 с */
export function countdownStep(bpm: number): number {
  let s = bpm > 0 ? 60 / bpm : 0.6;
  while (s < 0.5) s *= 2;
  while (s > 1) s /= 2;
  return s;
}

const TAIL_SEC = 1.5; // хвост реверберации после последнего такта

let lastWarn = 0;
function warnOnce(err: unknown): void {
  const now = Date.now();
  if (now - lastWarn < 1000) return;
  lastWarn = now;
  console.warn('[audio] scheduling error suppressed:', err);
}

export class TrackPlayer {
  private limiter: Tone.Limiter | null = null;
  private disposables: { dispose(): unknown }[] = [];
  private parts: Tone.Part<any>[] = [];
  private players: Tone.Player[] = [];
  private def: TrackDef | null = null;
  private leadIn = 2;
  private playing = false;
  private endCbs: (() => void)[] = [];
  private endId: number | null = null;

  private sfx: HitSfx | null = null;
  private analyser: Tone.Analyser | null = null;
  private schedIds: number[] = [];
  // fx-события
  private beatT: number[] = [];
  private beatS: number[] = [];
  private beatD: boolean[] = [];
  private dropT: number[] = [];
  private bi = 0;
  private di = 0;
  private fxLast = 0;
  private fxBassLo = 0;
  private fxBassHi = 1;

  get isPlaying(): boolean { return this.playing; }

  async load(def: TrackDef): Promise<void> {
    await Tone.start();
    this.clear();
    this.ensureOut();
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    this.schedIds = [];
    transport.bpm.value = def.bpm;
    this.def = def;
    this.sfx?.setTrack(def.scale, def.bpm);
    const ctx: BuildCtx = {
      Tone,
      out: this.limiter!,
      def,
      track: (node) => { this.disposables.push(node); return node; },
      syncPlayer: (pl) => { this.players.push(pl); this.disposables.push(pl); },
      part: <E extends { time: number }>(events: E[], cb: (time: number, ev: E) => void) => {
        let lastT = -Infinity;
        const safe = (time: number, ev: E): void => {
          const t = Math.max(time, lastT + 0.002);
          lastT = t;
          try { cb(t, ev); } catch (err) { warnOnce(err); }
        };
        const p = new Tone.Part<E>(safe as never, events);
        this.parts.push(p);
        this.disposables.push(p);
      },
    };
    def.build(ctx);
    this.buildFxEvents(def);
  }

  start(leadInSec = 2): void {
    if (!this.def) return;
    const transport = Tone.getTransport();
    leadInSec = Math.max(leadInSec, INTRO_SEC);
    this.leadIn = leadInSec;
    transport.stop();
    this.sfx?.stopRiser();
    for (const id of this.schedIds) transport.clear(id);
    this.schedIds = [];
    this.bi = 0; this.di = 0;
    fxState.beatPulse = 0;
    if (this.endId !== null) transport.clear(this.endId);
    transport.seconds = 0;
    for (const p of this.parts) { p.stop(0); p.start(leadInSec); }
    for (const pl of this.players) { pl.unsync(); pl.sync().start(leadInSec); }
    this.endId = transport.scheduleOnce(() => this.finish(), leadInSec + trackDuration(this.def) + TAIL_SEC);
    // вступление: райзер и тики отсчёта (3, 2, 1, ВПЕРЁД) точно по Transport
    const sfx = this.sfx;
    if (sfx) {
      const step = countdownStep(this.def.bpm);
      this.schedIds.push(transport.schedule((t) => sfx.riser(t, leadInSec), 0));
      for (let k = 3; k >= 1; k--) {
        const at = leadInSec - k * step;
        if (at >= 0) this.schedIds.push(transport.schedule((t) => sfx.tick(880, t), at));
      }
      this.schedIds.push(transport.schedule((t) => sfx.tick(1320, t), leadInSec));
      // импакт дропа — на транспорте (синхронно с музыкой)
      for (const dt of this.dropT) this.schedIds.push(transport.schedule((t) => sfx.impact(t), leadInSec + dt));
    }
    transport.start();
    this.playing = true;
  }

  /** Вызывать каждый кадр: beat/drop события, beatPulse, bass/energy по живому FFT */
  updateFx(): void {
    const nowMs = performance.now();
    const dt = this.fxLast ? Math.min((nowMs - this.fxLast) / 1000, 0.1) : 0.016;
    this.fxLast = nowMs;
    if (this.playing && this.def) {
      const t = this.getTime();
      let b = -1;
      while (this.bi < this.beatT.length && this.beatT[this.bi]! <= t) b = this.bi++;
      if (b >= 0 && t - this.beatT[b]! < 0.25) {
        fx.emit({ type: 'beat', strength: this.beatS[b]!, downbeat: this.beatD[b]! });
        fxState.beatPulse = 1;
      }
      while (this.di < this.dropT.length && this.dropT[this.di]! <= t) {
        if (t - this.dropT[this.di]! < 0.5) fx.emit({ type: 'drop' });
        this.di++;
      }
    }
    fxState.beatPulse *= Math.exp(-dt / 0.18);
    if (fxState.beatPulse < 0.001) fxState.beatPulse = 0;

    const an = this.analyser;
    if (!an) return;
    const v = an.getValue() as Float32Array; // переиспользуемый буфер
    const n = v.length;
    let bass = 0;
    for (let i = this.fxBassLo; i <= this.fxBassHi && i < n; i++) bass += norm(v[i]!);
    bass /= Math.max(1, Math.min(this.fxBassHi, n - 1) - this.fxBassLo + 1);
    let e = 0;
    for (let i = 0; i < n; i++) { const m = norm(v[i]!); e += m * m; }
    e = Math.min(1, Math.sqrt(e / n) * 2);
    const k = (target: number, cur: number, tau: number): number => cur + (target - cur) * (1 - Math.exp(-dt / tau));
    fxState.bass = k(bass, fxState.bass, bass > fxState.bass ? 0.02 : 0.15);
    fxState.energy = k(e, fxState.energy, e > fxState.energy ? 0.03 : 0.15);
  }

  private ensureOut(): void {
    if (this.limiter) return;
    this.limiter = new Tone.Limiter(-2).toDestination();
    this.sfx = new HitSfx(this.limiter);
    this.analyser = new Tone.Analyser('fft', 256);
    this.limiter.connect(this.analyser);
    const bw = (Tone.getContext().sampleRate / 2) / 256; // ширина бина, Гц
    this.fxBassLo = Math.max(0, Math.floor(30 / bw));
    this.fxBassHi = Math.max(this.fxBassLo + 1, Math.ceil(150 / bw));
  }

  /** Заранее считает времена битов и дропов (без аллокаций в updateFx) */
  private buildFxEvents(def: TrackDef): void {
    this.beatT = []; this.beatS = []; this.beatD = []; this.dropT = [];
    const a = def.analysis;
    if (a) {
      const on = a.onsets.slice().sort((x, y) => x.t - y.t);
      let j = 0;
      a.beats.forEach((bt, i) => {
        while (j < on.length - 1 && on[j + 1]!.t <= bt) j++;
        let s = 0.8;
        for (let q = Math.max(0, j - 1); q <= Math.min(on.length - 1, j + 1); q++) {
          if (Math.abs(on[q]!.t - bt) < 0.06) s = Math.max(0.4, Math.min(1, on[q]!.strength));
        }
        this.beatT.push(bt); this.beatS.push(s); this.beatD.push(i % 4 === 0);
      });
      this.dropT = detectDrops(a.energyCurve);
      return;
    }
    for (const e of drumEvents(def, 'kick')) { this.beatT.push(e.time); this.beatS.push(1); this.beatD.push(e.step === 0); }
    const bd = barDuration(def.bpm);
    let bars = 0;
    for (const s of def.sections) {
      if (s.name === 'chorus' || s.name === 'drop') this.dropT.push(bars * bd);
      bars += s.bars;
    }
  }

  /** Время трека в секундах (отрицательное в lead-in), с поправкой на lookAhead и выходную задержку */
  getTime(): number {
    const ctx = Tone.getContext();
    const raw = ctx.rawContext as AudioContext;
    const latency = ctx.lookAhead + (raw.outputLatency || 0);
    return Tone.getTransport().seconds - latency - this.leadIn;
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    this.sfx?.stopRiser();
    this.playing = false;
  }

  pause(): void {
    if (!this.playing) return;
    Tone.getTransport().pause();
    if (this.getTime() < 0) this.sfx?.stopRiser();
    this.playing = false;
  }

  resume(): void {
    if (this.playing || !this.def || Tone.getTransport().state !== 'paused') return;
    Tone.getTransport().start();
    this.playing = true;
  }

  onEnd(cb: () => void): void { this.endCbs.push(cb); }

  /** Тренировка (без трека): поднимает аудио и звуки ударов. Вызывать из жеста пользователя. */
  prepareSfx(): void {
    void Tone.start();
    this.ensureOut();
    this.def = null;
    this.sfx?.setTrack(undefined, 0);
  }

  playHitSound(hand: Hand, opts: HitOpts): void { this.sfx?.play(hand, opts); }
  playMissSound(): void { this.sfx?.miss(); }
  playWrongSound(): void { this.sfx?.wrong(); }

  private finish(): void {
    this.playing = false;
    Tone.getTransport().stop();
    for (const cb of this.endCbs) cb();
  }

  private clear(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    this.endId = null;
    this.schedIds = [];
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.parts = [];
    this.players = [];
    this.playing = false;
  }
}

/** FFT-бин (дБ) -> 0..1 */
function norm(db: number): number {
  const x = (db + 80) / 60;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Дропы по кривой энергии (10 Гц): рост >1.8× за 0.5 с к предыдущим 4 с и выше 70-го перцентиля, не чаще раза в 20 с */
function detectDrops(curve: number[]): number[] {
  const out: number[] = [];
  if (curve.length < 60) return out;
  const sorted = curve.slice().sort((a, b) => a - b);
  const p70 = sorted[Math.floor(sorted.length * 0.7)] ?? 0;
  const mean = (from: number, to: number): number => {
    let s = 0;
    for (let i = from; i < to; i++) s += curve[i]!;
    return s / Math.max(1, to - from);
  };
  let last = -Infinity;
  for (let i = 40; i + 5 <= curve.length; i++) {
    const cur = mean(i, i + 5), prev = mean(i - 40, i);
    const t = i / 10;
    if (cur > prev * 1.8 && cur > p70 && t - last >= 20) { out.push(t); last = t; }
  }
  return out;
}
