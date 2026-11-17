import type { TrackDef, Section } from '../pattern';
import { chordEvents, drumEvents, monoGuard, noteEvents, stepDuration } from '../pattern';
import { stepEvents } from './util';

// «Разлом»: D minor, Dm–Bb–F–C, 172 bpm. 8+8+16+8+16+4 = 60 тактов ≈ 84 с
const PROG = ['D3 F3 A3', 'Bb2 D3 F3', 'F3 A3 C4', 'C3 E3 G3'];

const KICK = 'x.........x.....';
const SNARE = '....x.......x...';
const HAT16 = 'xxxxxxxxxxxxxxxx';
const BASS = '0 . . 0 . . 0 . 0 . . . 2 . 0 .';
/** тихие снейры-гост (не попадают в карту кубов) */
const GHOST: Record<string, string> = { build: '.......x.x.....x', drop: '.......x.x.....x' };
const STAB: Record<string, string> = { drop: '..x....x..x.....' };

const sections: Section[] = [
  { name: 'intro', bars: 8, kick: '................', snare: '................', hat: '..x...x...x...x.', chords: PROG },
  { name: 'build', bars: 4, kick: KICK, snare: SNARE, hat: 'x.x.x.x.x.x.x.x.', chords: PROG },
  { name: 'build', bars: 4, kick: KICK, snare: '....x...x.x.x.xx', hat: HAT16, chords: PROG },
  { name: 'drop', bars: 16, kick: KICK, snare: SNARE, hat: HAT16, bass: BASS, chords: PROG },
  { name: 'break', bars: 8, kick: '................', snare: '................', hat: '..x...x...x...x.', chords: PROG },
  { name: 'drop', bars: 16, kick: KICK, snare: SNARE, hat: HAT16, bass: BASS, chords: PROG },
  { name: 'outro', bars: 4, kick: KICK, snare: '................', hat: '..x...x...x...x.', chords: PROG },
];

export const dnb: TrackDef = {
  id: 'dnb',
  name: 'Разлом',
  style: 'Drum & Bass',
  subtitle: 'Драм-н-бейс',
  difficultyStars: 3,
  bpm: 172,
  scale: ['D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'F5'],
  sections,
  build(ctx) {
    const T = ctx.Tone;
    const tr = ctx.track;
    const sd = stepDuration(ctx.def.bpm);

    const kick = tr(new T.MembraneSynth({ pitchDecay: 0.035, octaves: 6, envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.08 }, volume: -4 })).connect(ctx.out);
    const snF = tr(new T.Filter(2200, 'bandpass')).connect(ctx.out);
    const snare = tr(new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.04 }, volume: -8 })).connect(snF);
    const ghost = tr(new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 }, volume: -22 })).connect(snF);
    const hat = tr(new T.MetalSynth({ envelope: { attack: 0.001, decay: 0.04, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5, volume: -30 })).connect(ctx.out);

    // Reese: детюн-пила (октавой выше саб-регистра) + AutoFilter + дисторшн
    const dist = tr(new T.Distortion({ distortion: 0.3, wet: 0.4 })).connect(ctx.out);
    const af = tr(new T.AutoFilter({ frequency: '8n', baseFrequency: 120, octaves: 3, depth: 0.9 })).connect(dist);
    af.start();
    const bass = tr(new T.MonoSynth({
      oscillator: { type: 'fatsawtooth', count: 3, spread: 35 },
      detune: 1200,
      filter: { type: 'lowpass', Q: 3, rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.1 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.2, baseFrequency: 200, octaves: 2 },
      volume: -12,
    })).connect(af);

    const padFx = tr(new T.Reverb({ decay: 5, wet: 0.45 })).connect(ctx.out);
    const pad = tr(new T.PolySynth(T.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 1.2, decay: 0.3, sustain: 0.8, release: 1.5 }, volume: -23 })).connect(tr(new T.Filter(1300, 'lowpass')).connect(padFx));
    const stab = tr(new T.PolySynth(T.Synth, { oscillator: { type: 'square' }, envelope: { attack: 0.003, decay: 0.09, sustain: 0, release: 0.05 }, volume: -22 })).connect(tr(new T.Filter(2600, 'lowpass')).connect(ctx.out));

    const gKick = monoGuard(), gSnare = monoGuard(), gGhost = monoGuard(), gHat = monoGuard(), gBass = monoGuard();
    ctx.part(drumEvents(ctx.def, 'kick'), (t) => kick.triggerAttackRelease('C1', '16n', gKick(t)));
    ctx.part(drumEvents(ctx.def, 'snare'), (t) => snare.triggerAttackRelease('16n', gSnare(t)));
    ctx.part(stepEvents(ctx.def, s => GHOST[s.name]), (t) => ghost.triggerAttackRelease('32n', gGhost(t)));
    ctx.part(drumEvents(ctx.def, 'hat'), (t, e) => hat.triggerAttackRelease(200, '32n', gHat(t), e.step % 4 === 0 ? 0.9 : 0.5));
    ctx.part(noteEvents(ctx.def, 'bass'), (t, e) => bass.triggerAttackRelease(e.note, e.dur, gBass(t)));
    ctx.part(stepEvents(ctx.def, s => STAB[s.name]), (t, e) => stab.triggerAttackRelease(e.notes, sd * 1.2, t));
    ctx.part(chordEvents(ctx.def), (t, e) => pad.triggerAttackRelease(e.notes, e.dur, t));
  },
};
