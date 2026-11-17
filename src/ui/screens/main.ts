import { GAME_NAME, TELEGRAM_URL } from '../../config';
import { BaseScreen, q } from './base';
import type { App } from '../app';
import { getSetting, setSetting } from '../../game/storage';

export class MainScreen extends BaseScreen {
  constructor(app: App) {
    super(app, 'main-screen', `
      <button type="button" class="gear" aria-label="Настройки">⚙</button>
      <div class="settings card" hidden>
        <h3>Настройки</h3>
        <label class="row check"><input type="checkbox" class="s-swap" /> Поменять руки местами</label>
        <label class="row">Трекинг
          <select class="s-delegate"><option value="CPU">CPU (wasm)</option><option value="GPU">GPU (WebGL)</option><option value="WEBGPU">WebGPU (эксперимент)</option></select>
        </label>
        <label class="row">Эффекты
          <select class="s-fx"><option value="max">Максимум</option><option value="norm">Нормально</option><option value="min">Минимум</option></select>
        </label>
        <button type="button" class="btn sec s-close">Закрыть</button>
      </div>
      <div class="main-center">
        <h1 class="logo"></h1>
        <button type="button" class="btn big m-play">Играть</button>
        <div class="small-btns">
          <button type="button" class="btn small m-practice">Тренировка</button>
          <button type="button" class="btn small m-calib">Калибровка</button>
        </div>
        <p class="error m-err"></p>
      </div>
      <div class="footer"><a target="_blank" rel="noopener" class="tg">Telegram-канал</a></div>`);
    q(this.root, '.logo').textContent = GAME_NAME;
    if (TELEGRAM_URL.includes('PLACEHOLDER')) q(this.root, '.footer').remove();
    else q<HTMLAnchorElement>(this.root, '.tg').href = TELEGRAM_URL;
    const panel = q(this.root, '.settings');
    const swap = q<HTMLInputElement>(this.root, '.s-swap');
    const del = q<HTMLSelectElement>(this.root, '.s-delegate');
    const fxSel = q<HTMLSelectElement>(this.root, '.s-fx');
    fxSel.value = getSetting<string>('fxLevel', 'max');
    fxSel.addEventListener('change', () => setSetting('fxLevel', fxSel.value as 'max' | 'norm' | 'min'));
    swap.checked = app.swapHands;
    del.value = app.delegate;
    q(this.root, '.gear').addEventListener('click', () => { panel.hidden = !panel.hidden; });
    q(this.root, '.s-close').addEventListener('click', () => { panel.hidden = true; });
    swap.addEventListener('change', () => app.setSwapHands(swap.checked));
    del.addEventListener('change', () => { void app.setDelegate(del.value as 'CPU' | 'GPU' | 'WEBGPU'); });
    q(this.root, '.m-play').addEventListener('click', () => { void app.begin('play'); });
    q(this.root, '.m-practice').addEventListener('click', () => { void app.begin('practice'); });
    q(this.root, '.m-calib').addEventListener('click', () => { void app.begin('calibrate'); });
  }

  show(): void {
    super.show();
    q(this.root, '.settings').hidden = true;
    q<HTMLSelectElement>(this.root, '.s-delegate').value = this.app.delegate;
    q<HTMLInputElement>(this.root, '.s-swap').checked = this.app.swapHands;
  }
}
