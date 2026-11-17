/** Индексы landmarks Pose, которые пересылаем из воркера (порядок = порядок в Float32Array) */
export const POSE_POINTS = [11, 12, 13, 14, 15, 16, 19, 20] as const;
/** Позиции в плоском массиве: слот * 3 -> x, y, visibility(score) */
export const SLOT = { shoulderL: 0, shoulderR: 1, elbowL: 2, elbowR: 3, wristL: 4, wristR: 5, indexL: 6, indexR: 7 } as const;
export const POSE_FLOATS = POSE_POINTS.length * 3;
/** Индексы COCO-17 (MoveNet) для слотов SLOT; вместо указательных повторяем запястья */
export const MOVENET_POINTS = [5, 6, 7, 8, 9, 10, 9, 10] as const;

export type PoseDelegate = 'GPU' | 'CPU';
/** Делегат воркера MoveNet: PoseDelegate + 'WEBGPU' (webgpu -> wasm -> cpu) */
export type MoveNetDelegate = PoseDelegate | 'WEBGPU';

/** Минимальные типы WebCodecs / insertable streams (нет в lib.dom используемой версии TS) */
export interface VideoFrameLike {
  close(): void; readonly displayWidth: number; readonly displayHeight: number; readonly timestamp: number;
  copyTo(dst: AllowSharedBufferSource, opts?: { format?: string }): Promise<unknown>;
}
export type PrepMode = 'canvas' | 'bitmap' | 'pixels';
/** Разбивка времени цикла воркера, мс */
export interface Breakdown { read: number; prep: number; infer: number; post: number }

export type ToWorker =
  | { type: 'init'; delegate: MoveNetDelegate; wasmUrl: string; modelUrl: string; origin?: number; maxFps?: number; frameW?: number; frameH?: number; prep?: PrepMode; forceLow?: boolean }
  | { type: 'frame'; w: number; h: number; buf: ArrayBuffer; t: number }
  /** Поток VideoFrame из MediaStreamTrackProcessor (только воркер MoveNet) */
  | { type: 'stream'; readable: ReadableStream<VideoFrameLike> };

export type FromWorker =
  | { type: 'backend'; name: string }
  | { type: 'ready'; delegate: PoseDelegate; backend?: string }
  | { type: 'result'; data: Float32Array; t: number; ms: number; bd?: Breakdown; lat?: number; threads?: number; luma?: number; low?: boolean; camFps?: number }
  | { type: 'error'; message: string };
