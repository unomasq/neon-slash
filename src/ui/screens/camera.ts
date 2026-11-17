import { BaseScreen, q } from './base';
import type { App } from '../app';

export class CameraScreen extends BaseScreen {
  private btn: HTMLButtonElement;
  private err: HTMLElement;
  private busy = false;

  constructor(app: App) {
    super(app, 'overlay-layer', `
      <div class="card">
        <h2>Нужна камера</h2>
        <p>Игра отслеживает движения рук через камеру. Видео никуда не отправляется и не сохраняется, всё считается на твоём устройстве.</p>
        <p class="error c-err"></p>
        <button type="button" class="btn big c-btn">Разрешить камеру</button>
        <button type="button" class="btn small c-back">Назад</button>
      </div>`);
    this.btn = q(this.root, '.c-btn');
    this.err = q(this.root, '.c-err');
    this.btn.addEventListener('click', () => { void this.connect(); });
    q(this.root, '.c-back').addEventListener('click', () => app.go('main'));
  }

  show(): void {
    super.show();
    this.err.textContent = '';
    this.btn.disabled = false;
    this.btn.textContent = 'Разрешить камеру';
  }

  async connect(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.err.textContent = '';
    this.btn.disabled = true;
    this.btn.textContent = 'Загружаю камеру и модель…';
    const msg = await this.app.initCamera();
    this.busy = false;
    if (msg) {
      this.err.textContent = msg;
      this.btn.disabled = false;
      this.btn.textContent = 'Попробовать снова';
    }
  }
}
