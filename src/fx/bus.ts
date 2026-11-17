import type { Hand } from '../types';

/** Уровень комбо: 0 — база, 1 — ×10, 2 — ×25, 3 — ×50 */
export type ComboTier = 0 | 1 | 2 | 3;

export type FxEvent =
  | { type: 'beat'; strength: number; downbeat: boolean }   // удар бочки/доли (из паттерна или анализа)
  | { type: 'drop' }                                         // начало дропа/припева
  | { type: 'hit'; hand: Hand; perfect: boolean; x: number; y: number; z: number }
  | { type: 'miss' }
  | { type: 'wrong' }
  | { type: 'tier'; tier: ComboTier; combo: number }         // переход на новый уровень комбо
  | { type: 'comboBreak'; lost: number }
  | { type: 'introStart'; duration: number }
  | { type: 'trackStart' };

export type FxType = FxEvent['type'];
type Handler<T extends FxType> = (e: Extract<FxEvent, { type: T }>) => void;

const handlers: { [K in FxType]?: Handler<K>[] } = {};

export const fx = {
  on<T extends FxType>(type: T, cb: Handler<T>): () => void {
    const list = (handlers[type] ??= []) as Handler<T>[];
    list.push(cb);
    return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); };
  },
  emit(e: FxEvent): void {
    const list = handlers[e.type] as Handler<FxType>[] | undefined;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try { (list[i] as (ev: FxEvent) => void)(e); } catch (err) { console.warn('[fx]', err); }
    }
  },
};

/** Непрерывное состояние, обновляется каждый кадр; читают все. */
export interface FxState {
  bass: number;        // 0..1, сглаженная энергия баса (атака быстрая, спад ~150 мс)
  energy: number;      // 0..1, общая громкость
  beatPulse: number;   // 0..1, импульс последнего удара, спадает экспоненциально (~180 мс)
  tier: ComboTier;
  combo: number;
  dim: number;         // 0..1, затемнение сцены после промаха
  hitstop: number;     // секунд визуальной задержки, которую надо «догнать»
  quality: 0 | 1 | 2 | 3;
  intro: number;       // 0..1 прогресс вступления, 1 = игра
}
export const fxState: FxState = { bass: 0, energy: 0, beatPulse: 0, tier: 0, combo: 0, dim: 0, hitstop: 0, quality: 2, intro: 1 };

export function tierForCombo(c: number): ComboTier { return c >= 50 ? 3 : c >= 25 ? 2 : c >= 10 ? 1 : 0; }
