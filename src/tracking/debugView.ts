import type { TrackingState } from '../types';
import { SLOT } from './poseProtocol';
import { POSE_SCORE_OFF } from '../config';
import { trackingInfo as ti } from './trackingInfo';

const W = 240, H = 180;

/** Отладочный оверлей трекинга: зеркальное видео, плечи-локти-запястья, подпись «CPU 23ms 28fps» */
export class TrackingDebugView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement | null = null;
  private shown = false;

  constructor() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.style.cssText = `position:fixed;right:8px;bottom:8px;width:${W}px;height:${H}px;z-index:50;display:none;pointer-events:none;border:1px solid #fff4;border-radius:6px`;
    this.canvas = c;
    this.ctx = c.getContext('2d')!;
  }

  attach(video: HTMLVideoElement): void {
    this.video = video;
    if (!this.canvas.isConnected) document.body.appendChild(this.canvas);
  }

  toggle(): void {
    this.shown = !this.shown;
    this.canvas.style.display = this.shown ? 'block' : 'none';
  }

  get visible(): boolean { return this.shown; }

  draw(state: TrackingState, rawPoints: Float32Array): void {
    if (!this.shown) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    if (this.video && this.video.readyState >= 2) {
      ctx.save();
      ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, W, H);
      ctx.restore();
    }
    const px = (slot: number) => (1 - rawPoints[slot * 3]!) * W;
    const py = (slot: number) => rawPoints[slot * 3 + 1]! * H;
    const vis = (slot: number) => rawPoints[slot * 3 + 2]! > POSE_SCORE_OFF;
    const arm = (sh: number, el: number, wr: number, ix: number, color: string) => {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
      const chain = [sh, el, wr, ...(ix === wr ? [] : [ix])].filter(vis);
      ctx.beginPath();
      chain.forEach((s, i) => (i ? ctx.lineTo(px(s), py(s)) : ctx.moveTo(px(s), py(s))));
      ctx.stroke();
      for (const s of chain) { ctx.beginPath(); ctx.arc(px(s), py(s), s === wr ? 5 : 3, 0, Math.PI * 2); ctx.fill(); }
    };
    arm(SLOT.shoulderL, SLOT.elbowL, SLOT.wristL, SLOT.indexL, '#ff2d55');
    arm(SLOT.shoulderR, SLOT.elbowR, SLOT.wristR, SLOT.indexR, '#2d8cff');
    const hollow = (o: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc((1 - ti.synthPts[o]!) * W, ti.synthPts[o + 1]! * H, 6, 0, Math.PI * 2); ctx.stroke();
    };
    if (ti.synthL) hollow(0, '#ff2d55');
    if (ti.synthR) hollow(2, '#2d8cff');
    ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, W, 58);
    ctx.fillStyle = '#fff'; ctx.font = "10px monospace"; ctx.textBaseline = 'top';
    const r = Math.round;
    ctx.fillText(
      `${state.backend ?? state.delegate ?? '?'}${ti.threads ? '×' + ti.threads : ''} ${r(state.inferMs ?? 0)}ms (read ${r(ti.read)} / prep ${r(ti.prep)} / infer ${r(ti.infer)}) ${r(state.detectFps ?? 0)}fps`,
      4, 2,
    );
    const br = ti.brightness > 0 ? '+' + ti.brightness : String(ti.brightness);
    ctx.fillText(`cam ${(ti.camera || '?').split('@')[0]} real ${r(ti.camFps)}fps lock:${ti.camLock} exp ${ti.exposure || '-'} br ${br}`, 4, 16);
    ctx.fillStyle = ti.lowLight ? '#ffd23f' : '#fff';
    ctx.fillText(`luma ${r(ti.luma)}${ti.lowLight ? ' low-light' : ''} synth ${ti.synthL ? 'L' : '-'}/${ti.synthR ? 'R' : '-'}`, 4, 30);
    ctx.fillStyle = '#fff';
    ctx.fillText(`lat ${r(state.latencyMs ?? 0)}ms`, 4, 44);
  }
}
