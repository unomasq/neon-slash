import type { Beatmap, Difficulty } from '../types';
import { assignNotes, hashStr, type AssignEvent } from './beatmap';
import type { Analysis } from './onset';
import type { TrackDef } from './pattern';

const MIN_STRENGTH: Record<Difficulty, number> = { easy: 0.55, normal: 0.4, hard: 0.28 };
const SNAP = 0.06;
const EDGE = 2;

function nearest(sorted: number[], t: number): number | null {
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! < t) lo = m + 1; else hi = m; }
  let best: number | null = null;
  for (const i of [lo - 1, lo]) {
    const v = sorted[i];
    if (v !== undefined && (best === null || Math.abs(v - t) < Math.abs(best - t))) best = v;
  }
  return best;
}

export function buildCustomBeatmap(a: Analysis, difficulty: Difficulty): Beatmap {
  const sorted = a.energyCurve.slice().sort((x, y) => x - y);
  const quietLimit = 0.25 * (sorted[sorted.length >> 1] ?? 0);
  const min = MIN_STRENGTH[difficulty];
  // кубы начинаются с первого момента, где энергия выше 40-го перцентиля
  const p40 = sorted[Math.floor(sorted.length * 0.4)] ?? 0;
  const firstLoud = a.energyCurve.findIndex(v => v > p40);
  const startT = Math.max(EDGE, firstLoud < 0 ? 0 : firstLoud / 10);
  const evs: AssignEvent[] = [];
  for (const o of a.onsets) {
    if (o.strength < min) continue;
    if (o.t < startT || o.t > a.duration - EDGE) continue;
    if ((a.energyCurve[Math.floor(o.t * 10)] ?? 0) < quietLimit) continue;
    const b = nearest(a.beats, o.t);
    const t = b !== null && Math.abs(b - o.t) < SNAP ? b : o.t;
    evs.push({ t, kind: o.band === 'low' ? 'kick' : 'snare', strength: o.strength });
  }
  const seed = hashStr(`${a.duration.toFixed(2)}:${a.bpm}:${difficulty}`);
  return { notes: assignNotes(evs, difficulty, seed), duration: a.duration, bpm: Math.round(a.bpm) };
}

export function makeCustomTrackDef(_file: File | Blob, name: string, analysis: Analysis, audioBuffer: AudioBuffer): TrackDef {
  return {
    id: 'custom',
    name,
    style: 'custom',
    subtitle: 'Свой трек',
    bpm: Math.round(analysis.bpm),
    sections: [],
    durationOverride: audioBuffer.duration,
    analysis,
    customBeatmap: (d) => buildCustomBeatmap(analysis, d),
    build(ctx) {
      const { Tone } = ctx;
      const player = new Tone.Player(new Tone.ToneAudioBuffer(audioBuffer));
      player.connect(ctx.out);
      ctx.syncPlayer(player);
    },
  };
}
