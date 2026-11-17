export type Hand = 'left' | 'right';
/** 0=вверх, 1=вверх-вправо, 2=вправо, 3=вниз-вправо, 4=вниз, 5=вниз-влево, 6=влево, 7=вверх-влево, 'any'=любое */
export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 'any';
export interface Vec2 { x: number; y: number }
/** Игровые координаты: x от -4 (слева от игрока) до 4 (справа), y от -2.5 (низ) до 2.5 (верх), плоскость z=0. Уже зеркалированы, т.е. левая рука игрока имеет x<0. */
export interface HandState {
  visible: boolean;
  wrist: Vec2;
  tip: Vec2;
  velocity: Vec2;       // скорость кончика, игровых единиц в секунду
  speed: number;        // модуль velocity
  direction: Dir8 | null; // null если speed ниже порога
  lastSeen: number;     // performance.now() последнего обнаружения
}
export interface TrackingState {
  left: HandState; right: HandState; fps: number; ready: boolean;
  inferMs?: number;               // сглаженное время инференса, мс
  delegate?: 'GPU' | 'CPU';       // фактический делегат модели
  detectFps?: number;             // частота детекций в секунду
  backend?: string;               // tfjs-бэкенд воркера: wasm | webgl | cpu (для MoveNet)
  latencyMs?: number;             // сглаженная задержка захват->результат, мс
  lumaMean?: number;              // средняя яркость кадра 0..255
  captureMs?: number;            // сглаженное время drawImage+getImageData на главном потоке, мс
}
export interface Note {
  id: number;
  time: number;   // секунды от начала трека, момент пересечения плоскости z=0
  hand: Hand;
  dir: Dir8;
  lane: number;   // 0..3 слева направо
  row: number;    // 0..2 снизу вверх
}
export interface Beatmap { notes: Note[]; duration: number; bpm: number }
export type Difficulty = 'easy' | 'normal' | 'hard';
export type HitKind = 'good' | 'wrongColor' | 'wrongDir' | 'miss';
