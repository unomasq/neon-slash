export interface Onset { t: number; strength: number; band: 'low' | 'mid' | 'high' }
export interface Analysis {
  bpm: number;
  beats: number[];
  onsets: Onset[];
  duration: number;
  /** громкость (RMS) с частотой 10 Гц */
  energyCurve: number[];
}

export async function decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try { return await ctx.decodeAudioData(data); } finally { void ctx.close(); }
}

export function analyzeAudio(buffer: AudioBuffer, onProgress?: (p: number) => void): Promise<Analysis> {
  const n = buffer.length, ch = buffer.numberOfChannels;
  const mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i]! += d[i]! / ch;
  }
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./onset.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ type: 'progress'; p: number } | { type: 'done'; result: Analysis } | { type: 'error'; message: string }>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m.p);
      else { w.terminate(); if (m.type === 'done') resolve(m.result); else reject(new Error(m.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ samples: mono, sampleRate: buffer.sampleRate }, [mono.buffer]);
  });
}
