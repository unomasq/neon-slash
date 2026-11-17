export interface BestRecord { score: number; accuracy: number; maxCombo: number; date: string }

const P = 'ns:';

function read(key: string): string | null {
  try { return localStorage.getItem(P + key); } catch { return null; }
}
function write(key: string, v: string): boolean {
  try { localStorage.setItem(P + key, v); return true; } catch { return false; }
}

export function getBest(trackId: string, difficulty: string): BestRecord | null {
  const raw = read(`best:${trackId}:${difficulty}`);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as BestRecord;
    return typeof r?.score === 'number' ? r : null;
  } catch { return null; }
}

export function saveBest(trackId: string, difficulty: string, rec: BestRecord): boolean {
  const cur = getBest(trackId, difficulty);
  if (cur && cur.score >= rec.score) return false;
  write(`best:${trackId}:${difficulty}`, JSON.stringify(rec));
  return true;
}

export function getCalibrationMs(): number | null {
  const raw = read('calibrationMs');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setCalibrationMs(ms: number): void {
  write('calibrationMs', String(ms));
}

export function getSetting<T>(key: string, def: T): T {
  const raw = read(`setting:${key}`);
  if (raw === null) return def;
  try { return JSON.parse(raw) as T; } catch { return def; }
}

export function setSetting<T>(key: string, value: T): void {
  write(`setting:${key}`, JSON.stringify(value));
}
