import { YM_COUNTER_ID } from '../config';

export type AnalyticsEvent = 'game_start' | 'game_end' | 'share' | 'calibration_done' | 'custom_track';

type YmFn = (id: number, method: string, ...args: unknown[]) => void;
const w = window as unknown as { ym?: YmFn & { a?: unknown[][]; l?: number } };

const id = Number(YM_COUNTER_ID);
const enabled = !!YM_COUNTER_ID && Number.isFinite(id);

export function initAnalytics(): void {
  if (!enabled || w.ym) return;
  const ym = function (...args: unknown[]) { (ym.a = ym.a || []).push(args); } as unknown as YmFn & { a?: unknown[][]; l?: number };
  ym.l = Date.now();
  w.ym = ym;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(s);
  ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
}

export function track(event: AnalyticsEvent, params?: Record<string, string | number>): void {
  try {
    if (enabled && w.ym) w.ym(id, 'reachGoal', event, params);
    else console.debug('[analytics]', event, params);
  } catch { /* ignore */ }
}
