export const GAME_NAME = 'Neon Slash';
export const TELEGRAM_URL = 'https://t.me/PLACEHOLDER';
export const SITE_URL = 'https://proj2-sigma-one.vercel.app';
export const YM_COUNTER_ID = '';           // ID Яндекс Метрики, пусто = только console.log
export const COLORS = { left: 0xff2d55, right: 0x2d8cff } as const;
export const HIT_WINDOW_MS = 180;          // ± окно по времени
export const CUBE_SPEED = 8;               // игровых единиц/сек по оси z
export const CUBE_SPAWN_Z = -24;
export const CUBE_MISS_Z = 2.5;            // пролетел дальше — промах
export const HIT_BOX_PAD = 0.3;            // запас bbox куба
export const SWING_SPEED_MAX = 25;         // скорость выше этого между детекциями = выброс (ед/с)
export const SWING_SPEED_MIN = 6;          // мин. скорость кончика для засчитанного взмаха
export const DIR_TOLERANCE_DEG = 60;
export const LANE_X = [-2.25, -0.75, 0.75, 2.25];
export const ROW_Y = [-1.2, 0, 1.2];
export const SABER_LENGTH = 2.2;
export const FIELD = { xMin: -4, xMax: 4, yMin: -2.5, yMax: 2.5 };
export const LATENCY_DEFAULT_MS = 100;         // компенсация задержки по умолчанию
// --- Трекинг (MoveNet / PoseLandmarker в воркере) ---
export const POSE_ENGINE: 'movenet' | 'mediapipe' = 'movenet'; // mediapipe = запасной воркер
export const POSE_DELEGATE: 'GPU' | 'CPU' = 'CPU';  // CPU = tfjs wasm (не грузит WebGL игры), GPU = tfjs webgl
export const POSE_MOVENET_MODEL_URL = '/models/movenet-lightning/model.json'; // локальная копия; нет файла -> модель по умолчанию (tfhub)
export const POSE_INPUT_W = 480;                    // вход estimatePoses (crop вокруг человека pose-detection ресайзит сам)
export const POSE_INPUT_H = 360;
export const POSE_MOVENET_FRAME_W = POSE_INPUT_W;   // кадр для MoveNet (в воркер и в fallback-захват)
export const POSE_MOVENET_FRAME_H = POSE_INPUT_H;
export const POSE_MODEL: 'lightning' | 'thunder' = 'lightning'; // thunder точнее, ~2x медленнее (грузится с tfhub)
export const LUMA_LOW_ON = 70;                      // средняя яркость < этого -> включаем усиление входа
export const LUMA_LOW_OFF = 90;                     // > этого -> выключаем
export const LOWLIGHT_GAMMA = 0.6;                  // гамма LUT при low-light
export const LOWLIGHT_MODE: 'lut' | 'filter' = 'lut'; // lut = ImageData+LUT+растяжение 2-98%, filter = ctx.filter brightness/contrast
export const LUMA_EVERY_N = 10;                     // считать яркость раз в N кадров
export const POSE_MIN_POSE_SCORE = 0.2;             // minPoseScore детектора MoveNet
export const POSE_SCORE_ON = 0.25;                  // запястье появляется при score >= этого
export const POSE_SCORE_OFF = 0.12;                 // пропадает при score < этого (гистерезис)
export const POSE_SHOULDER_MIN = 0.3;               // мин. score плеч для адаптивного сдвига по y
export const SYNTH_MAX_MS = 400;                   // сколько подряд держим синтетическое запястье (от локтя)
export const SYNTH_JOINT_MIN = 0.3;                 // мин. score локтя и плеча для достраивания запястья
export const FOREARM_ALPHA = 0.3;                   // сглаживание вектора предплечья
export const FOREARM_EURO_MIN_CUTOFF = 0.8;         // One Euro направления предплечья (по компонентам)
export const FOREARM_EURO_BETA = 0.2;
export const VEL_EMA_TAU_MS = 80;                   // сглаживание скорости для предсказания (по времени)
export const VEL_DECAY_TAU_MS = 100;                // затухание скорости при сбросе/потере (не обнуление)
export const BLEND_MS = 150;                        // плавный переход real<->synthetic запястье
export const SABER_SMOOTH_TAU_MS = 35;              // рендер: экспоненциальное сглаживание рукояти и кончика меча
export const HAND_HOLD_MS = 300;                    // после пропажи держим visible с затухающей экстраполяцией
export const HAND_HOLD_TAU_MS = 100;                // постоянная затухания скорости при удержании
export const MAX_PREDICT_UNITS = 1.0;               // потолок итогового предсказания, игровых единиц
export const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
export const POSE_TASKS_VERSION = '1.2.3';          // синхронно с @mediapipe/tasks-vision в package.json
export const POSE_FRAME_W = 320;
export const POSE_FRAME_H = 240;
export const POSE_MAX_FPS = 30;                     // потолок детекций/с (воркер пропускает лишние кадры)
export const POSE_VIS_MIN = 0.5;                    // порог visibility для запястья/локтя/указательного
export const POSE_USEFUL_FRACTION = 0.8;            // центральная часть кадра, растянутая на FIELD
export const POSE_SHOULDER_Y = 0.3;                 // целевой игровой y уровня плеч
export const POSE_SHIFT_ALPHA = 0.02;               // сглаживание адаптивного сдвига по y (на детекцию)
export const HAND_LOST_MS = 300;                    // потеря дольше -> visible=false
export const ONE_EURO_MIN_CUTOFF = 1.0;             // меньше = плавнее, но больше лаг
export const ONE_EURO_BETA = 0.4;                   // больше = меньше лаг при быстрых движениях
export const ONE_EURO_D_CUTOFF = 1;
export const PREDICT_MS = 80;                       // экстраполяция вперёд по умолчанию (пока нет замера latencyMs)
export const PREDICT_MIN_MS = 40;                   // predict = clamp(latencyMs + CAMERA_LATENCY_MS, MIN, MAX)
export const PREDICT_MAX_MS = 100;
export const CAMERA_LATENCY_MS = 40;                // неучтённая задержка камеры/драйвера до VideoFrame
export const POSE_PREP_MODE: 'canvas' | 'bitmap' | 'pixels' = 'pixels'; // подготовка входа модели: canvas = drawImage 256x192, bitmap = createImageBitmap(resize), pixels = VideoFrame.copyTo(RGBA)
export const SWING_WINDOW_MS = 100;                 // окно скорости по времени
export const SWING_MAX_WINDOW_MS = 150;             // максимум окна (и окно peakSpeed)
export const SWING_DIR_WINDOW_MS = 120;             // окно направления взмаха
export const SWING_DIR_MIN_PATH = 0.4;              // мин. перемещение за окно для swingDir, ед.

/** Кандидаты constraints камеры (frameRate может быть {exact: N} — при OverconstrainedError откат на ideal) */
export interface CamCandidate { width: number; height: number; frameRate: number | { exact: number } }
export const CAM_CANDIDATES: CamCandidate[] = [
  { width: 640, height: 480, frameRate: 30 },
  { width: 640, height: 360, frameRate: 30 },
  { width: 1280, height: 720, frameRate: 30 },
];
export const CAM_PREFERRED = 0;                    // индекс в CAM_CANDIDATES
/** Режим «стабильные 30 fps»: если в автоэкспозиции камера падает ниже CAM_LOCK_FPS_OK (долгая выдержка), переключаем на ручную с ограниченной выдержкой */
export const CAM_LOCK_FPS = true;
export const CAM_MAX_EXPOSURE = 150;               // макс. exposureTime в единицах V4L2 (100 мкс): 150 = 15 мс < 33 мс кадра
