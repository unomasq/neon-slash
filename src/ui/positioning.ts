import type { TrackingState } from '../types';
import { SLOT } from '../tracking/poseProtocol';
import { trackingInfo } from '../tracking/trackingInfo';

/** Минимальный контракт трекера, нужный экрану позиционирования */
interface TrackerLike { rawPoints: Float32Array }

const W = 640, H = 480;
const HOLD_MS = 1500;
const RING_LEN = 2 * Math.PI * 28;

/** Экран позиционирования: превью камеры, подсказки, удержание правильной позы 1,5 с -> onDone */
export class PositioningScreen {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hintEl: HTMLDivElement;
  private ringEl: SVGCircleElement;
  private dotL: HTMLSpanElement;
  private dotR: HTMLSpanElement;
  private skipBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private tracker: TrackerLike | null = null;
  private video: HTMLVideoElement | null = null;
  private onDone: (() => void) | null = null;
  private onBack: (() => void) | null = null;
  private okSince = 0;
  private lastHint = '';
  private lightEl: HTMLDivElement;

  constructor() {
    const root = document.createElement('div');
    root.className = 'overlay-layer pos-screen';
    root.hidden = true;
    root.innerHTML = `
      <div class="card pos-card">
        <h2>Встань так, чтобы тебя было видно</h2>
        <div class="pos-view">
          <canvas width="${W}" height="${H}"></canvas>
          <div class="pos-zone"></div>
          <svg class="pos-ring" viewBox="0 0 64 64" hidden>
            <circle cx="32" cy="32" r="28" class="bg"></circle>
            <circle cx="32" cy="32" r="28" class="fg" stroke-dasharray="${RING_LEN}" stroke-dashoffset="${RING_LEN}"></circle>
          </svg>
        </div>
        <div class="pos-hint"></div>
        <div class="pos-light" hidden style="color:#ffd23f;margin-top:6px;font-size:14px">Темновато: включи свет перед собой, так трекинг будет плавнее</div>
        <div class="pos-dots">
          <span class="pos-ind"><span class="dot left"></span>Левая</span>
          <span class="pos-ind"><span class="dot right"></span>Правая</span>
        </div>
        <div class="pos-btns">
          <button type="button" class="pos-btn pos-back">Назад</button>
          <button type="button" class="pos-btn pos-skip">Начать всё равно</button>
        </div>
      </div>`;
    this.root = root;
    this.canvas = root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.hintEl = root.querySelector('.pos-hint')!;
    this.lightEl = root.querySelector('.pos-light')!;
    this.ringEl = root.querySelector('.pos-ring .fg')!;
    const dots = root.querySelectorAll<HTMLSpanElement>('.pos-dots .dot');
    this.dotL = dots[0]!;
    this.dotR = dots[1]!;
    this.skipBtn = root.querySelector('.pos-skip')!;
    this.backBtn = root.querySelector('.pos-back')!;
    this.skipBtn.addEventListener('click', () => this.finish());
    this.backBtn.addEventListener('click', () => { const cb = this.onBack; this.hide(); cb?.(); });
    document.body.appendChild(root);
  }

  /** video — тот же элемент, что передан tracker.init; onBack вызывается по кнопке «Назад» */
  show(tracker: TrackerLike, onDone: () => void, video?: HTMLVideoElement, onBack?: () => void): void {
    this.tracker = tracker;
    this.onDone = onDone;
    this.onBack = onBack ?? null;
    this.video = video ?? (document.getElementById('cam') as HTMLVideoElement | null);
    this.okSince = 0;
    this.lastHint = '';
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.tracker = null;
    this.onDone = null;
    this.okSince = 0;
  }

  get visible(): boolean { return !this.root.hidden; }

  private finish(): void {
    const cb = this.onDone;
    this.hide();
    cb?.();
  }

  tick(now: number, state: TrackingState): void {
    if (this.root.hidden || !this.tracker) return;
    const raw = this.tracker.rawPoints;
    const ctx = this.ctx;
    const px = (s: number) => (1 - raw[s * 3]!) * W;
    const py = (s: number) => raw[s * 3 + 1]! * H;
    const v = (s: number) => raw[s * 3 + 2]!;

    ctx.clearRect(0, 0, W, H);
    if (this.video && this.video.readyState >= 2) {
      ctx.save();
      ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, W, H);
      ctx.restore();
    }
    const arm = (sh: number, el: number, wr: number, ix: number, color: string) => {
      const chain = [sh, el, wr, ix].filter((s) => v(s) > 0.5);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 4;
      ctx.beginPath();
      chain.forEach((s, i) => (i ? ctx.lineTo(px(s), py(s)) : ctx.moveTo(px(s), py(s))));
      ctx.stroke();
      for (const s of chain) { ctx.beginPath(); ctx.arc(px(s), py(s), s === wr ? 9 : 6, 0, Math.PI * 2); ctx.fill(); }
    };
    arm(SLOT.shoulderL, SLOT.elbowL, SLOT.wristL, SLOT.indexL, '#ff2d55');
    arm(SLOT.shoulderR, SLOT.elbowR, SLOT.wristR, SLOT.indexR, '#2d8cff');

    const vL = v(SLOT.shoulderL), vR = v(SLOT.shoulderR);
    const noShoulders = vL < 0.3 && vR < 0.3;
    let sy = 0, n = 0;
    if (vL >= 0.3) { sy += raw[SLOT.shoulderL * 3 + 1]!; n++; }
    if (vR >= 0.3) { sy += raw[SLOT.shoulderR * 3 + 1]!; n++; }
    const lowShoulders = n > 0 && sy / n > 0.75;
    const wristsOk = v(SLOT.wristL) > 0.5 && v(SLOT.wristR) > 0.5;

    let hint: string;
    let ok = false;
    if (noShoulders) hint = 'Встань перед камерой на расстоянии 1–2 метра';
    else if (lowShoulders) hint = 'Отойди или наклони экран: плечи должны быть в верхней половине кадра';
    else if (!wristsOk) hint = 'Подними руки, покажи обе ладони';
    else { hint = 'Отлично! Держи так…'; ok = true; }
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.hintEl.textContent = hint;
    }
    const ti = trackingInfo;
    const dark = ((ti.camLock === 'locked' || ti.camLock === 'auto-ok') && ti.luma > 0 && ti.luma < 60) ||
      (ti.camLock === 'unsupported' && ti.camFps > 0 && ti.camFps < 24);
    if (this.lightEl.hidden === dark) this.lightEl.hidden = !dark;
    this.hintEl.classList.toggle('ok', ok);
    this.root.classList.toggle('is-ok', ok);

    this.dotL.classList.toggle('on', state.left.visible);
    this.dotR.classList.toggle('on', state.right.visible);

    const ring = this.ringEl.parentElement as unknown as SVGElement;
    if (ok) {
      if (!this.okSince) this.okSince = now;
      const p = Math.min(1, (now - this.okSince) / HOLD_MS);
      ring.removeAttribute('hidden');
      this.ringEl.style.strokeDashoffset = String(RING_LEN * (1 - p));
      if (p >= 1) this.finish();
    } else {
      this.okSince = 0;
      ring.setAttribute('hidden', '');
    }
  }
}
