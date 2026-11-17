import { INTRO_SEC, TrackPlayer, analyzeAudio, decodeAudioData, makeCustomTrackDef, type TrackDef } from '../audio';
import { POSE_DELEGATE } from '../config';
import { GameEngine } from '../game';
import { fx } from '../fx/bus';
import { setDiagLogging } from '../game/diag';
import { getCalibrationMs, getSetting, saveBest, setCalibrationMs, setSetting } from '../game/storage';
import { GameScene } from '../scene';
import { HandTracker, TrackingDebugView } from '../tracking';
import type { Difficulty } from '../types';
import { track as logEvent } from './analytics';
import { Hud } from './hud';
import { PositioningScreen } from './positioning';
import type { ResultData } from './resultCard';
import { TRACKS } from '../audio/tracks';
import { CalibrationScreen } from './screens/calibrationScreen';
import { CameraScreen } from './screens/camera';
import { GameScreen } from './screens/game';
import { MainScreen } from './screens/main';
import { ResultScreen } from './screens/result';
import { SelectScreen } from './screens/select';

export type Screen = 'main' | 'camera' | 'positioning' | 'calibration' | 'select' | 'game' | 'result';
export type Intent = 'play' | 'practice' | 'calibrate';
type Delegate = 'GPU' | 'CPU' | 'WEBGPU';

function cameraMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'Нет доступа к камере. Разреши камеру в адресной строке браузера и нажми «Попробовать снова»';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камера не найдена. Подключи камеру и попробуй снова';
  if (name === 'NotReadableError') return 'Камера занята другим приложением. Закрой его и попробуй снова';
  return 'Не удалось запустить камеру или загрузить модель. Проверь интернет и попробуй снова';
}

interface Shown { show(): void; hide(): void }

export class App {
  readonly hud = new Hud();
  readonly player = new TrackPlayer();
  readonly video = document.getElementById('cam') as HTMLVideoElement;
  readonly dbg = new TrackingDebugView();
  readonly positioning = new PositioningScreen();
  readonly scene: GameScene;
  tracker: HandTracker | null = null;
  engine: GameEngine | null = null;
  screen: Screen = 'main';
  intent: Intent = 'play';
  paused = false;
  swapHands = getSetting<boolean>('swapHands', false);
  delegate = getSetting<Delegate>('delegate', POSE_DELEGATE);
  selection: { track: TrackDef; difficulty: Difficulty; practice: boolean } = {
    track: TRACKS[0]!, difficulty: getSetting<Difficulty>('difficulty', 'normal'), practice: false,
  };

  private devTrack: Promise<TrackDef> | null = null;

  /** Только dev: локальный тестовый mp3 с dev-сервера; результат кэшируется */
  loadDevTrack(onProgress: (p: number) => void): Promise<TrackDef> {
    if (!import.meta.env.DEV) return Promise.reject(new Error('dev only'));
    if (!this.devTrack) {
      this.devTrack = (async () => {
        const file = 'imagine-dragons-jid-arcane-league-of-legends-enemy-(meloua.com).mp3';
        const res = await fetch('/' + encodeURIComponent(file));
        if (!res.ok) throw new Error('fetch ' + res.status);
        const blob = await res.blob();
        const buf = await decodeAudioData(await blob.arrayBuffer());
        const analysis = await analyzeAudio(buf, onProgress);
        logEvent('custom_track', { bpm: Math.round(analysis.bpm), duration: Math.round(analysis.duration) });
        return makeCustomTrackDef(blob, 'Enemy (тест)', analysis, buf);
      })();
      this.devTrack.catch(() => { this.devTrack = null; });
    }
    return this.devTrack;
  }

  private trackerReady = false;
  private positioned = false;
  private switching = false;
  private loading = false;
  private lastT = 0;
  private statusEl = document.getElementById('status') as HTMLElement;
  private main = new MainScreen(this);
  private camera = new CameraScreen(this);
  private calibration = new CalibrationScreen(this);
  private select = new SelectScreen(this);
  private game = new GameScreen(this);
  private result = new ResultScreen(this);
  private screens: Partial<Record<Screen, Shown>> = {
    main: this.main, camera: this.camera, calibration: this.calibration, select: this.select, game: this.game, result: this.result,
  };

  constructor() {
    this.scene = new GameScene(document.getElementById('scene')!);
    this.dbg.attach(this.video);
    this.hud.onResult = () => { /* результат собирает finishGame по player.onEnd */ };
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.go('main');
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---- навигация ----
  go(s: Screen): void {
    this.screens[this.screen]?.hide();
    if (this.screen === 'positioning') this.positioning.hide();
    if (this.screen === 'game' && s !== 'game') {
      this.engine?.stop();
      this.paused = false;
    }
    this.screen = s;
    this.hud.setVisible(s === 'game');
    if (s === 'positioning' && this.tracker) {
      this.positioning.show(this.tracker, () => { this.positioned = true; this.proceed(); }, this.video, () => this.go('main'));
    } else {
      this.screens[s]?.show();
    }
  }

  async begin(intent: Intent): Promise<void> {
    this.intent = intent;
    if (this.trackerReady) { this.afterCamera(); return; }
    this.go('camera');
    let granted = false;
    try {
      granted = (await navigator.permissions.query({ name: 'camera' as PermissionName })).state === 'granted';
    } catch { /* нет Permissions API */ }
    if (granted && this.screen === 'camera') void this.camera.connect();
  }

  /** Возвращает текст ошибки или null при успехе */
  async initCamera(): Promise<string | null> {
    this.tracker?.stop();
    const tr = new HandTracker();
    try {
      await tr.init(this.video);
    } catch (err) {
      console.error(err);
      tr.stop();
      return cameraMessage(err);
    }
    this.tracker = tr;
    this.trackerReady = true;
    if (this.delegate !== tr.delegate) void tr.setDelegate(this.delegate).catch((e) => console.error(e));
    if (this.screen === 'camera') this.afterCamera();
    return null;
  }

  private afterCamera(): void {
    if (this.positioned) this.proceed(); else this.go('positioning');
  }

  private proceed(): void {
    if (this.intent === 'calibrate') this.go('calibration');
    else if (this.intent === 'practice') void this.startGame();
    else this.go(getCalibrationMs() === null ? 'calibration' : 'select');
  }

  calibrationDone(ms: number): void {
    setCalibrationMs(ms);
    this.applyLatency();
    logEvent('calibration_done', { ms });
    this.go(this.intent === 'calibrate' ? 'main' : 'select');
  }

  calibrationSkip(): void { this.go(this.intent === 'calibrate' ? 'main' : 'select'); }

  // ---- настройки ----
  setSwapHands(v: boolean): void {
    this.swapHands = v;
    setSetting('swapHands', v);
    if (this.engine) this.engine.swapHands = v;
  }

  async setDelegate(d: Delegate): Promise<void> {
    this.delegate = d;
    setSetting('delegate', d);
    if (!this.tracker || !this.trackerReady || this.switching) return;
    this.switching = true;
    try { await this.tracker.setDelegate(d); this.delegate = this.tracker.delegate; } catch (e) { console.error(e); } finally { this.switching = false; }
  }

  setDifficulty(d: Difficulty): void {
    this.selection.difficulty = d;
    setSetting('difficulty', d);
  }

  private applyLatency(): void {
    const ms = getCalibrationMs();
    if (this.engine && ms !== null) this.engine.latencyOffset = ms / 1000;
  }

  setStatus(text: string | null): void {
    this.statusEl.textContent = text ?? '';
    this.statusEl.hidden = text === null;
  }

  // ---- игра ----
  private ensureEngine(): GameEngine {
    if (!this.engine) {
      const eng = new GameEngine(this.scene, this.player, this.tracker!, this.hud);
      eng.onTracking = (state, raw) => { if (this.dbg.visible) this.dbg.draw(state, raw); };
      this.player.onEnd(() => {
        if (this.screen === 'game' && !this.selection.practice) this.finishGame();
      });
      this.engine = eng;
    }
    return this.engine;
  }

  async startGame(): Promise<void> {
    if (this.loading || !this.tracker) return;
    this.loading = true;
    const { track, difficulty, practice } = this.selection;
    try {
      if (!practice) {
        this.setStatus('Загружаю трек…');
        await this.player.load(track);
      }
      const eng = this.ensureEngine();
      eng.swapHands = this.swapHands;
      this.applyLatency();
      this.paused = false;
      this.go('game');
      if (practice) eng.startPractice();
      else {
        eng.startTrack(track, difficulty); // player.start берёт leadIn = max(arg, INTRO_SEC)
        fx.emit({ type: 'introStart', duration: INTRO_SEC });
      }
      logEvent('game_start', { track: practice ? 'practice' : track.id, difficulty });
    } catch (e) {
      console.error(e);
      this.hud.toastText('Не удалось запустить игру');
    } finally {
      this.setStatus(null);
      this.loading = false;
    }
  }

  private finishGame(): void {
    const s = this.engine!.score;
    const { track, difficulty } = this.selection;
    const isRecord = track.id !== 'custom' && s.score > 0 && saveBest(track.id, difficulty, {
      score: s.score, accuracy: s.accuracy, maxCombo: s.maxCombo, date: new Date().toISOString(),
    });
    const data: ResultData = {
      trackName: track.name,
      trackSubtitle: track.subtitle,
      difficulty, score: s.score, accuracy: s.accuracy, maxCombo: s.maxCombo, isRecord, date: new Date(),
    };
    logEvent('game_end', { score: s.score, accuracy: Math.round(s.accuracy * 100) / 100 });
    this.result.setData(data);
    this.go('result');
  }

  setPaused(p: boolean): void {
    if (this.screen !== 'game' || this.paused === p) return;
    this.paused = p;
    if (this.selection.practice) this.engine?.setPracticePaused(p);
    else if (p) this.player.pause(); else this.player.resume();
    this.game.setPaused(p);
  }

  exitGame(): void {
    this.go(this.selection.practice ? 'main' : 'select');
  }

  // ---- ввод и цикл ----
  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      if (this.screen === 'game') {
        this.setPaused(!this.paused);
      } else if (this.screen !== 'main') this.go('main');
    }
    if (e.code === 'KeyD') { this.hud.toggleFps(); setDiagLogging(this.hud.statsVisible); }
    if (e.code === 'KeyC') this.dbg.toggle();
    if (e.code === 'KeyG' && this.tracker && this.engine && !this.switching) {
      const next: Delegate = this.delegate === 'CPU' ? 'GPU' : this.delegate === 'GPU' ? 'WEBGPU' : 'CPU';
      this.hud.toastText(`Трекинг: ${next}…`);
      void this.setDelegate(next).then(() => {
        const b = this.tracker?.backend;
        this.hud.toastText(next === 'WEBGPU' && b !== 'webgpu' ? `WebGPU недоступен, ${b}` : `Трекинг: ${b}`);
      });
    }
  }

  private demo(t: number, dt: number): void {
    const s = t / 1000;
    const sab = (hand: 'left' | 'right', k: number): void => {
      const a = Math.sin(s * 1.1 + k) * 0.7;
      const wx = k * 1.6 + Math.sin(s * 0.8 + k) * 0.4;
      const wy = -0.3 + Math.cos(s * 0.9 + k) * 0.3;
      this.scene.setSaber(hand, { x: wx, y: wy }, { x: wx + Math.sin(a) * 0.5, y: wy + Math.cos(a) * 0.5 }, true);
    };
    sab('left', -1);
    sab('right', 1);
    this.scene.update(s, dt);
    this.scene.render();
  }

  private loop(t: number): void {
    const dt = this.lastT ? Math.min((t - this.lastT) / 1000, 0.1) : 0.016;
    this.lastT = t;
    try {
      if (this.screen === 'game') {
        if (this.engine && !this.paused) { this.engine.tick(t); this.game.tick(); }
        else this.scene.render();
      } else {
        const st = this.trackerReady && this.tracker ? this.tracker.update(t) : null;
        if (this.screen === 'positioning' && st) this.positioning.tick(t, st);
        else if (this.screen === 'calibration') this.calibration.tick(t);
        this.demo(t, dt);
      }
    } catch (e) { console.error(e); }
    requestAnimationFrame((n) => this.loop(n));
  }
}
