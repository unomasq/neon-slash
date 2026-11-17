import { GAME_NAME, SITE_URL, COLORS } from '../config';

export interface ResultData { trackName: string; trackSubtitle?: string; difficulty: 'easy' | 'normal' | 'hard'; score: number; accuracy: number; maxCombo: number; isRecord: boolean; date?: Date }

const W = 1080, H = 1920;
const FONT = 'system-ui, "Inter", "Segoe UI", Roboto, Arial, sans-serif';
const RED = '#' + COLORS.left.toString(16).padStart(6, '0');
const BLUE = '#' + COLORS.right.toString(16).padStart(6, '0');
const DIFF_RU = { easy: 'Легко', normal: 'Нормально', hard: 'Сложно' } as const;

function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, blur: number, maxW?: number) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y, maxW);
  ctx.shadowBlur = blur / 3;
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y, maxW);
  ctx.restore();
}

function saber(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 50;
  ctx.strokeStyle = color;
  ctx.lineWidth = 34;
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.shadowBlur = 20;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.stroke();
  // рукоять
  const dx = x1 - x2, dy = y1 - y2, l = Math.hypot(dx, dy);
  const hx = x1 + (dx / l) * 90, hy = y1 + (dy / l) * 90;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#2a2d3d';
  ctx.lineWidth = 22;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.restore();
}

function draw(data: ResultData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D недоступен');

  // фон
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0620'); bg.addColorStop(0.5, '#05060d'); bg.addColorStop(1, '#12041a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // тоннель
  const vx = W / 2, vy = 760;
  ctx.save();
  ctx.lineWidth = 3;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const ex = vx + Math.cos(a) * 1500, ey = vy + Math.sin(a) * 1500;
    ctx.strokeStyle = i % 2 ? BLUE : RED;
    ctx.globalAlpha = 0.28;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(vx + Math.cos(a) * 60, vy + Math.sin(a) * 60); ctx.lineTo(ex, ey); ctx.stroke();
  }
  for (let k = 1; k <= 9; k++) {
    const r = 40 * Math.pow(1.45, k);
    ctx.strokeStyle = k % 2 ? RED : BLUE;
    ctx.globalAlpha = Math.min(0.5, 0.08 + k * 0.05);
    ctx.lineWidth = 2 + k * 0.4;
    ctx.strokeRect(vx - r * 0.9, vy - r * 0.9 * 0.8, r * 1.8, r * 1.8 * 0.8);
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(vx, vy, 0, vx, vy, 600);
  glow.addColorStop(0, 'rgba(120,80,255,0.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  // затемнение под текст
  const shade = ctx.createLinearGradient(0, 640, 0, 1100);
  shade.addColorStop(0, 'rgba(5,6,13,0)'); shade.addColorStop(1, 'rgba(5,6,13,0.85)');
  ctx.fillStyle = shade; ctx.fillRect(0, 640, W, 460);

  // мечи (скрещены: красный \ , синий /)
  saber(ctx, 300, 780, 780, 330, RED);
  saber(ctx, 780, 780, 300, 330, BLUE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // название игры
  ctx.font = `800 140px ${FONT}`;
  glowText(ctx, GAME_NAME.toUpperCase(), W / 2, 230, BLUE, 40, W - 80);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
  ctx.font = `800 140px ${FONT}`; ctx.shadowColor = RED; ctx.shadowBlur = 60; ctx.fillStyle = 'rgba(255,45,85,0.25)';
  ctx.fillText(GAME_NAME.toUpperCase(), W / 2 + 4, 234, W - 80); ctx.restore();

  // трек
  ctx.fillStyle = '#fff';
  ctx.font = `700 64px ${FONT}`;
  ctx.fillText(data.trackName, W / 2, 1010, W - 120);
  let y = 1010;
  if (data.trackSubtitle) {
    y += 60;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `400 40px ${FONT}`;
    ctx.fillText(data.trackSubtitle, W / 2, y, W - 120);
  }
  y += 70;
  ctx.font = `600 44px ${FONT}`;
  const diffColor = data.difficulty === 'easy' ? '#4dff9a' : data.difficulty === 'normal' ? '#ffd24d' : RED;
  glowText(ctx, DIFF_RU[data.difficulty].toUpperCase(), W / 2, y, diffColor, 18);

  // счёт
  ctx.font = `800 200px ${FONT}`;
  glowText(ctx, String(data.score), W / 2, 1400, '#b36bff', 50, W - 80);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `500 40px ${FONT}`;
  ctx.fillText('ОЧКОВ', W / 2, 1460);

  // статистика
  ctx.fillStyle = '#fff';
  ctx.font = `600 56px ${FONT}`;
  ctx.fillText(`Точность ${Math.round(data.accuracy * 100)}%`, W / 2, 1550);
  ctx.fillText(`Макс. комбо ${data.maxCombo}`, W / 2, 1620);

  // бейдж
  if (data.isRecord) {
    const bw = 520, bh = 90, bx = (W - bw) / 2, by = 1655;
    ctx.save();
    ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 45); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1a1200';
    ctx.font = `800 46px ${FONT}`;
    ctx.fillText('Новый рекорд!', W / 2, by + 62);
  }

  // низ
  ctx.fillStyle = '#fff';
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(SITE_URL.replace(/^https?:\/\//, ''), W / 2, 1810);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `400 32px ${FONT}`;
  ctx.fillText('Сыграй сам: управление руками через камеру', W / 2, 1860, W - 80);
  if (data.date) {
    ctx.font = `400 26px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(data.date.toLocaleDateString('ru-RU'), W / 2, 1900);
  }
  return c;
}

export function renderResultCard(data: ResultData): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      draw(data).toBlob(b => (b ? resolve(b) : reject(new Error('toBlob вернул null'))), 'image/png');
    } catch (e) { reject(e); }
  });
}

export function resultCardDataUrl(data: ResultData): Promise<string> {
  return Promise.resolve().then(() => draw(data).toDataURL('image/png'));
}
