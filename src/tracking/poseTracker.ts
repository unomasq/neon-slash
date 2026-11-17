import type { Dir8, HandState, TrackingState } from '../types';
import {
  CAM_LOCK_FPS, CAM_MAX_EXPOSURE, CAM_CANDIDATES, CAM_PREFERRED, CAMERA_LATENCY_MS, FIELD, HAND_HOLD_MS, HAND_HOLD_TAU_MS, MAX_PREDICT_UNITS, POSE_DELEGATE, POSE_ENGINE, POSE_FRAME_H,
  POSE_FRAME_W, POSE_MAX_FPS, POSE_MODEL_URL, POSE_MOVENET_FRAME_H, POSE_MOVENET_FRAME_W,
  POSE_MOVENET_MODEL_URL, POSE_SCORE_OFF, POSE_SCORE_ON, POSE_SHIFT_ALPHA, SYNTH_MAX_MS, SYNTH_JOINT_MIN, FOREARM_ALPHA, FOREARM_EURO_BETA, FOREARM_EURO_MIN_CUTOFF, VEL_EMA_TAU_MS, VEL_DECAY_TAU_MS, BLEND_MS, POSE_SHOULDER_MIN,
  POSE_SHOULDER_Y, POSE_USEFUL_FRACTION, PREDICT_MAX_MS, PREDICT_MIN_MS, PREDICT_MS, SABER_LENGTH,
} from '../config';
import { OneEuroVec2 } from './oneEuro';
import { trackingInfo } from './trackingInfo';
import { SwingDetector } from './swing';
import { POSE_FLOATS, SLOT } from './poseProtocol';
import type { FromWorker, MoveNetDelegate, ToWorker, VideoFrameLike } from './poseProtocol';

const WASM_URL = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, self.location.href).href; // локально, воркер сам откатится на CDN
const TFJS_WASM_URL = `${import.meta.env.BASE_URL}tfjs-wasm/`;
const MOVENET_URL = `${import.meta.env.BASE_URL}${POSE_MOVENET_MODEL_URL.replace(/^\//, '')}`;
const MAX_AGE_MS = 100;       // не экстраполировать «возраст» данных дольше этого
const STREAM_WATCHDOG_MS = 3000; // нет результатов от потока VideoFrame -> откат на захват через canvas
const INFER_ALPHA = 0.2;
const FPS_ALPHA = 0.1;

/** Доп. сведения о взмахе (peakSpeed/swingDir) — для подключения в игровую логику */
export interface SwingInfo { peakSpeed: number; swingDir: Dir8 | null }

interface Internal {
  state: HandState;
  wristF: OneEuroVec2;
  dirF: OneEuroVec2;                               // One Euro направления предплечья (единичный вектор по компонентам)
  offX: number; offY: number; offT: number;        // смещение плавного перехода real<->synthetic (на момент offT)
  swing: SwingDetector;
  wasVisible: boolean;
  tracking: boolean;                               // гистерезис score: рука сейчас считается найденной
  dirX: number; dirY: number;                      // последнее направление локоть->запястье
  wx: number; wy: number; tx: number; ty: number; // последние фильтрованные wrist/tip (без смещения перехода)
  velX: number; velY: number; tvX: number; tvY: number; // EMA-скорость wrist и tip (для предсказания)
  wLastX: number; wLastY: number; tLastX: number; tLastY: number; wLastT: number; // последние выходные (с offset) точки
  prevSynth: boolean;
  forearmX: number; forearmY: number; hasForearm: boolean; // последний известный вектор локоть->запястье (игровые ед.)
  synthetic: boolean; synthSince: number;          // запястье достроено от локтя; t начала серии синтетики (0 = нет)
  detectedAt: number;                              // performance.now() получения последней детекции
}

function makeInternal(): Internal {
  return {
    state: {
      visible: false, wrist: { x: 0, y: 0 }, tip: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 }, speed: 0, direction: null, lastSeen: 0,
    },
    wristF: new OneEuroVec2(), dirF: new OneEuroVec2(FOREARM_EURO_MIN_CUTOFF, FOREARM_EURO_BETA),
    offX: 0, offY: 0, offT: 0, tvX: 0, tvY: 0, tLastX: 0, tLastY: 0, prevSynth: false, swing: new SwingDetector(), wasVisible: false, tracking: false, dirX: 0, dirY: 1,
    wx: 0, wy: 0, tx: 0, ty: 0, velX: 0, velY: 0, wLastX: 0, wLastY: 0, wLastT: 0, detectedAt: 0,
    forearmX: 0, forearmY: 0, hasForearm: false, synthetic: false, synthSince: 0,
  };
}

interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack; maxBufferSize?: number }): { readable: ReadableStream<VideoFrameLike> };
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export class HandTracker {
  private video: VideoWithRvfc | null = null;
  private stream: MediaStream | null = null;
  private clone: MediaStreamTrack | null = null;      // клон трека для MediaStreamTrackProcessor (превью не затрагивается)
  private useStream = false;                          // кадры идут из потока VideoFrame прямо в воркер
  private streamAt = 0;
  private capturing = false;                          // запущен цикл захвата через canvas
  private readonly movenet = POSE_ENGINE === 'movenet';
  private frameW = this.movenet ? POSE_MOVENET_FRAME_W : POSE_FRAME_W;
  private frameH = this.movenet ? POSE_MOVENET_FRAME_H : POSE_FRAME_H;
  private worker: Worker | null = null;
  private busy = false;
  private workerReady = false;
  private workerReadyAt = 0;
  private captureCtx: CanvasRenderingContext2D | null = null;
  private captureMs = 0;
  private stopped = false;
  private lastSend = -Infinity;
  private lastVideoTime = -1;
  private rvfcId = 0;
  private rafId = 0;
  private lastResultAt = 0;
  private shiftY = 0;
  private shiftInited = false;
  private predictMs = PREDICT_MS;
  private lockStarted = false;
  private lockTimer = 0;
  /** peakSpeed (ед/с за 150 мс) и swingDir (направление перемещения за 120 мс) по рукам; обновляется в update() */
  readonly swingInfo: { left: SwingInfo; right: SwingInfo } = {
    left: { peakSpeed: 0, swingDir: null }, right: { peakSpeed: 0, swingDir: null },
  };
  private left = makeInternal();
  private right = makeInternal();
  private raw = new Float32Array(POSE_FLOATS);
  private result: TrackingState = {
    left: this.left.state, right: this.right.state, fps: 0, ready: false,
    inferMs: 0, delegate: POSE_DELEGATE, detectFps: 0,
  };

  /** Последние сырые нормализованные точки (x,y,visibility для 8 слотов SLOT) — для отладочного оверлея */
  get rawPoints(): Float32Array { return this.raw; }

  async init(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    this.stopped = false;
    // resizeMode не задаём: драйвер отдаёт нативный режим без программного масштабирования
    const advanced = [{ exposureMode: 'continuous' }, { whiteBalanceMode: 'continuous' }] as unknown as MediaTrackConstraintSet[];
    this.stream = await this.openCamera(advanced);
    const track = this.stream.getVideoTracks()[0];
    if (track) {
      // отдельно от getUserMedia: часть драйверов принимает advanced только здесь; неподдерживаемое игнорируем
      try { await track.applyConstraints({ advanced }); } catch { /* не поддерживается */ }
      const st = track.getSettings();
      console.info('[cam] settings', JSON.stringify(st));
      console.info('[cam] capabilities', JSON.stringify(track.getCapabilities?.() ?? {}));
      trackingInfo.camera = `${st.width ?? '?'}x${st.height ?? '?'}@${Math.round(st.frameRate ?? 0)}`;
    }
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    if (video.readyState < 1) {
      await new Promise<void>((res) => video.addEventListener('loadedmetadata', () => res(), { once: true }));
    }
    await video.play();

    await this.startWorker(POSE_DELEGATE);
  }

  /** getUserMedia по CAM_CANDIDATES[CAM_PREFERRED]; exact frameRate при OverconstrainedError откатывается на ideal, затем на остальных кандидатов */
  private async openCamera(advanced: MediaTrackConstraintSet[]): Promise<MediaStream> {
    const first = CAM_CANDIDATES[Math.min(CAM_PREFERRED, CAM_CANDIDATES.length - 1)]!;
    const list = [first, ...CAM_CANDIDATES.filter((c) => c !== first)];
    let lastErr: unknown;
    for (const c of list) {
      const fr = c.frameRate;
      const tries: MediaTrackConstraints['frameRate'][] = typeof fr === 'object' && 'exact' in fr
        ? [fr, { ideal: fr.exact, min: 24 }] : [typeof fr === 'number' ? { ideal: fr, min: 24 } : fr];
      for (const frameRate of tries) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: c.width }, height: { ideal: c.height }, frameRate, facingMode: 'user', advanced },
            audio: false,
          });
        } catch (err) {
          lastErr = err;
          if (!(err instanceof DOMException && err.name === 'OverconstrainedError')) throw err;
          console.warn('[cam] OverconstrainedError', c.width, c.height, JSON.stringify(frameRate));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Режим «стабильные 30 fps». Часть UVC-камер в автоэкспозиции удлиняет выдержку (exposure_dynamic_framerate)
   * и падает с 30 до ~17 fps. Через 2 с после старта воркера смотрим реальный camFps: >= 27 — ничего не трогаем;
   * иначе ручная экспозиция с выдержкой <= CAM_MAX_EXPOSURE и автоподстройка по яркости кадра.
   * Единицы exposureTime в Chrome/V4L2 = 100 мкс (166 = 16.6 мс). Эвристика: если capabilities.exposureTime.max <= 1000,
   * шкала, вероятно, иная (напр. мс) и фиксированные 150 не годятся — лимит берём как 15% от максимума.
   */
  private startCamLock(): void {
    if (this.lockStarted) return;
    this.lockStarted = true;
    const ti = trackingInfo;
    const track = this.stream?.getVideoTracks()[0];
    if (!CAM_LOCK_FPS || !track) { ti.camLock = 'off'; return; }
    type Caps = { exposureMode?: string[]; exposureTime?: { min?: number; max?: number }; brightness?: { min?: number; max?: number } };
    const caps = (track.getCapabilities?.() ?? {}) as Caps;
    const expCap = caps.exposureTime, brCap = caps.brightness;
    if (!caps.exposureMode?.includes('manual') || !expCap) {
      ti.camLock = 'unsupported';
      console.info('[cam] lock', { result: 'unsupported', reason: 'no manual exposure' });
      return;
    }
    const apply = (c: Record<string, unknown>) => track.applyConstraints({ advanced: [c] } as MediaTrackConstraints);
    const emin = expCap.min ?? 1, emax = expCap.max ?? Infinity;
    const lim = emax <= 1000 ? emax * 0.15 : CAM_MAX_EXPOSURE;
    const clampE = (v: number) => Math.round(Math.min(emax, Math.max(emin, v)));
    const maxExp = clampE(lim);
    let exposure = 0, brightness = 0;
    const finish = (result: string) => console.info('[cam] lock', {
      result, camFps: Math.round(ti.camFps), exposure, brightness, luma: Math.round(ti.luma), maxExp,
    });
    const rollback = async (reason: string) => {
      try { await apply({ exposureMode: 'continuous' }); } catch { /* ignore */ }
      ti.camLock = 'unsupported'; ti.exposure = 0; ti.brightness = 0;
      finish('unsupported: ' + reason);
    };
    let lastTune = 0;
    const tune = async () => {
      if (this.stopped || ti.camLock !== 'locked') return;
      const now = performance.now();
      const luma = ti.luma;
      if (luma > 0 && now - lastTune >= 1000) {
        try {
          if (luma < 80) {
            if (exposure < maxExp) {
              exposure = clampE(Math.min(maxExp, Math.max(exposure + 1, exposure * 1.2)));
              await apply({ exposureTime: exposure });
              lastTune = now;
            } else if (brCap && brightness < 40 && brightness + 8 <= (brCap.max ?? 40)) {
              brightness += 8;
              await apply({ brightness });
              lastTune = now;
            }
          } else if (luma > 150) {
            if (brightness > 0) { brightness = Math.max(0, brightness - 8); await apply({ brightness }); }
            else { exposure = clampE(Math.max(30, exposure * 0.85)); await apply({ exposureTime: exposure }); }
            lastTune = now;
          }
          ti.exposure = exposure; ti.brightness = brightness;
        } catch { /* камера не приняла значение — оставляем как есть */ }
      }
      this.lockTimer = window.setTimeout(() => { void tune(); }, 1000);
    };
    this.lockTimer = window.setTimeout(async () => {
      if (this.stopped) return;
      if (ti.camFps >= 27) { ti.camLock = 'auto-ok'; finish('auto-ok'); return; }
      try {
        await apply({ exposureMode: 'manual' });
        const cur = (track.getSettings() as { exposureTime?: number }).exposureTime;
        exposure = emax <= 1000 ? maxExp : clampE(Math.min(cur || 166, CAM_MAX_EXPOSURE));
        await apply({ exposureTime: exposure });
      } catch {
        await rollback('applyConstraints failed');
        return;
      }
      ti.camLock = 'locked'; ti.exposure = exposure;
      this.lockTimer = window.setTimeout(async () => {
        if (this.stopped) return;
        if (ti.camFps < 24) { await rollback('fps not improved'); return; }
        finish('locked');
        void tune();
      }, 2000);
    }, 2000);
  }

  /** Запрошенный делегат */
  get delegate(): MoveNetDelegate { return this.requested; }
  /** Фактический бэкенд из ready.backend */
  get backend(): 'wasm' | 'webgl' | 'webgpu' | 'cpu' {
    const b = this.result.backend;
    if (b === 'wasm' || b === 'webgl' || b === 'webgpu' || b === 'cpu') return b;
    return (this.result.delegate ?? 'CPU') === 'GPU' ? 'webgl' : 'wasm';
  }
  private requested: MoveNetDelegate = POSE_DELEGATE;

  /** Время (performance.now()), когда воркер последний раз стал готов (старт трека / смена делегата) */
  get readyAt(): number { return this.workerReadyAt; }

  private startWorker(delegate: MoveNetDelegate): Promise<void> {
    this.requested = delegate;
    const worker = this.movenet
      ? new Worker(new URL('./movenet.worker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    this.busy = false;
    this.workerReady = false;
    this.useStream = false;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'ready') {
          this.result.delegate = m.delegate;
          this.result.backend = m.backend;
          this.workerReady = true;
          this.workerReadyAt = performance.now();
          this.result.ready = true;
          this.beginFeed();
          this.startCamLock();
          if (!settled) { settled = true; clearTimeout(initTimer); resolve(); }
        } else if (m.type === 'error') {
          if (!settled) { settled = true; clearTimeout(initTimer); reject(new Error(m.message)); }
          else { console.warn('pose worker:', m.message); this.busy = false; }
        } else if (m.type === 'result') this.onResult(m.data, m.t, m.ms, m);
      };
      // воркер сам откатывается (потоки -> один поток -> webgl -> cpu): до ready ждём его сообщение, а не режем сразу
      let initTimer: ReturnType<typeof setTimeout> | undefined;
      worker.onerror = (e) => {
        e.preventDefault();
        if (settled) console.warn('pose worker error:', e.message);
        else {
          console.warn('pose worker error during init (waiting for fallback):', e.message);
          initTimer ??= setTimeout(() => {
            if (!settled) { settled = true; reject(new Error('pose worker: no ready 8 s after error: ' + e.message)); }
          }, 8000);
        }
      };
      this.post({
        type: 'init', delegate: this.movenet || delegate !== 'WEBGPU' ? delegate : 'GPU', wasmUrl: this.movenet ? TFJS_WASM_URL : WASM_URL,
        modelUrl: this.movenet ? MOVENET_URL : POSE_MODEL_URL,
        origin: performance.timeOrigin, maxFps: POSE_MAX_FPS, frameW: this.frameW, frameH: this.frameH,
      });
    });
  }

  /** Источник кадров после готовности воркера: поток VideoFrame (MoveNet) или захват через canvas */
  private beginFeed(): void {
    this.clone?.stop(); this.clone = null;
    const MSTP = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
    const track = this.stream?.getVideoTracks()[0];
    if (this.movenet && MSTP && track && this.worker) {
      try {
        // главный поток ничего не читает: readable уходит в воркер; клон не мешает превью в <video>
        const clone = track.clone();
        const { readable } = new MSTP({ track: clone, maxBufferSize: 1 });
        this.worker.postMessage({ type: 'stream', readable } satisfies ToWorker, [readable]);
        this.clone = clone;
        this.useStream = true;
        this.streamAt = performance.now();
        return;
      } catch (err) {
        console.warn('MediaStreamTrackProcessor недоступен, захват через canvas:', err);
      }
    }
    this.startCapture();
  }

  private startCapture(): void {
    this.useStream = false;
    if (this.capturing) return;
    this.capturing = true;
    this.scheduleCapture();
  }

  /** Пересоздать воркер с другим делегатом; состояние рук сбрасывается */
  async setDelegate(delegate: MoveNetDelegate): Promise<void> {
    if (this.stopped || !this.video) return;
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.useStream = false;
    this.clone?.stop(); this.clone = null;
    this.left = makeInternal();
    this.right = makeInternal();
    this.result.left = this.left.state;
    this.result.right = this.right.state;
    this.result.inferMs = 0; this.result.detectFps = 0; this.result.fps = 0; this.result.latencyMs = 0; this.predictMs = PREDICT_MS;
    this.lastResultAt = 0;
    this.shiftInited = false;
    this.raw.fill(0);
    await this.startWorker(delegate);
  }

  update(now: number): TrackingState {
    if (this.useStream && now - this.streamAt > STREAM_WATCHDOG_MS && this.lastResultAt < this.streamAt) {
      console.warn('поток VideoFrame не выдаёт результатов, откат на захват через canvas');
      this.startCapture();
    }
    this.step(this.left, now);
    this.step(this.right, now);
    const si = this.swingInfo;
    si.left.peakSpeed = this.left.state.visible ? this.left.swing.peakSpeed : 0;
    si.left.swingDir = this.left.state.visible ? this.left.swing.swingDir : null;
    si.right.peakSpeed = this.right.state.visible ? this.right.swing.peakSpeed : 0;
    si.right.swingDir = this.right.state.visible ? this.right.swing.swingDir : null;
    return this.result;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.lockTimer);
    const v = this.video;
    if (v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.rvfcId);
    cancelAnimationFrame(this.rafId);
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.clone?.stop(); this.clone = null;
    this.useStream = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (v) v.srcObject = null;
    this.result.ready = false;
  }

  private post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  // ---- захват кадров ----

  private scheduleCapture(): void {
    const v = this.video;
    if (!v || this.stopped) { this.capturing = false; return; }
    if (v.requestVideoFrameCallback) {
      this.rvfcId = v.requestVideoFrameCallback(() => { this.capture(); this.scheduleCapture(); });
    } else {
      this.rafId = requestAnimationFrame(() => {
        if (v.currentTime !== this.lastVideoTime) this.capture();
        this.scheduleCapture();
      });
    }
  }

  private capture(): void {
    const v = this.video;
    if (!v || this.useStream || this.busy || !this.workerReady || v.readyState < 2) return; // воркер занят — пропускаем кадр, без очереди
    const t = performance.now();
    if (t - this.lastSend < 1000 / POSE_MAX_FPS - 2) return;
    if (!this.captureCtx) {
      const c = document.createElement('canvas');
      c.width = this.frameW; c.height = this.frameH;
      this.captureCtx = c.getContext('2d', { willReadFrequently: true });
      if (!this.captureCtx) return;
    }
    const ctx = this.captureCtx;
    this.lastSend = t;
    this.lastVideoTime = v.currentTime;
    ctx.drawImage(v, 0, 0, this.frameW, this.frameH);
    const img = ctx.getImageData(0, 0, this.frameW, this.frameH);
    const cm = performance.now() - t;
    this.captureMs = this.captureMs === 0 ? cm : this.captureMs + (cm - this.captureMs) * 0.1;
    this.result.captureMs = this.captureMs;
    this.busy = true;
    const buf = img.data.buffer as ArrayBuffer;
    this.post({ type: 'frame', w: this.frameW, h: this.frameH, buf, t }, [buf]);
  }

  // ---- обработка результата ----

  private onResult(data: Float32Array, t: number, ms: number, m: Extract<FromWorker, { type: 'result' }>): void {
    this.busy = false;
    this.raw.set(data);
    const now = performance.now();
    const r = this.result;
    r.inferMs = (r.inferMs ?? 0) === 0 ? ms : r.inferMs! + (ms - r.inferMs!) * INFER_ALPHA;
    if (this.lastResultAt > 0) {
      const inst = 1000 / Math.max(1, now - this.lastResultAt);
      r.detectFps = (r.detectFps ?? 0) + (inst - (r.detectFps ?? 0)) * FPS_ALPHA;
      r.fps = r.detectFps;
    }
    this.lastResultAt = now;
    // разбивка цикла воркера, задержка и яркость
    const bd = m.bd;
    if (bd) {
      const k = INFER_ALPHA, ti = trackingInfo;
      ti.read += (bd.read - ti.read) * k; ti.prep += (bd.prep - ti.prep) * k;
      ti.infer += (bd.infer - ti.infer) * k; ti.post += (bd.post - ti.post) * k;
    }
    if (m.lat !== undefined) {
      r.latencyMs = (r.latencyMs ?? 0) === 0 ? m.lat : r.latencyMs! + (m.lat - r.latencyMs!) * INFER_ALPHA;
      // задержка = возраст кадра при получении + время цикла воркера; камера/драйвер добавляют CAMERA_LATENCY_MS
      this.predictMs = Math.min(PREDICT_MAX_MS, Math.max(PREDICT_MIN_MS, r.latencyMs + CAMERA_LATENCY_MS));
    }
    if (m.threads) trackingInfo.threads = m.threads;
    if (m.camFps !== undefined) trackingInfo.camFps = m.camFps;
    if (m.luma !== undefined) { r.lumaMean = m.luma; trackingInfo.luma = m.luma; trackingInfo.lowLight = !!m.low; }

    const kx = (FIELD.xMax - FIELD.xMin) / POSE_USEFUL_FRACTION;
    const ky = (FIELD.yMax - FIELD.yMin) / POSE_USEFUL_FRACTION;

    // адаптивный сдвиг по y: уровень плеч -> POSE_SHOULDER_Y
    const sl = SLOT.shoulderL * 3, sr = SLOT.shoulderR * 3;
    if (data[sl + 2]! > POSE_SHOULDER_MIN && data[sr + 2]! > POSE_SHOULDER_MIN) {
      const rawY = (0.5 - (data[sl + 1]! + data[sr + 1]!) / 2) * ky;
      const target = POSE_SHOULDER_Y - rawY;
      if (!this.shiftInited) { this.shiftY = target; this.shiftInited = true; }
      else this.shiftY += (target - this.shiftY) * POSE_SHIFT_ALPHA;
    }

    this.applyHand(this.left, data, SLOT.shoulderL, SLOT.elbowL, SLOT.wristL, SLOT.indexL, t, now, kx, ky);
    this.applyHand(this.right, data, SLOT.shoulderR, SLOT.elbowR, SLOT.wristR, SLOT.indexR, t, now, kx, ky);
    trackingInfo.synthL = this.left.synthetic; trackingInfo.synthR = this.right.synthetic;
  }

  private applyHand(
    h: Internal, d: Float32Array, sh: number, elbow: number, wrist: number, index: number,
    t: number, now: number, kx: number, ky: number,
  ): void {
    const wi = wrist * 3, ei = elbow * 3, ii = index * 3;
    let wxn = d[wi]!, wyn = d[wi + 1]!;
    // гистерезис: появление при score >= ON, пропадание при < OFF
    const score = d[wi + 2]!;
    const real = (h.tracking ? score >= POSE_SCORE_OFF : score >= POSE_SCORE_ON) && wxn >= 0 && wxn <= 1 && wyn >= 0 && wyn <= 1;
    const gx = (nx: number) => (0.5 - nx) * kx;
    const gy = (ny: number) => (0.5 - ny) * ky + this.shiftY;
    let wx = 0, wy = 0, synth = false;
    if (real) {
      wx = gx(wxn); wy = gy(wyn);
    } else if (
      h.hasForearm && d[ei + 2]! >= SYNTH_JOINT_MIN && d[sh * 3 + 2]! >= SYNTH_JOINT_MIN &&
      (h.synthSince === 0 || t - h.synthSince <= SYNTH_MAX_MS)
    ) {
      // запястье потеряно (быстрый взмах), локоть и плечо видны: локоть + последнее известное предплечье
      wx = gx(d[ei]!) + h.forearmX; wy = gy(d[ei + 1]!) + h.forearmY;
      synth = true;
    }
    h.tracking = real || synth;
    h.synthetic = synth;
    if (real) h.synthSince = 0; else if (synth && h.synthSince === 0) h.synthSince = t; // по истечении лимита серия не возобновляется до реального запястья
    if (!h.tracking) return; // lastSeen не обновляем: дальше работает удержание HAND_HOLD_MS
    // появление руки (была invisible): фильтры и буфер скорости начинаем с текущей позиции
    if (!(h.state.lastSeen > 0 && now - h.state.lastSeen <= HAND_HOLD_MS)) {
      const g = Math.exp(-Math.max(0, now - h.detectedAt) / VEL_DECAY_TAU_MS); // скорость гасим, а не обнуляем
      h.wristF.reset(); h.dirF.reset(); h.swing.reset();
      h.velX *= g; h.velY *= g; h.tvX *= g; h.tvY *= g; h.wLastT = 0; h.offX = 0; h.offY = 0; h.prevSynth = synth;
    }
    if (synth) {
      const nx = 0.5 - wx / kx, ny = 0.5 - (wy - this.shiftY) / ky;
      const o = wrist === SLOT.wristL ? 0 : 2;
      trackingInfo.synthPts[o] = nx; trackingInfo.synthPts[o + 1] = ny;
    }

    // направление предплечья: при синтетическом запястье не обновляем; иначе сырой единичный вектор -> One Euro -> нормализация
    let dx = h.dirX, dy = h.dirY;
    if (!synth) {
      let rx = 0, ry = 0;
      if (d[ei + 2]! > POSE_SCORE_OFF) { rx = wx - gx(d[ei]!); ry = wy - gy(d[ei + 1]!); }
      else if (index !== wrist && d[ii + 2]! > POSE_SCORE_OFF) { rx = gx(d[ii]!) - wx; ry = gy(d[ii + 1]!) - wy; }
      const rl = Math.hypot(rx, ry);
      if (rl >= 1e-4) {
        if (real && d[ei + 2]! > POSE_SCORE_OFF) { // известное предплечье — только по хорошему запястью
          if (!h.hasForearm) { h.forearmX = rx; h.forearmY = ry; h.hasForearm = true; }
          else { h.forearmX += (rx - h.forearmX) * FOREARM_ALPHA; h.forearmY += (ry - h.forearmY) * FOREARM_ALPHA; }
        }
        const f = h.dirF.push(rx / rl, ry / rl, t);
        const fl = Math.hypot(f.x, f.y);
        if (fl >= 1e-4) { dx = f.x / fl; dy = f.y / fl; }
      }
    }
    if (Math.hypot(dx, dy) < 1e-4) { dx = 0; dy = 1; }
    h.dirX = dx; h.dirY = dy;

    // текущее смещение перехода (экспоненциально гаснет за BLEND_MS)
    const decayOff = (tn: number) => Math.exp(-Math.max(0, tn - h.offT) / BLEND_MS);
    let w: { x: number; y: number };
    if (synth !== h.prevSynth) {
      // смена источника: фильтр стартует с новой позиции, прежняя выходная позиция сохраняется в offset
      const k = decayOff(now);
      const px = h.wx + h.offX * k, py = h.wy + h.offY * k;
      h.wristF.reset();
      w = h.wristF.push(wx, wy, t);
      h.offX = px - w.x; h.offY = py - w.y;
    } else {
      const k = decayOff(now);
      h.offX *= k; h.offY *= k;
      w = h.wristF.push(wx, wy, t);
    }
    h.offT = now; h.prevSynth = synth;
    h.wx = w.x; h.wy = w.y;
    h.tx = w.x + dx * SABER_LENGTH; h.ty = w.y + dy * SABER_LENGTH;
    const ow = { x: h.wx + h.offX, y: h.wy + h.offY }, tp = { x: h.tx + h.offX, y: h.ty + h.offY };
    // EMA-скорость выходных точек по времени (tau VEL_EMA_TAU_MS), обновляется на каждой детекции
    if (h.wLastT > 0 && t > h.wLastT) {
      const dt = (t - h.wLastT) / 1000;
      const k = 1 - Math.exp(-dt * 1000 / VEL_EMA_TAU_MS);
      h.velX += ((ow.x - h.wLastX) / dt - h.velX) * k; h.velY += ((ow.y - h.wLastY) / dt - h.velY) * k;
      h.tvX += ((tp.x - h.tLastX) / dt - h.tvX) * k; h.tvY += ((tp.y - h.tLastY) / dt - h.tvY) * k;
    }
    h.wLastX = ow.x; h.wLastY = ow.y; h.tLastX = tp.x; h.tLastY = tp.y; h.wLastT = t;
    h.swing.push(tp, t);
    h.detectedAt = now;
    h.state.lastSeen = now;
  }

  private step(h: Internal, now: number): void {
    const s = h.state;
    const age = now - s.lastSeen;
    const visible = s.lastSeen > 0 && age <= HAND_HOLD_MS;
    if (!visible) {
      if (h.wasVisible) {
        h.wristF.reset(); h.dirF.reset(); h.swing.reset();
        h.wLastT = 0; h.tracking = false; // скорость не обнуляем: гасится при следующем появлении
      }
      h.wasVisible = false;
      s.visible = false; s.speed = 0; s.direction = null; s.velocity.x = 0; s.velocity.y = 0;
      return;
    }
    h.wasVisible = true;
    s.visible = true;
    // предсказание по отдельно сглаженной скорости; смещение ограничено MAX_PREDICT_UNITS (по модулю)
    const pred = (vx: number, vy: number, hz: number, out: { x: number; y: number }, bx: number, by: number) => {
      let px = vx * hz, py = vy * hz;
      const m = Math.hypot(px, py);
      if (m > MAX_PREDICT_UNITS) { px *= MAX_PREDICT_UNITS / m; py *= MAX_PREDICT_UNITS / m; }
      out.x = bx + px; out.y = by + py;
    };
    const ko = Math.exp(-Math.max(0, now - h.offT) / BLEND_MS);
    const ox = h.offX * ko, oy = h.offY * ko;
    const vx = h.swing.velocity.x, vy = h.swing.velocity.y;
    if (h.tracking) {
      const horizon = (Math.min(Math.max(now - h.detectedAt, 0), MAX_AGE_MS) + this.predictMs) / 1000;
      pred(h.tvX, h.tvY, horizon, s.tip, h.tx + ox, h.ty + oy);
      pred(h.velX, h.velY, horizon, s.wrist, h.wx + ox, h.wy + oy);
      s.velocity.x = vx; s.velocity.y = vy;
      s.speed = h.swing.speed; s.direction = h.swing.direction;
    } else {
      // удержание: скорость затухает экспоненциально, смещение = интеграл v*e^(-t/tau)
      const tau = HAND_HOLD_TAU_MS / 1000, ta = age / 1000;
      const shift = tau * (1 - Math.exp(-ta / tau)), k = Math.exp(-ta / tau);
      pred(h.tvX, h.tvY, shift, s.tip, h.tx + ox, h.ty + oy);
      pred(h.velX, h.velY, shift, s.wrist, h.wx + ox, h.wy + oy);
      s.velocity.x = vx * k; s.velocity.y = vy * k;
      s.speed = h.swing.speed * k; s.direction = h.swing.direction;
    }
  }
}
