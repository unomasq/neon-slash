import type { Section, TrackDef } from '../pattern';
import { STEPS_PER_BAR, dedupeByTime, stepDuration } from '../pattern';

export interface StepEvent { time: number; step: number; notes: string[] }

/** События по произвольному 16-шаговому паттерну секции ('x' = удар); notes — аккорд такта */
export function stepEvents(def: TrackDef, pick: (s: Section) => string | undefined): StepEvent[] {
  const out: StepEvent[] = [];
  const sd = stepDuration(def.bpm);
  let barOffset = 0;
  for (const s of def.sections) {
    const pat = pick(s);
    if (pat) {
      const chords = (s.chords ?? []).map(c => c.split(/\s+/));
      for (let bar = 0; bar < s.bars; bar++) {
        for (let step = 0; step < STEPS_PER_BAR; step++) {
          if (pat[step] === 'x') out.push({ time: ((barOffset + bar) * STEPS_PER_BAR + step) * sd, step, notes: chords.length ? chords[bar % chords.length]! : [] });
        }
      }
    }
    barOffset += s.bars;
  }
  return dedupeByTime(out);
}
