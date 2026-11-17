import type { ScoreState } from '../game/score';
import type { HitKind } from '../types';
import { tierForCombo } from '../fx/bus';
import { ComboBanner, TIER_COLORS } from './comboBanner';

const TOAST_TEXT: Record<HitKind, string> = {
  good: '',
  miss: 'Мимо',
  wrongColor: 'Не тот цвет',
  wrongDir: 'Не то направление',
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

export class Hud {
  private scoreEl = $('score');
  private comboEl = $('combo');
  private multEl = $('mult');
  private handsText = $('hands-text');
  private dotL = $('dot-left');
  private dotR = $('dot-right');
  private fpsEl = $('fps');
  private toastEl = $('toast');
  /** Если задан, вместо встроенной карточки результата вызывается он (экраны приложения) */
  onResult: ((s: ScoreState) => void) | null = null;
  private lastScore = -1;
  private lastCombo = -1;
  private lastMult = -1;
  private lastVis = '';
  private toastTimer = 0;
  private bigEl = $('big');
  private bigTimer = 0;
  private lastTier = -1;
  private scorePulse = false;

  constructor() { new ComboBanner($('hud')); }

  /** Пружина счёта; вызывается на каждый hit, класс применяется при ближайшем update */
  pulseScore(): void { this.scorePulse = true; }

  update(s: ScoreState): void {
    if (this.scorePulse) {
      this.scorePulse = false;
      this.scoreEl.classList.remove('spring');
      void this.scoreEl.offsetWidth;
      this.scoreEl.classList.add('spring');
    }
    if (s.score !== this.lastScore) {
      this.lastScore = s.score;
      this.scoreEl.textContent = String(s.score);
    }
    if (s.combo !== this.lastCombo) {
      const grew = s.combo > this.lastCombo;
      this.lastCombo = s.combo;
      this.comboEl.textContent = s.combo > 1 ? `Комбо ${s.combo}` : '';
      const tier = tierForCombo(s.combo);
      if (tier !== this.lastTier) {
        this.lastTier = tier;
        this.comboEl.style.setProperty('--tc', tier ? TIER_COLORS[tier]! : '');
        this.comboEl.classList.toggle('tiered', tier > 0);
      }
      if (grew && s.combo > 1) {
        this.comboEl.classList.remove('pulse');
        void this.comboEl.offsetWidth;
        this.comboEl.classList.add('pulse');
      }
    }
    if (s.multiplier !== this.lastMult) {
      const prev = this.lastMult;
      this.lastMult = s.multiplier;
      const grew = s.multiplier > prev;
      this.multEl.textContent = s.multiplier > 1 ? `×${s.multiplier}` : '';
      if (grew) {
        this.multEl.classList.remove('flash');
        void this.multEl.offsetWidth;
        this.multEl.classList.add('flash');
      }
    }
  }

  setHands(left: boolean, right: boolean): void {
    const key = `${left}${right}`;
    if (key === this.lastVis) return;
    this.lastVis = key;
    this.dotL.classList.toggle('on', left);
    this.dotR.classList.toggle('on', right);
    this.handsText.textContent = left && right ? 'Руки видны' : 'Покажи руки';
  }

  setFps(fps: number): void {
    if (!this.fpsEl.hidden) this.fpsEl.textContent = `${Math.round(fps)} fps`;
  }

  private lastStats = 0;

  setStats(
    now: number,
    st: { renderMs: number; drawCalls: number },
    fps: number,
    tr: { inferMs?: number; delegate?: string; detectFps?: number; captureMs?: number },
    quality: number,
    prof: { frame: number; track: number; scene: number } = { frame: 0, track: 0, scene: 0 },
    swing = '',
  ): void {
    if (this.fpsEl.hidden || now - this.lastStats < 250) return;
    this.lastStats = now;
    const dev = tr.delegate === 'GPU' ? 'GPU' : 'CPU';
    this.fpsEl.textContent =
      `frame ${prof.frame.toFixed(1)}ms (cap ${(tr.captureMs ?? 0).toFixed(1)} | track ${prof.track.toFixed(1)} | scene ${prof.scene.toFixed(1)} | render ${st.renderMs.toFixed(1)}) | calls ${st.drawCalls} | infer ${Math.round(tr.inferMs ?? 0)}ms ${dev} | ` +
      `detect ${Math.round(tr.detectFps ?? 0)}fps | fps ${Math.round(fps)} | q${quality}` +
      (swing ? ` | ${swing}` : '');
  }

  /** Произвольный короткий тост */
  toastText(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1200);
  }

  /** Крупный текст в центре на 1 с (режим тренировки) */
  bigText(text: string, good: boolean): void {
    this.bigEl.textContent = text;
    this.bigEl.classList.toggle('good', good);
    this.bigEl.classList.add('show');
    clearTimeout(this.bigTimer);
    this.bigTimer = window.setTimeout(() => this.bigEl.classList.remove('show'), 1000);
  }

  hideBig(): void { clearTimeout(this.bigTimer); this.bigEl.classList.remove('show'); }

  get statsVisible(): boolean { return !this.fpsEl.hidden; }

  toggleFps(): void { this.fpsEl.hidden = !this.fpsEl.hidden; }

  toast(kind: HitKind): void {
    const text = TOAST_TEXT[kind];
    if (!text) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 700);
  }

  showResult(s: ScoreState, _onRestart: () => void): void { this.onResult?.(s); }

  hideResult(): void { /* карточку результата рисует ResultScreen */ }

  setVisible(v: boolean): void { $('hud').hidden = !v; }
}
