import type { TrackDef, Section } from '../pattern';
import { chordEvents, drumEvents, monoGuard, noteEvents } from '../pattern';

// «Неоновый закат»: A minor, Am–F–C–G, 100 bpm
const PROG = ['A3 C4 E4', 'F3 A3 C4', 'C4 E4 G4', 'G3 B3 D4'];

const BASS8 = '0 . 0 . 0 . 2 . 0 . 0 . 3 . 2 .';
const LEAD = '3 . . 2 . 1 . . 2 . 3 . . . 1 .';

const section = (s: Section): Section => s;

const sections: Section[] = [
  section({ name: 'intro', bars: 4, kick: '................', snare: '................', hat: '..x...x...x...x.', chords: PROG }),
  section({ name: 'verse', bars: 8, kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', bass: BASS8, chords: PROG, arp: true }),
  section({ name: 'chorus', bars: 8, kick: 'x...x...x.x.x...', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', bass: BASS8, lead: LEAD, chords: PROG, arp: true }),
  section({ name: 'break', bars: 4, kick: 'x.......x.......', snare: '....x.......x...', hat: '................', chords: PROG, arp: true }),
  section({ name: 'chorus', bars: 8, kick: 'x...x...x.x.x...', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', bass: BASS8, lead: LEAD, chords: PROG, arp: true }),
  section({ name: 'outro', bars: 4, kick: '................', snare: '................', hat: '..x...x...x...x.', chords: PROG }),
];

export const synthwave: TrackDef = {
  id: 'synthwave',
  name: 'Неоновый закат',
  style: 'Synthwave',
  subtitle: 'Синтвейв',
  difficultyStars: 1,
  bpm: 100,
  scale: ['A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6'],
  sections,
  build(ctx) {
    const T = ctx.Tone;
    const tr = ctx.track;

    // Кик
    const kick = tr(new T.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 }, volume: -4 })).connect(ctx.out);
    // Снейр: шум через полосовой фильтр
    const snF = tr(new T.Filter(1800, 'bandpass')).connect(ctx.out);
    const snare = tr(new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 }, volume: -10 })).connect(snF);
    // Хэт
    const hat = tr(new T.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 5000, octaves: 1.5, volume: -28 })).connect(ctx.out);
    // Бас
    const bass = tr(new T.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', Q: 2, rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.1 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.2, baseFrequency: 150, octaves: 2.5 },
      volume: -10,
    })).connect(ctx.out);
    // Пэд
    const padFx = tr(new T.Reverb({ decay: 4, wet: 0.35 })).connect(ctx.out);
    const pad = tr(new T.PolySynth(T.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.9, decay: 0.3, sustain: 0.8, release: 1.2 }, volume: -22 })).connect(tr(new T.Filter(1400, 'lowpass')).connect(padFx));
    // Арпеджио
    const arpDelay = tr(new T.FeedbackDelay({ delayTime: '8n.', feedback: 0.3, wet: 0.25 })).connect(ctx.out);
    const arp = tr(new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.15, sustain: 0.1, release: 0.1 }, volume: -20 })).connect(arpDelay);
    // Лид
    const leadRev = tr(new T.Reverb({ decay: 2.5, wet: 0.3 })).connect(ctx.out);
    const leadDelay = tr(new T.FeedbackDelay({ delayTime: '8n', feedback: 0.35, wet: 0.25 })).connect(leadRev);
    const lead = tr(new T.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 }, volume: -18 })).connect(tr(new T.Filter(3000, 'lowpass')).connect(leadDelay));

    // Моносинты: время запуска должно строго расти
    const gKick = monoGuard(), gSnare = monoGuard(), gHat = monoGuard(), gBass = monoGuard();
    ctx.part(drumEvents(ctx.def, 'kick'), (t) => kick.triggerAttackRelease('C1', '8n', gKick(t)));
    ctx.part(drumEvents(ctx.def, 'snare'), (t) => snare.triggerAttackRelease('16n', gSnare(t)));
    ctx.part(drumEvents(ctx.def, 'hat'), (t) => hat.triggerAttackRelease(200, '32n', gHat(t)));
    ctx.part(noteEvents(ctx.def, 'bass'), (t, e) => bass.triggerAttackRelease(e.note, e.dur, gBass(t)));
    ctx.part(noteEvents(ctx.def, 'arp'), (t, e) => arp.triggerAttackRelease(e.note, e.dur, t));
    ctx.part(noteEvents(ctx.def, 'lead'), (t, e) => lead.triggerAttackRelease(e.note, e.dur, t));
    ctx.part(chordEvents(ctx.def), (t, e) => pad.triggerAttackRelease(e.notes, e.dur, t));
  },
};
