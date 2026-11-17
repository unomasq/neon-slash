import { renderResultCard, resultCardDataUrl, type ResultData } from '../resultCard';
import { shareResult } from '../share';
import { track } from '../analytics';
import { BaseScreen, q } from './base';
import type { App } from '../app';

export function gradeFor(acc: number): string {
  const p = acc * 100;
  return p >= 95 ? 'S' : p >= 85 ? 'A' : p >= 70 ? 'B' : p >= 50 ? 'C' : 'D';
}

export class ResultScreen extends BaseScreen {
  private data: ResultData | null = null;
  private img: HTMLImageElement;
  private shareBtn: HTMLButtonElement;
  private seq = 0;

  constructor(app: App) {
    super(app, 'overlay-layer', `
      <div class="card result-card">
        <h2>Трек пройден</h2>
        <div class="grade"></div>
        <div class="record" hidden>Новый рекорд!</div>
        <div class="stats">
          <div><span class="r-score">0</span><small>Счёт</small></div>
          <div><span class="r-acc">0%</span><small>Точность</small></div>
          <div><span class="r-combo">0</span><small>Макс. комбо</small></div>
        </div>
        <img class="r-img" alt="Карточка результата" hidden />
        <button type="button" class="btn r-share">Поделиться</button>
        <div class="k-btns">
          <button type="button" class="btn big r-again">Ещё раз</button>
          <button type="button" class="btn big sec r-other">Другой трек</button>
        </div>
      </div>`);
    this.img = q(this.root, '.r-img');
    this.shareBtn = q(this.root, '.r-share');
    this.shareBtn.addEventListener('click', () => { void this.share(); });
    q(this.root, '.r-again').addEventListener('click', () => { void app.startGame(); });
    q(this.root, '.r-other').addEventListener('click', () => app.go('select'));
  }

  setData(d: ResultData): void { this.data = d; }

  show(): void {
    super.show();
    const d = this.data;
    if (!d) return;
    q(this.root, '.grade').textContent = gradeFor(d.accuracy);
    q(this.root, '.record').hidden = !d.isRecord;
    q(this.root, '.r-score').textContent = String(d.score);
    q(this.root, '.r-acc').textContent = `${Math.round(d.accuracy * 100)}%`;
    q(this.root, '.r-combo').textContent = String(d.maxCombo);
    this.img.hidden = true;
    const my = ++this.seq;
    resultCardDataUrl(d).then((url) => {
      if (my !== this.seq) return;
      this.img.src = url;
      this.img.hidden = false;
    }).catch((e) => console.error(e));
  }

  private flash(t: string): void {
    this.shareBtn.textContent = t;
    setTimeout(() => { this.shareBtn.textContent = 'Поделиться'; }, 2000);
  }

  private async share(): Promise<void> {
    if (!this.data) return;
    this.shareBtn.disabled = true;
    try {
      const blob = await renderResultCard(this.data);
      const r = await shareResult(blob, this.data);
      if (r !== 'cancelled') track('share', { method: r });
      if (r === 'downloaded') this.flash('Картинка сохранена');
    } catch (e) {
      console.error(e);
      this.flash('Не удалось поделиться');
    } finally { this.shareBtn.disabled = false; }
  }
}
