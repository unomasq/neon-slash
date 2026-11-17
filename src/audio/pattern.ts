import type * as ToneNS from 'tone';
import type { Beatmap, Difficulty } from '../types';
import type { Analysis } from './onset';

// Описание трека: единственный источник правды и для звука, и для карты кубов.
export interface Section {
  name: string;
  bars: number;
  /** 16 символов на такт: 'x' удар, '.' пауза; повторяется на все bars секции */
  kick: string;
  snare: string;
  hat: string;
  /** 16 токенов через пробел: '.' пауза, нота ('C2'), либо цифра 0..3 — тон текущего аккорда (3 = тоника октавой выше) */
  bass?: string;
  lead?: string;
  /** аккорд на такт (ноты через пробел, 3 ноты), циклически */
  chords?: string[];
  /** арпеджио 16-ми по аккорду секции */
  arp?: boolean;
}

export interface BuildCtx {
  Tone: typeof ToneNS;
  /** общий выход (лимитер на destination) */
  out: ToneNS.ToneAudioNode;
  def: TrackDef;
  /** регистрирует узел для освобождения при очистке */
  track<T extends { dispose(): unknown }>(node: T): T;
  /** создаёт Tone.Part на транспорте; время событий — секунды от начала трека */
  part<E extends { time: number }>(events: E[], cb: (time: number, ev: E) => void): void;
  /** регистрирует Tone.Player, который стартует вместе с треком (после lead-in) и подчиняется Transport */
  syncPlayer(player: ToneNS.Player): void;
}

export interface TrackDef {
  id: string;
  name: string;
  style: string;
  /** жанр по-русски для UI */
  subtitle?: string;
  difficultyStars?: 1 | 2 | 3;
  bpm: number;
  /** ноты лада для звона ударов (пентатоника, 2 октавы); без поля — A minor по умолчанию, без квантования */
  scale?: string[];
  sections: Section[];
  /** длительность вместо расчёта по секциям (для загруженного аудио) */
  durationOverride?: number;
  /** готовая карта вместо генерации из паттернов */
  /** анализ загруженного аудио (биты, онсеты, энергия) — для fx-событий */
  analysis?: Analysis;
  customBeatmap?: (d: Difficulty) => Beatmap;
  build(ctx: BuildCtx): void;
}

export type DrumKey = 'kick' | 'snare' | 'hat';

export interface DrumEvent {
  time: number;
  sectionIndex: number;
  section: Section;
  bar: number;     // такт внутри секции
  step: number;    // 0..15
  index: number;   // порядковый номер удара внутри секции
}

export interface NoteEvent { time: number; note: string; dur: number }
export interface ChordEvent { time: number; notes: string[]; dur: number }

export const STEPS_PER_BAR = 16;

export function stepDuration(bpm: number): number { return 60 / bpm / 4; }
export function barDuration(bpm: number): number { return stepDuration(bpm) * STEPS_PER_BAR; }
export function totalBars(def: TrackDef): number { return def.sections.reduce((s, x) => s + x.bars, 0); }
export function trackDuration(def: TrackDef): number { return def.durationOverride ??  totalBars(def) * barDuration(def.bpm); }

export const TIME_EPS = 1e-4;

/** Сортирует по времени и убирает события одного инструмента с совпадающим временем (в пределах 1e-4 с) */
export function dedupeByTime<E extends { time: number }>(events: E[]): E[] {
  const sorted = events.slice().sort((a, b) => a.time - b.time);
  const out: E[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && e.time - last.time < TIME_EPS) continue;
    out.push(e);
  }
  return out;
}

/**
 * Защита для моносинтов (MembraneSynth, MonoSynth, NoiseSynth, MetalSynth): Tone бросает
 * «Start time must be strictly greater than previous start time», если время запуска не растёт строго.
 * Возвращает функцию, которая сдвигает время на +0.001 с, когда оно <= предыдущего.
 */
export function monoGuard(): (time: number) => number {
  let last = -Infinity;
  return (time) => {
    const t = time <= last ? last + 0.001 : time;
    last = t;
    return t;
  };
}

/** Все удары барабана с абсолютным временем */
export function drumEvents(def: TrackDef, key: DrumKey): DrumEvent[] {
  const out: DrumEvent[] = [];
  const sd = stepDuration(def.bpm);
  let barOffset = 0;
  def.sections.forEach((section, sectionIndex) => {
    const pat = section[key];
    let index = 0;
    for (let bar = 0; bar < section.bars; bar++) {
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        if (pat[step] === 'x') {
          out.push({ time: ((barOffset + bar) * STEPS_PER_BAR + step) * sd, sectionIndex, section, bar, step, index: index++ });
        }
      }
    }
    barOffset += section.bars;
  });
  return dedupeByTime(out);
}

export function eventTimes(def: TrackDef): { kick: number[]; snare: number[]; hat: number[]; bars: number } {
  return {
    kick: drumEvents(def, 'kick').map(e => e.time),
    snare: drumEvents(def, 'snare').map(e => e.time),
    hat: drumEvents(def, 'hat').map(e => e.time),
    bars: totalBars(def),
  };
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function toMidi(n: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error('Bad note: ' + n);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + BASE[m[1]!]! + acc;
}
function toName(midi: number): string { return NAMES[((midi % 12) + 12) % 12]! + (Math.floor(midi / 12) - 1); }

/** Токен -> нота: абсолютное имя, либо индекс тона аккорда (0..3) со сдвигом в полутонах */
function resolve(token: string, chord: string[], shift: number): string | null {
  if (token === '.') return null;
  if (/^[0-3]$/.test(token)) {
    const i = Number(token);
    const base = toMidi(chord[i % chord.length]!) + (i >= chord.length ? 12 : 0);
    return toName(base + shift);
  }
  return toName(toMidi(token));
}

/** Бас/лид/арпеджио: ноты по тактам секций, аккорды берутся циклически */
export function noteEvents(def: TrackDef, key: 'bass' | 'lead' | 'arp'): NoteEvent[] {
  const out: NoteEvent[] = [];
  const sd = stepDuration(def.bpm);
  const ARP = ['0', '1', '2', '3', '2', '1', '2', '1'];
  let barOffset = 0;
  for (const s of def.sections) {
    const chords = (s.chords ?? []).map(c => c.split(/\s+/));
    const tokens = key === 'arp' ? null : (s[key]?.trim().split(/\s+/) ?? null);
    if (chords.length && (tokens || (key === 'arp' && s.arp))) {
      for (let bar = 0; bar < s.bars; bar++) {
        const chord = chords[bar % chords.length]!;
        for (let step = 0; step < STEPS_PER_BAR; step++) {
          const tok = tokens ? tokens[step] ?? '.' : ARP[step % ARP.length]!;
          const shift = key === 'bass' ? -24 : key === 'lead' ? 12 : 12;
          const note = resolve(tok, chord, shift);
          if (note) out.push({ time: ((barOffset + bar) * STEPS_PER_BAR + step) * sd, note, dur: key === 'bass' ? sd * 1.8 : key === 'lead' ? sd * 2 : sd * 0.9 });
        }
      }
    }
    barOffset += s.bars;
  }
  return dedupeByTime(out);
}

export function chordEvents(def: TrackDef): ChordEvent[] {
  const out: ChordEvent[] = [];
  const bd = barDuration(def.bpm);
  let barOffset = 0;
  for (const s of def.sections) {
    const chords = s.chords;
    if (chords && chords.length) {
      for (let bar = 0; bar < s.bars; bar++) {
        out.push({ time: (barOffset + bar) * bd, notes: chords[bar % chords.length]!.split(/\s+/), dur: bd * 0.98 });
      }
    }
    barOffset += s.bars;
  }
  return dedupeByTime(out);
}
