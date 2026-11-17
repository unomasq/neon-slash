import { fx } from '../fx/bus';

const TIER_TEXT = ['', 'КОМБО ×10', '×25 ОГОНЬ!', '×50 ПЕРЕГРЕВ!'];
export const TIER_COLORS = ['#ffffff', '#2dd4ff', '#ffb400', '#ff2d55'];

/** Надпись комбо: один переиспользуемый DOM-элемент, анимации только transform/opacity (CSS). */
export class ComboBanner {
  private el = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.el.id = 'combo-banner';
    parent.appendChild(this.el);
    fx.on('tier', (e) => {
      if (e.tier < 1) return;
      this.el.style.setProperty('--tc', TIER_COLORS[e.tier] ?? '#fff');
      this.play(TIER_TEXT[e.tier] ?? '', 'tier');
    });
    fx.on('comboBreak', (e) => {
      if (e.lost >= 10) this.play(`−${e.lost} комбо`, 'lost');
    });
  }

  private play(text: string, cls: 'tier' | 'lost'): void {
    const el = this.el;
    el.textContent = text;
    el.className = '';
    void el.offsetWidth; // перезапуск анимации
    el.className = cls;
  }
}
