import {
  CUBE_SPAWN_Z, CUBE_SPEED, LATENCY_DEFAULT_MS,
} from '../config';
import { Vector3 } from 'three';
import { buildBeatmap, type TrackPlayer, type TrackDef } from '../audio';
import type { GameScene } from '../scene';
import type { HandTracker } from '../tracking';
import type { Hud } from '../ui/hud';
import type { Beatmap, Difficulty, Hand, HitKind, Note } from '../types';
import { HandSwing, angleMatches, distToSeg2, sliceDirFromDir8, sweepHitScreen, type Seg, type P2, type Box2 } from './hit';
import { CubeDiag } from './diag';
import { PracticeClock, PracticeGen, describeResult, type Clock } from './practice';
import {
  BACKSWING_MS, DIR_SECOND_CHANCE_MS, HIT_Z_MAX, HIT_Z_MIN, HIT_Z_PERFECT, JUDGE_Z_MIN, SCREEN_HIT_PAD,
  SWING_SPEED_MIN_HIT, WRONG_DIR_SPEED_MULT,
} from './tuning';
import { ScoreState } from './score';
import { fx, fxState, tierForCombo } from '../fx/bus';

const SPAWN_LEAD = (0 - CUBE_SPAWN_Z) / CUBE_SPEED;
const DIM_HOLD = 0.25;
const DIM_FADE = 1.0;
const HANDS: Hand[] = ['left', 'right'];
interface ArmableScene { setCubeArmed?(id: number, armed: boolean): void }
interface AutoQualityScene { updateAutoQuality?(now: number): void }
interface FxPlayer { updateFx?(): void }

export class GameEngine {
  swapHands = false;
  latencyOffset = LATENCY_DEFAULT_MS / 1000;
  readonly score = new ScoreState();

  private scene: GameScene;
  private player: TrackPlayer;
  private tracker: HandTracker;
  private hud: Hud;
  private beatmap: Beatmap | null = null;
  private def: TrackDef | null = null;
  private difficulty: Difficulty = 'normal';
  private nextNote = 0;
  private running = false;
  private lastNow = 0;
  private lastMissSound = 0;
  onTracking: ((state: ReturnType<HandTracker['update']>, raw: Float32Array) => void) | null = null;
  private dimHold = 0;
  private prevTier = 0;
  private pTrack = 0;
  private pScene = 0;
  private pFrame = 0;
  private clock: Clock;
  private practice: PracticeGen | null = null;
  private diag = new CubeDiag();
  private armFn: ((id: number, armed: boolean) => void) | null;
  private armed = new Set<number>();
  private lastGood: Record<Hand, number> = { left: -Infinity, right: -Infinity };
  private swing: Record<Hand, HandSwing> = { left: new HandSwing(), right: new HandSwing() };
  private prevSeg: Record<Hand, Seg | null> = { left: null, right: null };
  private curSeg: Record<Hand, Seg> = {
    left: { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 } }, right: { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 } },
  };

  private scrCur: Record<Hand, { a: P2; b: P2 }> = {
    left: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }, right: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
  };
  private scrPrev: Record<Hand, { a: P2; b: P2 }> = {
    left: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }, right: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
  };
  private box: Box2 = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private vA = new Vector3();
  private vB = new Vector3();

  constructor(scene: GameScene, player: TrackPlayer, tracker: HandTracker, hud: Hud) {
    this.scene = scene;
    const as = scene as unknown as ArmableScene;
    this.armFn = typeof as.setCubeArmed === 'function' ? (id, a) => as.setCubeArmed!(id, a) : null;
    this.player = player;
    this.clock = player;
    this.tracker = tracker;
    this.hud = hud;
    this.player.onEnd(() => this.finish());
  }

  startTrack(def: TrackDef, difficulty: Difficulty): void {
    this.stop();
    this.def = def;
    this.clock = this.player;
    this.practice = null;
    this.diag.reset();
    this.resetHit();
    this.difficulty = difficulty;
    this.beatmap = buildBeatmap(def, difficulty);
    this.nextNote = 0;
    this.score.reset();
    this.lastNow = 0;
    this.resetFx();
    this.hud.hideResult();
    this.hud.update(this.score);
    this.player.start(2);
    this.running = true;
  }

  /** Режим тренировки: без музыки, виртуальные часы, кубы каждые 2 с. */
  startPractice(): void {
    this.stop();
    this.player.prepareSfx();
    this.def = null;
    this.clock = new PracticeClock();
    this.practice = new PracticeGen();
    this.beatmap = { notes: [], duration: Infinity, bpm: 0 };
    this.nextNote = 0;
    this.score.reset();
    this.diag.reset();
    this.resetHit();
    this.lastNow = 0;
    this.resetFx();
    this.hud.hideResult();
    this.hud.update(this.score);
    this.running = true;
  }

  /** Пауза/продолжение для режима тренировки (в треке паузит player). */
  setPracticePaused(p: boolean): void {
    if (!(this.clock instanceof PracticeClock)) return;
    if (p) this.clock.pause(); else this.clock.resume();
  }

  private resetFx(): void {
    this.dimHold = 0; this.prevTier = 0;
    fxState.dim = 0; fxState.combo = 0; fxState.tier = 0;
  }

  /** Регистрирует провал: сброс комбо + события fx */
  private registerFail(kind: HitKind): void {
    const lost = this.score.combo;
    this.score.registerFail(kind);
    if (kind === 'miss') fx.emit({ type: 'miss' }); else fx.emit({ type: 'wrong' });
    if (lost >= 5) fx.emit({ type: 'comboBreak', lost });
    this.prevTier = 0;
    if (kind === 'miss' || lost >= 5) { fxState.dim = 1; this.dimHold = DIM_HOLD; }
  }

  private resetHit(): void {
    this.armed.clear();
    this.lastGood.left = -Infinity; this.lastGood.right = -Infinity;
  }

  stop(): void {
    this.running = false;
    this.diag.reset();
    this.player.stop();
    const cubes = this.scene.getActiveCubes();
    for (let i = cubes.length - 1; i >= 0; i--) this.scene.removeCube(cubes[i]!.note.id, 'miss');
  }

  private finish(): void {
    if (!this.running) return;
    this.running = false;
    this.hud.showResult(this.score, () => {
      if (this.def) this.startTrack(this.def, this.difficulty);
    });
  }

  private report(note: Note, kind: HitKind, pts: number, songTime: number, half: number, z: number): void {
    const { rec, lastDir } = this.diag.finish(note, kind, pts, songTime, this.swapHands, z);
    if (this.practice) this.hud.bigText(describeResult(kind, note, rec, lastDir, half), kind === 'good');
  }

  private fail(note: Note, kind: HitKind, bad: boolean, songTime: number, half: number, z: number): void {
    this.scene.removeCube(note.id, bad ? 'bad' : 'miss');
    this.registerFail(kind);
    if (!this.practice) this.hud.toast(kind);
    this.report(note, kind, 0, songTime, half, z);
    this.player.playWrongSound();
  }

  tick(now: number): void {
    const dt = this.lastNow ? Math.min((now - this.lastNow) / 1000, 0.1) : 0.016;
    this.lastNow = now;
    const p0 = performance.now();
    const state = this.tracker.update(now);
    const p1 = performance.now();
    this.onTracking?.(state, this.tracker.rawPoints);
    const swap = this.swapHands;

    for (const h of HANDS) {
      const s = state[swap ? (h === 'left' ? 'right' : 'left') : h];
      this.scene.setSaber(h, s.wrist, s.tip, s.visible);
      this.swing[h].push(now, s.tip, s.speed, s.visible);
      const sg = this.scene.getSaberSegment(h);
      const cs = this.curSeg[h];
      cs.a.x = sg.a.x; cs.a.y = sg.a.y; cs.a.z = sg.a.z; cs.b.x = sg.b.x; cs.b.y = sg.b.y; cs.b.z = sg.b.z;
    }
    this.hud.setHands(
      (swap ? state.right : state.left).visible,
      (swap ? state.left : state.right).visible,
    );
    const vis: Record<Hand, boolean> = {
      left: (swap ? state.right : state.left).visible,
      right: (swap ? state.left : state.right).visible,
    };
    for (const h of HANDS) {
      const c = this.curSeg[h], sc = this.scrCur[h];
      this.vA.set(c.a.x, c.a.y, c.a.z); this.scene.projectToScreen(this.vA, sc.a);
      this.vB.set(c.b.x, c.b.y, c.b.z); this.scene.projectToScreen(this.vB, sc.b);
    }

    if (this.running && this.beatmap) {
      const songTime = this.clock.getTime() + this.latencyOffset;
      const notes = this.beatmap.notes;
      this.practice?.ensure(songTime, notes, SPAWN_LEAD);
      while (this.nextNote < notes.length && notes[this.nextNote]!.time - songTime <= SPAWN_LEAD) {
        this.scene.spawnCube(notes[this.nextNote++]!);
      }

      const cubes = this.scene.getActiveCubes();
      for (let i = cubes.length - 1; i >= 0; i--) {
        const cube = cubes[i];
        if (!cube) continue;
        const note = cube.note;
        const err = songTime - note.time;
        cube.z = err * CUBE_SPEED; // z из того же songTime, что и dtMs (раньше читался z прошлого кадра: при просадке кадра dtMs расходился с z)
        const other: Hand = note.hand === 'left' ? 'right' : 'left';
        const sw = this.swing[note.hand];
        const inZone = cube.z >= HIT_Z_MIN && cube.z <= HIT_Z_MAX;
        const box = this.box;
        if (inZone && this.armFn && !this.armed.has(note.id)) { this.armed.add(note.id); this.armFn(note.id, true); }
        if (inZone) {
          this.scene.getCubeScreenBox(cube, box);
          box.minX -= SCREEN_HIT_PAD; box.minY -= SCREEN_HIT_PAD; box.maxX += SCREEN_HIT_PAD; box.maxY += SCREEN_HIT_PAD;
          const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
          const so = this.scrCur[note.hand], sx = this.scrCur[other];
          this.diag.observe(note, songTime, cube.z,
            { dist: distToSeg2(cx, cy, so.a, so.b), peak: sw.peakSpeed, swingDir: sw.swingDir, visible: vis[note.hand] },
            vis[other] ? distToSeg2(cx, cy, sx.a, sx.b) : Infinity);
        }
        if (inZone) {
          const order: Hand[] = [note.hand, other];
          for (const h of order) {
            const hs = this.swing[h];
            if (!vis[h] || hs.peakSpeed < SWING_SPEED_MIN_HIT) continue;
            const pv = this.prevSeg[h] ? this.scrPrev[h] : null;
            if (!sweepHitScreen(pv?.a ?? null, pv?.b ?? null, this.scrCur[h].a, this.scrCur[h].b, box)) continue;
            const judge = cube.z >= JUDGE_Z_MIN && hs.peakSpeed >= SWING_SPEED_MIN_HIT * WRONG_DIR_SPEED_MULT;
            if (h !== note.hand) {
              if (cube.z < JUDGE_Z_MIN) continue; // далеко: чужая рука игнорируется
              this.fail(note, 'wrongColor', true, songTime, cube.half, cube.z);
            }
            else if (note.dir !== 'any' && hs.angle !== null && !angleMatches(hs.angle, note.dir)
              && !hs.hadDirMatch(now, note.dir, SWING_SPEED_MIN_HIT, DIR_SECOND_CHANCE_MS)) {
              if (!judge || now - this.lastGood[h] < BACKSWING_MS) continue; // игнор: рано/слабо/обратный замах
              this.fail(note, 'wrongDir', true, songTime, cube.half, cube.z);
            } else {
              const sd = hs.angle !== null
                ? { x: Math.sin(hs.angle * Math.PI / 180), y: Math.cos(hs.angle * Math.PI / 180) }
                : sliceDirFromDir8(note.dir);
              this.scene.removeCube(note.id, 'good', sd);
              const timingErr = (cube.z - HIT_Z_PERFECT) / CUBE_SPEED; // с; + = поздно
              const pts = this.score.registerHit(timingErr * 1000);
              this.report(note, 'good', pts, songTime, cube.half, cube.z);
              fx.emit({ type: 'hit', hand: h, perfect: Math.abs(timingErr) < 0.06, x: cube.x, y: cube.y, z: cube.z });
              const tier = tierForCombo(this.score.combo);
              if (tier > this.prevTier) fx.emit({ type: 'tier', tier, combo: this.score.combo });
              this.prevTier = tier;
              this.hud.pulseScore();
              this.lastGood[h] = now;
              const errMs = Math.abs(timingErr * 1000);
              this.player.playHitSound(h, { combo: this.score.combo, perfect: errMs < 60, accuracyGrade: errMs < 60 ? 'perfect' : errMs < 120 ? 'good' : 'ok' });
            }
            break;
          }
        } else if (cube.z > HIT_Z_MAX) {
          this.scene.removeCube(note.id, 'miss');
          this.registerFail('miss');
          if (!this.practice) this.hud.toast('miss');
          this.report(note, 'miss', 0, songTime, cube.half, cube.z);
          if (now - this.lastMissSound > 150) { this.lastMissSound = now; this.player.playMissSound(); }
        }
      }
      this.scene.update(songTime, dt);
    } else {
      this.scene.update(this.clock.getTime(), dt);
    }
    for (const h of HANDS) {
      const ps = this.prevSeg[h];
      if (!vis[h]) { this.prevSeg[h] = null; continue; }
      const cs = this.curSeg[h];
      const sp = this.scrPrev[h], sc = this.scrCur[h];
      sp.a.x = sc.a.x; sp.a.y = sc.a.y; sp.b.x = sc.b.x; sp.b.y = sc.b.y;
      if (ps) { ps.a.x = cs.a.x; ps.a.y = cs.a.y; ps.a.z = cs.a.z; ps.b.x = cs.b.x; ps.b.y = cs.b.y; ps.b.z = cs.b.z; }
      else this.prevSeg[h] = { a: { ...cs.a }, b: { ...cs.b } };
    }
    fxState.combo = this.score.combo;
    fxState.tier = tierForCombo(this.score.combo);
    if (this.dimHold > 0) this.dimHold -= dt;
    else if (fxState.dim > 0) fxState.dim = Math.max(0, fxState.dim - dt / DIM_FADE);
    (this.player as unknown as FxPlayer).updateFx?.();
    const p2 = performance.now();
    this.scene.render();
    this.hud.update(this.score);
    const p3 = performance.now();
    const A = 0.1;
    this.pTrack += ((p1 - p0) - this.pTrack) * A;
    this.pScene += ((p2 - p1) - this.pScene) * A;
    this.pFrame += ((p3 - p0) - this.pFrame) * A;
    if (this.hud.statsVisible) this.hud.setStats(now, this.scene.getStats(), this.scene.getFps(), state, fxState.quality,
      { frame: this.pFrame, track: this.pTrack, scene: this.pScene }, this.swingInfo());
    (this.scene as unknown as AutoQualityScene).updateAutoQuality?.(now);
  }

  private swingInfo(): string {
    const f = (h: Hand): string => {
      const w = this.swing[h];
      return `v=${w.speed.toFixed(1)} pk=${w.peakSpeed.toFixed(1)} dir=${w.swingDir ?? '-'}`;
    };
    return `L: ${f('left')} | R: ${f('right')}`;
  }
}
