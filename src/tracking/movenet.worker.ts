import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-webgpu';
import { getThreadsCount, setThreadsCount, setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import * as poseDetection from '@tensorflow-models/pose-detection';
import {
  LOWLIGHT_GAMMA, LOWLIGHT_MODE, LUMA_EVERY_N, LUMA_LOW_OFF, LUMA_LOW_ON, POSE_INPUT_H, POSE_INPUT_W, POSE_MAX_FPS,
  POSE_MIN_POSE_SCORE, POSE_MODEL, POSE_PREP_MODE,
} from '../config';
import { MOVENET_POINTS, POSE_FLOATS } from './poseProtocol';
import type { Breakdown, FromWorker, MoveNetDelegate, PrepMode, ToWorker, VideoFrameLike } from './poseProtocol';

const g = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

type Backend = 'wasm' | 'webgl' | 'webgpu' | 'cpu';
let detector: poseDetection.PoseDetector | null = null;
let backend: Backend = 'cpu';
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let frameW = POSE_INPUT_W, frameH = POSE_INPUT_H;
let minGapMs = 1000 / POSE_MAX_FPS - 4;
let prepMode: PrepMode = POSE_PREP_MODE;
let pixBuf: Uint8Array | null = null; // буфер RGBA для режима 'pixels'
const outBuf = new Float32Array(POSE_FLOATS); // переиспользуется: postMessage копирует 96 байт
const bd: Breakdown = { read: 0, prep: 0, infer: 0, post: 0 };
let originDelta = 0; // timeOrigin воркера - timeOrigin главного потока: перевод времени в шкалу главного
let tsMode = 0;      // 0 = ещё не определено, 1 = frame.timestamp сопоставим с performance.now(), 2 = нет
let forceLow = false;
let camLastRecv = 0, camIntervalMs = 0; // скользящее среднее интервала прихода VideoFrame
let threads = 1;
let tsBase = Infinity, tsBaseAt = 0;
let lowLight = false, luma = 0, lumaCount = 0;
let lumaCtx: OffscreenCanvasRenderingContext2D | null = null;
const lut = new Uint8Array(256);
const hist = new Uint32Array(256);

/** Ошибки подворкеров emscripten (pthread) всплывают как error воркера: гасим и сигналим текущей попытке инициализации */
let onSubError: ((msg: string) => void) | null = null;
function subError(msg: string): void {
  if (onSubError) onSubError(msg);
  else console.warn('worker error (ignored):', msg);
}
self.addEventListener('error', (e) => { e.preventDefault(); subError(e.message || 'worker error'); });
self.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  const r = (e as PromiseRejectionEvent).reason as unknown;
  subError(r instanceof Error ? r.message : String(r));
});

const WASM_TIMEOUT_MS = 6000;

/** Инициализация бэкенда с таймаутом и перехватом ошибок подворкеров; проверочный прогон тензора ловит краш pthread */
async function tryBackend(b: Backend, timeoutMs: number): Promise<boolean> {
  let timer = 0;
  const guard = new Promise<never>((_, reject) => {
    timer = self.setTimeout(() => reject(new Error(`${b}: init timeout ${timeoutMs} ms`)), timeoutMs);
    onSubError = (m) => reject(new Error(`${b}: ${m}`));
  });
  try {
    await Promise.race([
      (async () => {
        if (!(await tf.setBackend(b))) throw new Error(`${b}: setBackend=false`);
        await tf.ready();
        const t = tf.tensor1d([1, 2, 3]);
        await tf.mul(t, t).data();
        t.dispose();
      })(),
      guard,
    ]);
    return true;
  } catch (err) {
    console.warn('backend failed:', err instanceof Error ? err.message : err);
    await drain();
    return false;
  } finally {
    clearTimeout(timer);
    onSubError = null;
  }
}

/** Пауза после неудачной попытки: запоздавшие ошибки уже убитых подворкеров не должны ронять следующую попытку */
const drain = (ms = 700): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Выбор бэкенда по приоритету; 'CPU' = wasm первым, 'GPU' = webgl первым, 'WEBGPU' = webgpu -> wasm -> cpu.
 *  wasm: сначала с потоками, при сбое/таймауте — однопоточный (SIMD); затем webgl, cpu. */
async function pickBackend(delegate: MoveNetDelegate, wasmUrl: string): Promise<Backend> {
  setWasmPaths(wasmUrl.endsWith('/') ? wasmUrl : wasmUrl + '/');
  const want = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
  const order: Backend[] = delegate === 'WEBGPU' ? ['webgpu', 'wasm', 'cpu']
    : delegate === 'GPU' ? ['webgl', 'wasm', 'cpu'] : ['wasm', 'webgl', 'cpu'];
  for (const b of order) {
    if (b === 'webgpu') {
      try {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        if (!gpu || !(await gpu.requestAdapter())) continue;
      } catch { continue; }
    }
    if (b === 'wasm') {
      const mt = await tf.env().getAsync('WASM_HAS_MULTITHREAD_SUPPORT');
      if (mt) {
        setThreadsCount(want);
        if (await tryBackend('wasm', WASM_TIMEOUT_MS)) { threads = getThreadsCount() || want; return 'wasm'; }
        tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false); // откат на однопоточный wasm
      }
      setThreadsCount(1);
      if (await tryBackend('wasm', WASM_TIMEOUT_MS)) { threads = 1; return 'wasm'; }
      continue;
    }
    if (await tryBackend(b, 15000)) { threads = 1; return b; }
  }
  throw new Error('нет доступного бэкенда tfjs');
}

/** Локальная модель, если файл реально JSON (dev-сервер на 404 отдаёт index.html); иначе модель по умолчанию */
async function pickModelUrl(url: string): Promise<string | undefined> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) return url;
  } catch { /* по умолчанию */ }
  return undefined;
}

async function init(msg: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  frameW = msg.frameW ?? POSE_INPUT_W; frameH = msg.frameH ?? POSE_INPUT_H;
  if (msg.maxFps) minGapMs = 1000 / msg.maxFps - 4;
  if (msg.prep) prepMode = msg.prep;
  forceLow = !!msg.forceLow; // для теста стоимости усиления
  if (msg.origin) originDelta = performance.timeOrigin - msg.origin;
  backend = await pickBackend(msg.delegate, msg.wasmUrl);
  g.postMessage({ type: 'backend', name: backend });
  canvas = new OffscreenCanvas(frameW, frameH);
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2d недоступен');
  const modelUrl = POSE_MODEL === 'lightning' ? await pickModelUrl(msg.modelUrl) : undefined; // локальная копия только lightning
  detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: POSE_MODEL === 'thunder'
      ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    enableSmoothing: false, // сглаживаем сами (One Euro)
    minPoseScore: POSE_MIN_POSE_SCORE,
    ...(modelUrl ? { modelUrl } : {}),
  });
  // прогрев: 3 холостых прогона на пустом кадре 256x192 (компиляция шейдеров/wasm до первого реального кадра)
  const warm = new OffscreenCanvas(256, 192);
  for (let i = 0; i < 3; i++) await detector.estimatePoses(warm as unknown as ImageData, { flipHorizontal: false });
  detector.reset();
  g.postMessage({ type: 'ready', delegate: backend === 'webgl' || backend === 'webgpu' ? 'GPU' : 'CPU', backend });
}

/** Инференс по любому поддерживаемому tfjs источнику; w/h — размер источника для нормализации. Возвращает общий outBuf */
async function infer(src: unknown, w: number, h: number): Promise<Float32Array> {
  const t0 = performance.now();
  // типы tfjs не знают OffscreenCanvas/ImageBitmap/{data,width,height}, рантайм их принимает
  const poses = await detector!.estimatePoses(src as ImageData, { flipHorizontal: false });
  const t1 = performance.now();
  bd.infer = t1 - t0;
  outBuf.fill(0);
  const kp = poses[0]?.keypoints;
  if (kp) {
    for (let i = 0; i < MOVENET_POINTS.length; i++) {
      const p = kp[MOVENET_POINTS[i]!];
      if (!p) continue;
      outBuf[i * 3] = p.x / w; outBuf[i * 3 + 1] = p.y / h; outBuf[i * 3 + 2] = p.score ?? 0;
    }
  }
  bd.post = performance.now() - t1;
  return outBuf;
}

function send(data: Float32Array, t: number, t0: number, age: number): void {
  const now = performance.now();
  g.postMessage({ type: 'result', data, t, ms: now - t0, bd, lat: age + (now - t0), threads, camFps: camIntervalMs > 0 ? 1000 / camIntervalMs : 0, luma, low: lowLight });
}

/** Средняя яркость по 32x24 копии кадра + гистерезис low-light; раз в LUMA_EVERY_N кадров, до frame.close() */
function updateLuma(frame: VideoFrameLike): void {
  if (!lumaCtx) lumaCtx = new OffscreenCanvas(32, 24).getContext('2d', { willReadFrequently: true });
  if (!lumaCtx) return;
  lumaCtx.drawImage(frame as unknown as CanvasImageSource, 0, 0, 32, 24);
  const d = lumaCtx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
  luma = sum / (d.length / 4);
  if (forceLow) lowLight = true;
  else if (lowLight ? luma > LUMA_LOW_OFF : luma < LUMA_LOW_ON) lowLight = !lowLight;
}

/** Растяжение контраста (перцентили 2-98%) + гамма через LUT, на месте */
function enhance(img: ImageData): void {
  const d = img.data, n = d.length;
  hist.fill(0);
  let cnt = 0;
  for (let i = 1; i < n; i += 16) { hist[d[i]!]!++; cnt++; } // зелёный канал, каждый 4-й пиксель
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= cnt * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc >= cnt * 0.02) { hi = v; break; } }
  if (hi - lo < 32) lo = Math.max(0, hi - 32);
  const k = 1 / (hi - lo);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(Math.min(1, Math.max(0, (v - lo) * k)), LOWLIGHT_GAMMA));
  for (let i = 0; i < n; i += 4) { d[i] = lut[d[i]!]!; d[i + 1] = lut[d[i + 1]!]!; d[i + 2] = lut[d[i + 2]!]!; }
}

/** Подготовка входа модели из VideoFrame; кадр закрывается здесь. Возвращает источник и его размер */
async function prep(frame: VideoFrameLike): Promise<{ src: unknown; w: number; h: number }> {
  try {
    if (++lumaCount >= LUMA_EVERY_N || luma === 0) { lumaCount = 0; updateLuma(frame); }
    if (lowLight) {
      // усиление идёт через canvas при любом режиме; ImageData уходит в модель напрямую
      const filt = LOWLIGHT_MODE === 'filter';
      if (filt) ctx!.filter = 'brightness(1.4) contrast(1.2)';
      ctx!.drawImage(frame as unknown as CanvasImageSource, 0, 0, frameW, frameH);
      if (filt) { ctx!.filter = 'none'; return { src: canvas, w: frameW, h: frameH }; }
      const img = ctx!.getImageData(0, 0, frameW, frameH);
      enhance(img);
      return { src: img, w: frameW, h: frameH };
    }
    if (prepMode === 'bitmap') {
      const bmp = await createImageBitmap(frame as unknown as ImageBitmapSource, {
        resizeWidth: frameW, resizeHeight: frameH, resizeQuality: 'low',
      });
      return { src: bmp, w: frameW, h: frameH };
    }
    if (prepMode === 'pixels') {
      const w = frame.displayWidth, h = frame.displayHeight;
      if (!pixBuf || pixBuf.length !== w * h * 4) pixBuf = new Uint8Array(w * h * 4);
      try {
        await frame.copyTo(pixBuf, { format: 'RGBA' });
        return { src: { data: pixBuf, width: w, height: h }, w, h };
      } catch { prepMode = 'canvas'; } // copyTo с конвертацией не поддержан -> drawImage
    }
    ctx!.drawImage(frame as unknown as CanvasImageSource, 0, 0, frameW, frameH);
    return { src: canvas, w: frameW, h: frameH };
  } finally { frame.close(); }
}

/**
 * Возраст кадра на момент получения, мс. Если timestamp сопоставим с performance.now() — абсолютный возраст
 * (захват -> воркер). Иначе (относительный timestamp) — превышение над лучшим наблюдавшимся запаздыванием
 * (скользящий минимум offset = tRecv - timestamp, с медленным дрейфом вверх): ловит очереди/задержку воркера,
 * постоянную часть задержки камеры добавляет CAMERA_LATENCY_MS на стороне трекера.
 */
function frameAge(frame: VideoFrameLike, tRecv: number): number {
  const off = tRecv - frame.timestamp / 1000;
  if (tsMode === 0) tsMode = Math.abs(off) < 2000 ? 1 : 2;
  if (tsMode === 1) return off >= 0 && off < 500 ? off : 0;
  if (tsBase === Infinity) { tsBase = off; tsBaseAt = tRecv; return 0; }
  tsBase += (tRecv - tsBaseAt) * 0.0005; tsBaseAt = tRecv; // дрейф 0.5 мс/с, чтобы минимум не «залипал»
  if (off < tsBase) tsBase = off;
  return Math.min(500, off - tsBase);
}

/**
 * Два независимых цикла. reader-loop непрерывно читает поток (maxBufferSize=1) и кладёт кадр в слот latest
 * (предыдущий там закрывается). inference-loop забирает latest немедленно, а если слота нет — ждёт сигнал.
 * Так read() не блокирует инференс: после цикла длиннее интервала камеры свежий кадр уже лежит в слоте.
 */
let latest: { frame: VideoFrameLike; tRecv: number; age: number } | null = null;
let wake: (() => void) | null = null;

async function readLoop(reader: ReadableStreamDefaultReader<VideoFrameLike>): Promise<void> {
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done) break;
    if (!frame) continue;
    const tRecv = performance.now();
    if (camLastRecv > 0) {
      const iv = tRecv - camLastRecv;
      if (iv < 1000) camIntervalMs = camIntervalMs === 0 ? iv : camIntervalMs + (iv - camIntervalMs) * 0.05;
    }
    camLastRecv = tRecv;
    latest?.frame.close(); // пропущенный кадр
    latest = { frame, tRecv, age: frameAge(frame, tRecv) };
    const w = wake; wake = null; w?.();
  }
  latest?.frame.close(); latest = null;
}

async function pump(readable: ReadableStream<VideoFrameLike>): Promise<void> {
  void readLoop(readable.getReader()).catch((err: unknown) => {
    g.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
  let lastStart = -Infinity;
  for (;;) {
    // ограничитель FPS — только если цикл быстрее 1000/POSE_MAX_FPS
    const gap = minGapMs - (performance.now() - lastStart);
    if (gap > 0) await new Promise<void>((r) => setTimeout(r, gap));
    const tr0 = performance.now();
    while (!latest || !detector || !ctx || !canvas) {
      if (latest && !detector) { latest.frame.close(); latest = null; } // воркер ещё не готов
      await new Promise<void>((r) => { wake = r; if (!detector) setTimeout(r, 50); });
    }
    const { frame, tRecv, age: age0 } = latest;
    latest = null;
    const t0 = performance.now();
    lastStart = t0;
    bd.read = t0 - tr0;
    const age = age0 + (t0 - tRecv);
    let item: { src: unknown; w: number; h: number };
    try {
      item = await prep(frame);
    } catch (err) {
      g.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      continue;
    }
    bd.prep = performance.now() - t0;
    try {
      const data = await infer(item.src, item.w, item.h);
      if (item.src instanceof ImageBitmap) item.src.close();
      send(data, t0 + originDelta - age, t0, age);
    } catch (err) {
      g.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
}

g.onmessage = (e) => {
  const msg = e.data;
  let p: Promise<void> = Promise.resolve();
  if (msg.type === 'init') p = init(msg);
  else if (msg.type === 'stream') p = pump(msg.readable);
  else if (msg.type === 'frame' && detector) {
    p = (async () => {
      const t0 = performance.now();
      const img = new ImageData(new Uint8ClampedArray(msg.buf), msg.w, msg.h);
      send(await infer(img, msg.w, msg.h), msg.t, t0, 0);
    })();
  }
  p.catch((err: unknown) => {
    g.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
};
