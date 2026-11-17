import type { Dir8, Hand, HitKind, Note } from '../types';
import { CUBE_SPEED } from '../config';
import { DIAG_LOG_SIZE, DIAG_SUMMARY_EVERY, HIT_Z_MAX, HIT_Z_MIN, HIT_Z_PERFECT, SWING_SPEED_MIN_HIT } from './tuning';

export interface CubeRec {
  id: number; hand: Hand; dir: Dir8; t: number; result: HitKind; score: number; dtMs: number; errMs: number;
  minDist: number | null; minDistAtMs: number | null; maxSpeed: number; dirs: string;
  visible: boolean; otherMinDist: number | null; swapHands: boolean;
  zAtHit: number; minDistZ: number | null;
  space: 'screen';
}

interface Acc {
  minDist: number; minAt: number; minZ: number; maxSpeed: number; dirs: number[]; visible: boolean; otherMin: number;
}

export interface ObsHand { dist: number; peak: number; swingDir: Dir8 | null; visible: boolean }

const r2 = (v: number): number => Math.round(v * 100) / 100;
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return r2(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
}

declare global {
  interface Window { __nsLog?: CubeRec[]; __nsSummary?: () => Record<string, number | null> }
}

let diagLogging = false;
export function setDiagLogging(on: boolean): void { diagLogging = on; }

export class CubeDiag {
  private acc = new Map<number, Acc>();
  private total = 0;
  private cnt = { good: 0, miss: 0, wrongColor: 0, wrongDir: 0 };
  private missRecs: CubeRec[] = [];
  private goodDt: number[] = [];

  constructor() {
    window.__nsLog = [];
    window.__nsSummary = () => this.summary();
  }

  reset(): void {
    this.acc.clear(); this.total = 0;
    this.cnt = { good: 0, miss: 0, wrongColor: 0, wrongDir: 0 };
    this.missRecs = []; this.goodDt = [];
    if (window.__nsLog) window.__nsLog.length = 0;
  }

  observe(note: Note, songTime: number, z: number, own: ObsHand, otherDist: number): void {
    if (z < HIT_Z_MIN || z > HIT_Z_MAX) return;
    const err = songTime - note.time;
    let a = this.acc.get(note.id);
    if (!a) {
      a = { minDist: Infinity, minAt: 0, minZ: NaN, maxSpeed: 0, dirs: [], visible: false, otherMin: Infinity };
      this.acc.set(note.id, a);
    }
    if (own.visible) {
      a.visible = true;
      if (own.dist < a.minDist) { a.minDist = own.dist; a.minAt = err * 1000; a.minZ = z; }
      if (own.peak > a.maxSpeed) a.maxSpeed = own.peak;
      if (own.peak >= SWING_SPEED_MIN_HIT && typeof own.swingDir === 'number' && a.dirs[a.dirs.length - 1] !== own.swingDir) {
        a.dirs.push(own.swingDir as number);
      }
    }
    if (otherDist < a.otherMin) a.otherMin = otherDist;
  }

  finish(note: Note, result: HitKind, score: number, songTime: number, swapHands: boolean, zAtHit: number):
    { rec: CubeRec; lastDir: number | null } {
    const a = this.acc.get(note.id);
    this.acc.delete(note.id);
    const fin = (v: number | undefined): number | null => (v !== undefined && isFinite(v) ? r2(v) : null);
    const rec: CubeRec = {
      id: note.id, hand: note.hand, dir: note.dir, t: r2(note.time), result, score,
      dtMs: Math.round((songTime - note.time) * 1000),
      errMs: Math.round((zAtHit - HIT_Z_PERFECT) / CUBE_SPEED * 1000),
      minDist: fin(a?.minDist), minDistAtMs: a && isFinite(a.minDist) ? Math.round(a.minAt) : null,
      maxSpeed: r2(a?.maxSpeed ?? 0), dirs: a ? a.dirs.join(',') : '',
      visible: a?.visible ?? false, otherMinDist: fin(a?.otherMin), swapHands,
      zAtHit: r2(zAtHit), minDistZ: a && isFinite(a.minDist) ? r2(a.minZ) : null, space: 'screen',
    };
    if (diagLogging) console.log('[cube]', JSON.stringify(rec));
    const log = window.__nsLog ?? (window.__nsLog = []);
    log.push(rec);
    if (log.length > DIAG_LOG_SIZE) log.shift();
    this.total++;
    this.cnt[result]++;
    if (result === 'miss') this.missRecs.push(rec);
    if (result === 'good') this.goodDt.push(rec.dtMs);
    if (this.total % DIAG_SUMMARY_EVERY === 0 && diagLogging) console.log('[summary]', JSON.stringify(this.summary()));
    return { rec, lastDir: a && a.dirs.length ? a.dirs[a.dirs.length - 1]! : null };
  }

  summary(): Record<string, number | null> {
    const m = this.missRecs;
    return {
      cubes: this.total, ...this.cnt,
      medianMinDistOnMiss: median(m.filter((r) => r.minDist !== null).map((r) => r.minDist!)),
      medianMaxSpeedOnMiss: median(m.map((r) => r.maxSpeed)),
      pctVisibleOnMiss: m.length ? Math.round((100 * m.filter((r) => r.visible).length) / m.length) : null,
      medianDtGood: median(this.goodDt),
    };
  }
}
