import type { Beatmap, Difficulty, Dir8, Hand, Note } from '../types';
import type { DrumEvent, TrackDef } from './pattern';
import { drumEvents, trackDuration } from './pattern';

const EPS = 1e-6;
/** Мин. интервал между любыми кубами и между кубами одной руки, с. */
const GAP_ANY: Record<Difficulty, number> = { easy: 1.0, normal: 0.7, hard: 0.45 };
const GAP_HAND: Record<Difficulty, number> = { easy: 1.0, normal: 1.2, hard: 0.45 };
const DOUBLE_EVERY = 4;

// Детерминированный PRNG (mulberry32) и хеш строки
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cand { time: number; kind: Kind; step: number }
const ORDER: Record<Kind, number> = { kick: 0, snare: 1, hat: 2 };
export type Kind = 'kick' | 'snare' | 'hat';
export interface AssignEvent { t: number; kind: Kind; strength: number; /** позиция в такте 0..15 (необязательно) */ step?: number }

const DIR_POOL_HARD: Dir8[] = [4, 4, 4, 2, 6, 'any'];

export function buildBeatmap(def: TrackDef, difficulty: Difficulty): Beatmap {
  if (def.customBeatmap) return def.customBeatmap(difficulty);
  // События — те же, что играет музыка
  const evs: AssignEvent[] = [];
  const add = (src: DrumEvent[], kind: Kind, filter?: (e: DrumEvent) => boolean) => {
    for (const e of src) if (e.section.name !== 'intro' && (!filter || filter(e))) evs.push({ t: e.time, kind, strength: 1, step: e.step });
  };
  add(drumEvents(def, 'kick'), 'kick');
  if (difficulty !== 'easy') add(drumEvents(def, 'snare'), 'snare');
  if (difficulty === 'hard') add(drumEvents(def, 'hat'), 'hat', e => ['chorus', 'drop'].includes(e.section.name) && e.index % 2 === 1);
  return { notes: assignNotes(evs, difficulty, hashStr(def.id + ':' + difficulty)), duration: trackDuration(def), bpm: def.bpm };
}

/** Назначает руку/лейн/ряд/направление с ограничениями интервалов; события — кандидаты на кубы */
export function assignNotes(events: AssignEvent[], difficulty: Difficulty, seed: number): Note[] {
  const rnd = mulberry32(seed);
  const cands = events.map(e => ({ time: e.t, kind: e.kind, step: e.step ?? 0 })).sort((a, b) => a.time - b.time || ORDER[a.kind] - ORDER[b.kind]);
  const gapAny = GAP_ANY[difficulty], gapHand = GAP_HAND[difficulty];
  const lastByHand: Record<Hand, number> = { left: -Infinity, right: -Infinity };
  let lastAny = -Infinity;
  let lastDouble = -Infinity;
  let kickHand: Hand = 'right';
  let lastHand: Hand = 'right';
  let rowToggle = 0;
  const laneCount: Record<Hand, number> = { left: 0, right: 0 };
  const notes: Note[] = [];

  const ok = (h: Hand, t: number) => t - lastByHand[h] >= gapHand - EPS;
  const other = (h: Hand): Hand => (h === 'left' ? 'right' : 'left');

  const emit = (hand: Hand, c: Cand) => {
    const dir: Dir8 = difficulty === 'hard' ? DIR_POOL_HARD[Math.floor(rnd() * DIR_POOL_HARD.length)]! : 'any';
    rowToggle ^= 1;
    let lane: number, row: number;
    if (difficulty === 'easy') { lane = hand === 'left' ? 1 : 2; row = 1; }
    else {
      lane = (hand === 'left' ? 0 : 2) + (laneCount[hand]++ % 2);
      row = difficulty === 'normal' ? rowToggle : (c.step % 4 === 0 ? 1 : rowToggle);
    }
    notes.push({ id: 0, time: c.time, hand, dir, lane, row });
    lastByHand[hand] = c.time;
    lastAny = c.time;
    lastHand = hand;
  };

  let i = 0;
  while (i < cands.length) {
    // группа одновременных кандидатов
    let j = i;
    while (j < cands.length && cands[j]!.time - cands[i]!.time < EPS) j++;
    const group = cands.slice(i, j);
    i = j;
    const c = group.find(g => g.kind === 'kick') ?? group[0]!;
    if (c.time - lastAny < gapAny - EPS) continue;

    // рука: кик чередуется, снейр/хэт — противоположная предыдущей
    let hand: Hand;
    if (c.kind === 'kick') { kickHand = other(kickHand); hand = kickHand; } else hand = other(lastHand);
    if (!ok(hand, c.time)) hand = other(hand);
    if (!ok(hand, c.time)) continue;

    // hard: два куба одновременно (обе руки) не чаще раза в DOUBLE_EVERY с
    if (difficulty === 'hard' && group.length > 1 && ok(other(hand), c.time) && c.time - lastDouble >= DOUBLE_EVERY - EPS) {
      const second = group.find(g => g !== c)!;
      emit(hand, c);
      emit(other(hand), second);
      lastDouble = c.time;
    } else {
      emit(hand, c);
    }
  }

  notes.sort((a, b) => a.time - b.time);
  notes.forEach((n, k) => { n.id = k; });
  return notes;
}
