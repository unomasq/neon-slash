import * as Tone from 'tone';
import type { Hand } from '../types';


export type AccuracyGrade = 'perfect' | 'good' | 'ok';
export interface HitOpts { combo: number; perfect: boolean; accuracyGrade: AccuracyGrade }

export const DEFAULT_SCALE = ['A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6'];
const SNAP_WINDOW = 0.07; // с: если до сетки 1/16 не дальше — звон ставится ровно на неё

let lastWarn = 0;
function warn(err: unknown): void {
  const n = Date.now();
  if (n - lastWarn < 1000) return;
  lastWarn = n;
  console.warn('[hitSfx] suppressed:', err);
}

/** Строго растущее время старта для моносинтов */
class Guard {
  private last = 0;
  next(t: number): number { const r = Math.max(t, this.last + 0.005); this.last = r; return r; }
}

/** Слоистый звук разбивания куба. Все узлы создаются один раз в конструкторе. */
export class HitSfx {
  private master: Tone.Volume;
  private click: Tone.MembraneSynth;
  private snap: Tone.NoiseSynth;
  private snapHp: Tone.Filter;
  private slice: Tone.NoiseSynth;
  private sliceBp: Tone.Filter;
  private pan: Tone.Panner;
  private bell: Tone.FMSynth;
  private bellDelay: Tone.FeedbackDelay;
  private bellDry: Tone.FMSynth;
  private thump: Tone.MembraneSynth;
  private riseNoise: Tone.Noise;
  private riseLp: Tone.Filter;
  private riseGain: Tone.Gain;
  private riseOsc: Tone.Oscillator;
  private riseOscGain: Tone.Gain;
  private tickSynth: Tone.Synth;
  private impSub: Tone.Synth;
  private impNoise: Tone.NoiseSynth;
  private impHp: Tone.Filter;
  private impVerb: Tone.Reverb;
  private shimA: Tone.FMSynth;
  private shimB: Tone.FMSynth;
  private arp: Tone.Synth;
  private missBody: Tone.MembraneSynth;
  private missLp: Tone.Filter;
  private missTone: Tone.Synth;
  private wrongSynth: Tone.Synth;
  private wrongDist: Tone.Distortion;
  private g = {
    click: new Guard(), snap: new Guard(), slice: new Guard(), bell: new Guard(), shimA: new Guard(),
    shimB: new Guard(), bellDry: new Guard(), thump: new Guard(), impSub: new Guard(), tick: new Guard(), impNoise: new Guard(), arp: new Guard(), missBody: new Guard(), missTone: new Guard(), wrong: new Guard(),
  };
  private lastWrong = 0;

  private scale: string[] = DEFAULT_SCALE;
  private up: string[] = [];
  private step16 = 0;     // длительность 1/16, с (0 — нет сетки)

  constructor(out: Tone.ToneAudioNode) {
    this.master = new Tone.Volume(-6).connect(out);
    this.click = new Tone.MembraneSynth({
      pitchDecay: 0.01, octaves: 4, oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 }, volume: -4,
    }).connect(this.master);
    this.snapHp = new Tone.Filter(3500, 'highpass').connect(this.master);
    this.snap = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 }, volume: -10 }).connect(this.snapHp);
    this.pan = new Tone.Panner(0).connect(this.master);
    this.sliceBp = new Tone.Filter(4000, 'bandpass', -12).connect(this.pan);
    this.sliceBp.Q.value = 1.8;
    this.slice = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.02 }, volume: -6 }).connect(this.sliceBp);
    this.bellDelay = new Tone.FeedbackDelay({ delayTime: 0.15, feedback: 0.3, wet: 0.25 }).connect(this.master);
    const fm = (vol: number): Tone.FMSynth => new Tone.FMSynth({
      harmonicity: 3.01, modulationIndex: 8, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.3 },
      modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.1 }, volume: vol,
    });
    this.bell = fm(-8).connect(this.bellDelay);
    this.bellDry = new Tone.FMSynth({
      harmonicity: 2, modulationIndex: 3, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.1, sustain: 0, release: 0.05 },
      modulationEnvelope: { attack: 0.002, decay: 0.06, sustain: 0, release: 0.03 }, volume: -14,
    }).connect(this.master);
    this.thump = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 3, oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.08 }, volume: -3,
    }).connect(this.master);
    this.impVerb = new Tone.Reverb({ decay: 1.6, wet: 1 }).connect(this.master);
    this.impHp = new Tone.Filter(900, 'highpass').connect(this.impVerb);
    this.impNoise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.005, decay: 0.45, sustain: 0, release: 0.2 }, volume: -12 }).connect(this.impHp);
    this.impSub = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.05 }, volume: -2 }).connect(this.master);
    this.riseGain = new Tone.Gain(0).connect(this.master);
    this.riseLp = new Tone.Filter(200, 'lowpass').connect(this.riseGain);
    this.riseNoise = new Tone.Noise('white').connect(this.riseLp);
    this.riseOscGain = new Tone.Gain(0).connect(this.master);
    this.riseOsc = new Tone.Oscillator(200, 'sawtooth').connect(this.riseOscGain);
    this.tickSynth = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.03 }, volume: -8 }).connect(this.master);
    this.shimA = fm(-17).connect(this.bellDelay);
    this.shimB = fm(-17).connect(this.bellDelay);
    this.arp = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.05 }, volume: -12 }).connect(this.master);
    this.missLp = new Tone.Filter(280, 'lowpass').connect(this.master);
    this.missBody = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 2, envelope: { attack: 0.003, decay: 0.28, sustain: 0, release: 0.1 }, volume: -3 }).connect(this.missLp);
    this.missTone = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.16, sustain: 0, release: 0.05 }, volume: -12 }).connect(this.master);
    this.wrongDist = new Tone.Distortion(0.9).connect(this.master);
    this.wrongSynth = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.12, sustain: 0.3, release: 0.04 }, volume: -16 }).connect(this.wrongDist);
    this.setTrack(undefined, 0);
  }

  /** scale — лад трека; bpm > 0 включает квантование звона к сетке 1/16 Transport */
  setTrack(scale: string[] | undefined, bpm: number): void {
    this.scale = scale && scale.length ? scale : DEFAULT_SCALE;
    this.up = this.scale.map(n => Tone.Frequency(n).transpose(12).toNote());
    this.step16 = scale && bpm > 0 ? 60 / bpm / 4 : 0;
    this.bellDelay.delayTime.value = bpm > 0 ? 60 / bpm / 2 : 0.15; // 1/8 бита (восьмая)
  }

  /** Момент звона: ближайшая 1/16, если она в пределах 70 мс, иначе сразу */
  private bellTime(now: number): number {
    if (this.step16 <= 0) return now;
    const tr = Tone.getTransport();
    if (tr.state !== 'started') return now;
    const rem = tr.seconds % this.step16;
    if (rem < 0.003) return now;
    const delta = this.step16 - rem;
    return delta <= SNAP_WINDOW ? now + delta : now;
  }

  play(hand: Hand, o: HitOpts): void {
    const now = Tone.now();
    const n = this.scale.length;
    const combo = Math.max(0, o.combo);
    const idx = (combo + 2 * Math.floor(combo / 10)) % n;
    const vel = o.accuracyGrade === 'perfect' ? 1 : o.accuracyGrade === 'good' ? 0.8 : 0.6;
    try { // транзиент: perfect — на 3 дБ громче + низкий «чпок» с саб-хвостом 80 мс
      this.click.volume.value = o.perfect ? -1 : -4;
      this.click.triggerAttackRelease(hand === 'left' ? 'D3' : 'G3', 0.03, this.g.click.next(now));
      this.snap.triggerAttackRelease(0.04, this.g.snap.next(now));
      if (o.perfect) this.thump.triggerAttackRelease(hand === 'left' ? 'D2' : 'G2', 0.08, this.g.thump.next(now));
    } catch (e) { warn(e); }
    try { // слайс
      const t = this.g.slice.next(now);
      const hi = hand === 'left' ? 3200 : 4400, lo = hand === 'left' ? 450 : 700;
      this.pan.pan.value = hand === 'left' ? -0.4 : 0.4;
      this.sliceBp.frequency.cancelScheduledValues(t);
      this.sliceBp.frequency.setValueAtTime(hi, t);
      this.sliceBp.frequency.exponentialRampToValueAtTime(lo, t + (o.perfect ? 0.12 : 0.06));
      this.slice.triggerAttackRelease(o.perfect ? 0.1 : 0.05, t);
    } catch (e) { warn(e); }
    const bt = this.bellTime(now);
    if (!o.perfect) {
      try { this.bellDry.triggerAttackRelease(this.scale[idx]!, 0.08, this.g.bellDry.next(bt), vel); } catch (e) { warn(e); }
    } else {
      try {
        this.bell.triggerAttackRelease(this.scale[idx]!, 0.25, this.g.bell.next(bt), vel);
        this.shimA.triggerAttackRelease(this.up[idx]!, 0.2, this.g.shimA.next(bt + 0.01));
        this.shimB.triggerAttackRelease(this.up[(idx + 2) % n]!, 0.2, this.g.shimB.next(bt + 0.01));
      } catch (e) { warn(e); }
    }
    if (combo > 0 && combo % 10 === 0) {
      try {
        const d = this.step16 > 0 ? this.step16 / 2 : 0.0625; // 1/32
        const base = bt + 0.04;
        for (let i = 0; i < 3; i++) {
          this.arp.triggerAttackRelease(this.up[Math.min(i * 2, n - 1)]!, d * 0.9, this.g.arp.next(base + i * d));
        }
      } catch (e) { warn(e); }
    }
  }

  /** Импакт дропа: саб-дроп 60→35 Гц за 0.4 с + шум с реверберацией. time — время аудиоконтекста */
  impact(time?: number): void {
    const t0 = time ?? Tone.now();
    try {
      const t = this.g.impSub.next(t0);
      this.impSub.triggerAttackRelease(60, 0.4, t);
      this.impSub.frequency.exponentialRampToValueAtTime(35, t + 0.4);
      this.impNoise.triggerAttackRelease(0.4, this.g.impNoise.next(t0));
    } catch (e) { warn(e); }
  }

  /** Райзер вступления: шум с lowpass 200→8000 Гц и растущий питч-свип, dur секунд от time */
  riser(time: number, dur: number): void {
    try {
      this.stopRiser();
      this.riseNoise.start(time).stop(time + dur + 0.05);
      this.riseLp.frequency.cancelScheduledValues(time);
      this.riseLp.frequency.setValueAtTime(200, time);
      this.riseLp.frequency.exponentialRampToValueAtTime(8000, time + dur);
      this.riseGain.gain.cancelScheduledValues(time);
      this.riseGain.gain.setValueAtTime(0.02, time);
      this.riseGain.gain.exponentialRampToValueAtTime(0.9, time + dur);
      this.riseGain.gain.linearRampToValueAtTime(0, time + dur + 0.04);
      this.riseOsc.start(time).stop(time + dur + 0.05);
      this.riseOsc.frequency.cancelScheduledValues(time);
      this.riseOsc.frequency.setValueAtTime(110, time);
      this.riseOsc.frequency.exponentialRampToValueAtTime(1760, time + dur);
      this.riseOscGain.gain.cancelScheduledValues(time);
      this.riseOscGain.gain.setValueAtTime(0.005, time);
      this.riseOscGain.gain.exponentialRampToValueAtTime(0.12, time + dur);
      this.riseOscGain.gain.linearRampToValueAtTime(0, time + dur + 0.04);
    } catch (e) { warn(e); }
  }

  stopRiser(): void {
    try {
      const t = Tone.now();
      this.riseGain.gain.cancelScheduledValues(t); this.riseGain.gain.setValueAtTime(0, t);
      this.riseOscGain.gain.cancelScheduledValues(t); this.riseOscGain.gain.setValueAtTime(0, t);
      if (this.riseNoise.state === 'started') this.riseNoise.stop(t);
      if (this.riseOsc.state === 'started') this.riseOsc.stop(t);
    } catch (e) { warn(e); }
  }

  /** Тик отсчёта */
  tick(freq: number, time?: number): void {
    try { this.tickSynth.triggerAttackRelease(freq, 0.06, this.g.tick.next(time ?? Tone.now())); } catch (e) { warn(e); }
  }

  miss(): void {
    const now = Tone.now();
    try {
      this.missBody.triggerAttackRelease('E1', 0.25, this.g.missBody.next(now));
      const t = this.g.missTone.next(now);
      this.missTone.triggerAttackRelease(220, 0.15, t);
      this.missTone.frequency.exponentialRampToValueAtTime(100, t + 0.15);
    } catch (e) { warn(e); }
  }

  wrong(): void {
    const now = Tone.now();
    if (now - this.lastWrong < 0.15) return;
    this.lastWrong = now;
    try { this.wrongSynth.triggerAttackRelease('C2', 0.12, this.g.wrong.next(now)); } catch (e) { warn(e); }
  }
}
