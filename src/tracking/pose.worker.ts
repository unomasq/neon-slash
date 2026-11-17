import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { POSE_TASKS_VERSION } from '../config';
import { POSE_FLOATS, POSE_POINTS } from './poseProtocol';
import type { FromWorker, PoseDelegate, ToWorker } from './poseProtocol';

/**
 * tasks-vision 1.2.3 поддерживает опцию `canvas: OffscreenCanvas` (VisionTaskOptions.canvas),
 * поэтому GPU-делегат в воркере возможен.
 * Загрузчик wasm зовёт importScripts(), которого нет в module-воркере (иначе он лезет в document).
 * Шим ниже: синхронный XHR + глобальный eval скрипта (он определяет глобальную ModuleFactory).
 */
const g = self as unknown as {
  importScripts?: (...urls: string[]) => void;
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};
// В module-воркере importScripts ОПРЕДЕЛЁН, но бросает TypeError -> загрузчик падает в
// `import(url)`, где `var ModuleFactory` остаётся локальной в модуле. Поэтому подменяем безусловно.
g.importScripts = (...urls: string[]) => {
  for (const url of urls) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status !== 200) throw new Error(`importScripts failed: ${url} (${xhr.status})`);
    const code = xhr.responseText;
    const gl = globalThis as unknown as Record<string, unknown>;
    (0, eval)(code + `\n//# sourceURL=${url}`);
    if (!gl.ModuleFactory && /\bvar\s+ModuleFactory\b/.test(code)) {
      new Function(code + ';self.ModuleFactory = ModuleFactory;')();
    }
  }
};

const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${POSE_TASKS_VERSION}/wasm`;

/** Локальный путь, если там реально JS (dev-сервер на 404 может отдать index.html), иначе CDN */
async function pickWasmBase(url: string): Promise<string> {
  try {
    const r = await fetch(`${url}/vision_wasm_internal.js`);
    if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) return url;
  } catch { /* fallback */ }
  return CDN_WASM;
}

let landmarker: PoseLandmarker | null = null;
let delegate: PoseDelegate = 'CPU';
let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
let modelUrl = '';
let lastTs = 0;

function make(d: PoseDelegate): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions(fileset!, {
    baseOptions: { modelAssetPath: modelUrl, delegate: d },
    ...(d === 'GPU' ? { canvas: new OffscreenCanvas(1, 1) } : {}),
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

async function init(msg: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  modelUrl = msg.modelUrl;
  fileset = await FilesetResolver.forVisionTasks(await pickWasmBase(msg.wasmUrl));
  if (msg.delegate === 'GPU') {
    try { landmarker = await make('GPU'); delegate = 'GPU'; }
    catch { landmarker = await make('CPU'); delegate = 'CPU'; }
  } else {
    landmarker = await make('CPU'); delegate = 'CPU';
  }
  g.postMessage({ type: 'ready', delegate });
}

function run(img: ImageData, t: number): Float32Array {
  lastTs = Math.max(lastTs + 1, Math.round(t));
  const res = landmarker!.detectForVideo(img, lastTs);
  const out = new Float32Array(POSE_FLOATS);
  const lm = res.landmarks[0];
  if (lm) {
    for (let i = 0; i < POSE_POINTS.length; i++) {
      const p = lm[POSE_POINTS[i]!];
      if (!p) continue;
      out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.visibility ?? 0;
    }
  }
  return out;
}

async function frame(msg: Extract<ToWorker, { type: 'frame' }>): Promise<void> {
  const t0 = performance.now();
  const img = new ImageData(new Uint8ClampedArray(msg.buf), msg.w, msg.h);
  let data: Float32Array;
  try {
    data = run(img, msg.t);
  } catch (err) {
    if (delegate !== 'GPU') throw err;
    // сбой GPU во время работы -> пересоздаём на CPU и повторяем
    try { landmarker?.close(); } catch { /* ignore */ }
    landmarker = await make('CPU'); delegate = 'CPU';
    g.postMessage({ type: 'ready', delegate });
    data = run(img, msg.t);
  }
  g.postMessage({ type: 'result', data, t: msg.t, ms: performance.now() - t0 }, [data.buffer]);
}

g.onmessage = (e) => {
  const msg = e.data;
  const p = msg.type === 'init' ? init(msg) : landmarker && msg.type === 'frame' ? frame(msg) : Promise.resolve();
  p.catch((err: unknown) => {
    g.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
};
