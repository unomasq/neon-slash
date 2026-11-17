/** Константы логики удара (отдельно от config.ts). */
export const SWING_SPEED_MIN_HIT = 3.5;   // мин. пиковая скорость кончика за окно, ед./с
export const DIR_TOLERANCE_DEG = 75;      // допуск по углу направления
export const HIT_BOX_PAD = 0.45;          // запас вокруг куба
export const HIT_Z_MIN = -2.4;           // зона удара по z куба: good возможен от сюда
export const JUDGE_Z_MIN = -1.8;         // штрафы wrongDir/wrongColor только при z >= этого, раньше касание игнорируется
export const BACKSWING_MS = 250;         // после good рука не порождает wrongDir (обратный замах)
export const WRONG_DIR_SPEED_MULT = 1.3; // wrongDir только при peakSpeed >= SWING_SPEED_MIN_HIT * этого
export const DIR_SECOND_CHANCE_MS = 200; // второй шанс по мгновенному направлению
export const INST_DIR_MIN_STEP = 0.02;    // мин. смещение между кадрами для мгновенного угла, ед.
export const HIT_Z_MAX = 1.0;            // дальше — промах
export const HIT_Z_PERFECT = -1.3;       // естественная точка удара (середина лезвия), от неё бонус за точность
export const SABER_FORWARD = 0.85;       // доля длины лезвия вглубь сцены (-z)
export const SABER_TILT = 0.55;          // доля длины лезвия по направлению предплечья (xy)
export const SWING_HISTORY_MS = 250;      // история скорости/позиции
export const SWING_DIR_WINDOW = 120;      // окно направления, мс
export const SWING_DIR_MIN_PATH = 0.4;    // мин. путь для swingDir, ед.
export const DIAG_SUMMARY_EVERY = 10;
export const DIAG_LOG_SIZE = 200;
export const PRACTICE_INTERVAL_S = 2.0;
export const PRACTICE_MID_INTERVAL_S = 1.2;
export const PRACTICE_DIR_INTERVAL_S = 1.5;
export const PRACTICE_ANY_COUNT = 10;
export const PRACTICE_MID_COUNT = 10;
export const PRACTICE_FIRST_S = 3.0;
export const SCREEN_HIT_PAD = 0.02;    // доп. запас бокса куба в экранных единицах (NDC*aspect по x, NDC по y)
