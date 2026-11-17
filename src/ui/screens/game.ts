import { INTRO_SEC, countdownStep, trackDuration } from '../../audio';
import { fx } from '../../fx/bus';
import { BaseScreen, q } from './base';
import type { App } from '../app';

/** HUD-надстройка: прогресс трека, название на 2 с, пауза */
export class GameScreen extends BaseScreen {
  private bar: HTMLElement;
  private title: HTMLElement;
  private pauseEl: HTMLElement;
  private titleTimer = 0;
  private lastPct = -1;
  private cdEl: HTMLElement;
  private cdAnim: Animation | null = null;
  private cdIdx = -99;
  private prevT = -INTRO_SEC;
  private started = false;

  constructor(app: App) {
    super(app, 'game-screen', `
      <div class="progress"><div class="progress-fill"></div></div>
      <style>
        .cd-text{position:absolute;left:0;right:0;top:38%;text-align:center;pointer-events:none;opacity:0;
          font:900 min(22vw,180px)/1 system-ui,sans-serif;color:#fff;letter-spacing:.04em;
          text-shadow:0 0 24px #4df,0 0 60px #a4f;will-change:transform,opacity}
        .cd-text.go{font-size:min(14vw,120px)}
      </style>
      <div class="cd-text"></div>
      <div class="game-title"></div>
      <div class="overlay-layer pause" hidden>
        <div class="card">
          <h2>Пауза</h2>
          <button type="button" class="btn big p-resume">Продолжить</button>
          <button type="button" class="btn small p-exit">Выйти</button>
        </div>
      </div>`);
    this.bar = q(this.root, '.progress-fill');
    this.title = q(this.root, '.game-title');
    this.pauseEl = q(this.root, '.pause');
    this.cdEl = q(this.root, '.cd-text');
    q(this.root, '.p-resume').addEventListener('click', () => app.setPaused(false));
    q(this.root, '.p-exit').addEventListener('click', () => app.exitGame());
  }

  show(): void {
    super.show();
    this.pauseEl.hidden = true;
    this.lastPct = -1;
    this.prevT = -INTRO_SEC;
    this.started = false;
    this.cdIdx = -99;
    this.cdAnim?.cancel();
    this.cdEl.style.opacity = '0';
    this.bar.style.width = '0%';
    const t = this.app.selection;
    this.title.textContent = t.practice ? 'Тренировка' : t.track.name;
    this.title.classList.add('show');
    clearTimeout(this.titleTimer);
    this.titleTimer = window.setTimeout(() => this.title.classList.remove('show'), 2000);
    q(this.root, '.progress').hidden = t.practice;
  }

  hide(): void {
    super.hide();
    clearTimeout(this.titleTimer);
    this.title.classList.remove('show');
  }

  setPaused(p: boolean): void {
    this.pauseEl.hidden = !p;
    if (p) this.cdAnim?.pause(); else this.cdAnim?.play();
  }

  /** Отсчёт 3-2-1-ВПЕРЁД по времени трека (getTime уже с поправкой на задержку вывода) */
  private countdown(t: number): void {
    const step = countdownStep(this.app.selection.track.bpm);
    if (this.prevT < 0 && t >= 0 && !this.started) {
      this.started = true;
      fx.emit({ type: 'trackStart' });
    }
    this.prevT = t;
    if (t < -3 * step || t > 0.9) return;
    const idx = t >= 0 ? 0 : Math.floor(t / step); // -3,-2,-1 -> «3»,«2»,«1»; 0 -> «ВПЕРЁД!»
    if (idx === this.cdIdx) return;
    this.cdIdx = idx;
    const go = idx === 0;
    this.cdEl.textContent = go ? 'ВПЕРЁД!' : String(-idx);
    this.cdEl.classList.toggle('go', go);
    this.cdAnim?.cancel();
    this.cdAnim = this.cdEl.animate([
      { transform: 'scale(1.6)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.2 },
      { transform: 'scale(1)', opacity: 1, offset: 0.6 },
      { transform: 'scale(0.96)', opacity: 0 },
    ], { duration: go ? 900 : step * 1000, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  }

  tick(): void {
    const sel = this.app.selection;
    if (sel.practice) return;
    const time = this.app.player.getTime();
    if (this.app.player.isPlaying) this.countdown(time);
    const pct = Math.max(0, Math.min(100, Math.round((time / trackDuration(sel.track)) * 1000) / 10));
    if (pct !== this.lastPct) { this.lastPct = pct; this.bar.style.width = `${pct}%`; }
  }
}
