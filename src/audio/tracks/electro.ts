import type { TrackDef, Section } from '../pattern';
import { chordEvents, drumEvents, monoGuard, noteEvents, stepDuration } from '../pattern';
import { stepEvents } from './util';

// «Хром и неон»: F minor, Fm–Db–Ab–Eb, 124 bpm. 4+8+12+8+12+4 = 48 тактов ≈ 93 с
const PROG = ['F3 Ab3 C4', 'Db3 F3 Ab3', 'Ab3 C4 Eb4', 'Eb3 G3 Bb3'];

const FOUR = 'x...x...x...x...';
const CLAP = '....x.......x...';
const OFFBEAT = '..x...x...x...x.';
const ALL16 = 'xxxxxxxxxxxxxxxx';
const BASS = '. 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0';
const STAB: Record<string, string> = { drop: '...x..x...x..x..', break: '................' };

const sections: Section[] = [
  { name: 'intro', bars: 4, kick: FOUR, snare: '................', hat: OFFBEAT, chords: PROG },
  { name: 'build', bars: 4, kick: FOUR, snare: CLAP, hat: 'x.x.x.x.x.x.x.x.', bass: BASS, chords: PROG },
  { name: 'build', bars: 4, kick: FOUR, snare: 'x...x...x.x.x.xx', hat: ALL16, bass: BASS, chords: PROG },
  { name: 'drop', bars: 12, kick: FOUR, snare: CLAP, hat: OFFBEAT, bass: BASS, chords: PROG, arp: true },
  { name: 'break', bars: 8, kick: '................', snare: '................', hat: '................', chords: PROG, arp: true },
  { name: 'drop', bars: 12, kick: FOUR, snare: CLAP, hat: OFFBEAT, bass: BASS, chords: PROG, arp: true },
  { name: 'outro', bars: 4, kick: FOUR, snare: '................', hat: OFFBEAT, chords: PROG },
];

export const electro: TrackDef = {
  id: 'electro',
  name: 'Хром и неон',
  style: 'Electro / House',
  subtitle: 'Электро',
  difficultyStars: 2,
  bpm: 124,
  scale: ['F4', 'Ab4', 'Bb4', 'C5', 'Eb5', 'F5', 'Ab5'],
  sections,
  build(ctx) {
    const T = ctx.Tone;
    const tr = ctx.track;
    const sd = stepDuration(ctx.def.bpm);

    const kick = tr(new T.MembraneSynth({ pitchDecay: 0.03, octaves: 7, envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.1 }, volume: -4 })).connect(ctx.out);
    const clapRev = tr(new T.Reverb({ decay: 1.2, wet: 0.25 })).connect(ctx.out);
    const clapF = tr(new T.Filter(1500, 'bandpass')).connect(clapRev);
    const clap = tr(new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.03 }, volume: -9 })).connect(clapF);
    const hat = tr(new T.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5, volume: -28 })).connect(ctx.out);

    // Сайдчейн: бас пропадает на каждом кике и возвращается за ~0.2 с
    const duck = tr(new T.Gain(1)).connect(ctx.out);
    const bass = tr(new T.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', Q: 1, rolloff: -24 },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.7, release: 0.08 },
      filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, release: 0.1, baseFrequency: 90, octaves: 2 },
      volume: -9,
    })).connect(duck);

    const padFx = tr(new T.Reverb({ decay: 4, wet: 0.35 })).connect(ctx.out);
    const pad = tr(new T.PolySynth(T.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.8, decay: 0.3, sustain: 0.8, release: 1.2 }, volume: -24 })).connect(tr(new T.Filter(1500, 'lowpass')).connect(padFx));
    const stabDelay = tr(new T.FeedbackDelay({ delayTime: '8n.', feedback: 0.3, wet: 0.2 })).connect(ctx.out);
    const stab = tr(new T.PolySynth(T.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.08 }, volume: -20 })).connect(tr(new T.Filter(2800, 'lowpass')).connect(stabDelay));
    const arpDelay = tr(new T.FeedbackDelay({ delayTime: '8n.', feedback: 0.3, wet: 0.25 })).connect(ctx.out);
    const arp = tr(new T.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.004, decay: 0.12, sustain: 0.05, release: 0.08 }, volume: -22 })).connect(tr(new T.Filter(3500, 'lowpass')).connect(arpDelay));

    const gKick = monoGuard(), gClap = monoGuard(), gHat = monoGuard(), gBass = monoGuard();
    ctx.part(drumEvents(ctx.def, 'kick'), (t) => {
      const k = gKick(t);
      kick.triggerAttackRelease('C1', '8n', k);
      duck.gain.cancelScheduledValues(k);
      duck.gain.setValueAtTime(0.15, k);
      duck.gain.linearRampToValueAtTime(1, k + sd * 3);
    });
    ctx.part(drumEvents(ctx.def, 'snare'), (t) => clap.triggerAttackRelease('16n', gClap(t)));
    ctx.part(drumEvents(ctx.def, 'hat'), (t, e) => hat.triggerAttackRelease(e.step % 4 === 2 ? 300 : 200, e.step % 4 === 2 ? '16n' : '32n', gHat(t), e.step % 4 === 2 ? 1 : 0.6));
    ctx.part(noteEvents(ctx.def, 'bass'), (t, e) => bass.triggerAttackRelease(e.note, e.dur, gBass(t)));
    ctx.part(noteEvents(ctx.def, 'arp'), (t, e) => arp.triggerAttackRelease(e.note, e.dur, t));
    ctx.part(stepEvents(ctx.def, s => STAB[s.name]), (t, e) => stab.triggerAttackRelease(e.notes, sd * 1.5, t));
    ctx.part(chordEvents(ctx.def), (t, e) => pad.triggerAttackRelease(e.notes, e.dur, t));
  },
};
