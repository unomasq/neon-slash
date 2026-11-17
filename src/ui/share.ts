import { SITE_URL } from '../config';
import type { ResultData } from './resultCard';

export async function shareResult(blob: Blob, data: ResultData): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const name = `neon-slash-${data.score}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const text = `Мой результат в Neon Slash: ${data.score} очков, точность ${Math.round(data.accuracy * 100)}% — ${SITE_URL}`;
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // иное сбой share -> скачивание
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
