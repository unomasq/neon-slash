import { Calibrator, CAL_BEAT_MS, CAL_CLICKS } from '../../game/calibration';
import { BaseScreen, q } from './base';
import type { App } from '../app';

export class CalibrationScreen extends BaseScreen {
  private cal: Calibrator | null = null;
  private circle: HTMLElement;
  private title: HTMLElement;
  private text: HTMLElement;
  private startBtn: HTMLButtonElement;
  private doneBtn: HTMLButtonElement;
  private skipBtn: HTMLButtonElement;
  private result: number | null = null;
  private lastBeat = -1;

  constructor(app: App) {
    super(app, 'overlay-layer', `
      <div class="card">
        <h2 class="k-title">Калибровка задержки</h2>
        <p class="k-text">Сделай взмах любой рукой на каждый щелчок</p>
        <div class="cal-circle"></div>
        <div class="k-btns">
          <button type="button" class="btn big k-start">Начать</button>
          <button type="button" class="btn big k-done" hidden>Готово</button>
          <button type="button" class="btn small k-skip">Назад</button>
        </div>
      </div>`);
    this.circle = q(this.root, '.cal-circle');
    this.title = q(this.root, '.k-title');
    this.text = q(this.root, '.k-text');
    this.startBtn = q(this.root, '.k-start');
    this.doneBtn = q(this.root, '.k-done');
    this.skipBtn = q(this.root, '.k-skip');
    this.startBtn.addEventListener('click', () => { void this.run(); });
    this.doneBtn.addEventListener('click', () => {
      if (this.result !== null) this.app.calibrationDone(this.result);
    });
    this.skipBtn.addEventListener('click', () => this.app.calibrationSkip());
  }

  show(): void {
    super.show();
    this.reset();
  }

  hide(): void {
    super.hide();
    this.cal?.dispose();
    this.cal = null;
  }

  private reset(): void {
    this.cal?.dispose();
    this.cal = null;
    this.result = null;
    this.title.textContent = 'Калибровка задержки';
    this.text.textContent = 'Сделай взмах любой рукой на каждый щелчок';
    this.startBtn.hidden = false;
    this.startBtn.disabled = false;
    this.startBtn.textContent = 'Начать';
    this.doneBtn.hidden = true;
    this.skipBtn.textContent = this.app.intent === 'calibrate' ? 'Назад' : 'Пропустить';
    this.circle.style.transform = '';
    this.circle.classList.remove('flash');
  }

  private async run(): Promise<void> {
    this.startBtn.disabled = true;
    this.doneBtn.hidden = true;
    this.text.textContent = 'Приготовься… ' + CAL_CLICKS + ' щелчка';
    this.cal = new Calibrator();
    this.lastBeat = -1;
    try { await this.cal.start(); } catch (e) {
      console.error(e);
      this.text.textContent = 'Не удалось запустить звук. Попробуй ещё раз';
      this.startBtn.disabled = false;
      this.cal = null;
    }
  }

  tick(now: number): void {
    const cal = this.cal;
    if (!cal || !cal.running) return;
    const sw = this.app.tracker?.swingInfo;
    if (sw) cal.push(now, sw.left.peakSpeed, sw.right.peakSpeed);
    const pn = performance.now();
    let scale = 1;
    let beat = -1;
    for (let i = 0; i < cal.clickTimes.length; i++) {
      const d = pn - cal.clickTimes[i]!;
      if (d >= 0 && d < CAL_BEAT_MS) { beat = i; scale = 1 + 0.4 * Math.exp(-d / 140); }
    }
    this.circle.style.transform = `scale(${scale.toFixed(3)})`;
    if (beat >= 0 && beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.text.textContent = `Щелчок ${beat + 1} из ${CAL_CLICKS}`;
    }
    if (cal.finished) {
      const ms = cal.finish();
      this.startBtn.hidden = false;
      this.startBtn.disabled = false;
      this.startBtn.textContent = 'Повторить';
      this.circle.style.transform = '';
      if (ms === null) {
        this.text.textContent = 'Не заметил взмахов. Встань так, чтобы руки были видны, и повтори';
        this.doneBtn.hidden = true;
      } else {
        this.result = ms;
        this.text.textContent = `Твоя задержка: ${ms} мс`;
        this.doneBtn.hidden = false;
      }
    }
  }
}
