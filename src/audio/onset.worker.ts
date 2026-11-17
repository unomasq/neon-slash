import type { Analysis, Onset } from './onset';

const WIN = 2048, HOP = 512;

function fft(re: Float64Array, im: Float64Array, cosT: Float64Array, sinT: Float64Array, rev: Uint32Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) { let t = re[i]!; re[i] = re[j]!; re[j] = t; t = im[i]!; im[i] = im[j]!; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0, ti = 0; k < half; k++, ti += step) {
        const a = s + k, b = a + half;
        const c = cosT[ti]!, sn = -sinT[ti]!;
        const xr = re[b]! * c - im[b]! * sn, xi = re[b]! * sn + im[b]! * c;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi;
        re[a] = re[a]! + xr; im[a] = im[a]! + xi;
      }
    }
  }
}

function percentile(a: Float64Array, q: number): number {
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

function normSmooth(a: Float64Array): Float64Array {
  const p = percentile(a, 0.98) || 1;
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = (a[i - 1] ?? a[i]!) * 0.25 + a[i]! * 0.5 + (a[i + 1] ?? a[i]!) * 0.25;
    out[i] = x / p;
  }
  return out;
}

function pickPeaks(env: Float64Array, fps: number, band: Onset['band'], delta: number, centerOff: number): Onset[] {
  const n = env.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + env[i]!;
  const R = Math.round(0.4 * fps), minD = 0.1;
  const out: Onset[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = env[i]!;
    if (v < env[i - 1]! || v <= env[i + 1]!) continue;
    let isMax = true;
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (env[k]! > v) { isMax = false; break; }
    if (!isMax) continue;
    const lo = Math.max(0, i - R), hi = Math.min(n, i + R + 1);
    const mean = (pre[hi]! - pre[lo]!) / (hi - lo);
    if (v < mean * 1.3 + delta) continue;
    const t = i / fps + centerOff;
    const last = out[out.length - 1];
    if (last && t - last.t < minD) { if (v > last.strength) { last.t = t; last.strength = v; } continue; }
    out.push({ t, strength: v, band });
  }
  return out;
}

function estimateBpm(env: Float64Array, fps: number): number {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i]!;
  mean /= n;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = env[i]! - mean;
  const maxLag = Math.ceil(fps * 60 / 60) * 4 + 2;
  const ac = new Float64Array(maxLag + 1);
  for (let l = 0; l <= maxLag; l++) {
    let s = 0;
    for (let i = 0; i + l < n; i++) s += x[i]! * x[i + l]!;
    ac[l] = s / (n - l);
  }
  const at = (l: number): number => {
    if (l >= maxLag) return 0;
    const i = Math.floor(l), f = l - i;
    return ac[i]! * (1 - f) + ac[i + 1]! * f;
  };
  let best = 120, bestS = -Infinity;
  for (let bpm = 60; bpm <= 200; bpm += 0.1) {
    const L = fps * 60 / bpm;
    let s = at(L) + 0.5 * at(2 * L) + 0.25 * at(4 * L);
    if (bpm < 80 || bpm > 160) s *= 0.8;
    if (s > bestS) { bestS = s; best = bpm; }
  }
  return Math.round(best * 10) / 10;
}

function analyze(samples: Float32Array, sr: number, progress: (p: number) => void): Analysis {
  const duration = samples.length / sr;
  const fps = sr / HOP;
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1);
  const cosT = new Float64Array(WIN / 2), sinT = new Float64Array(WIN / 2);
  for (let i = 0; i < WIN / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / WIN); sinT[i] = Math.sin(2 * Math.PI * i / WIN); }
  const rev = new Uint32Array(WIN);
  const bits = Math.log2(WIN);
  for (let i = 0; i < WIN; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  const hann = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN);
  const binHz = sr / WIN;
  const bin = (hz: number) => Math.max(1, Math.round(hz / binHz));
  const bands: [number, number][] = [[bin(30), bin(150)], [bin(150), bin(2000)], [bin(2000), bin(8000)]];
  const nb = WIN / 2;
  const prev = new Float64Array(nb), cur = new Float64Array(nb);
  const re = new Float64Array(WIN), im = new Float64Array(WIN);
  const flux = [0, 1, 2].map(() => new Float64Array(frames));
  const total = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < WIN; i++) { re[i] = samples[off + i]! * hann[i]!; im[i] = 0; }
    fft(re, im, cosT, sinT, rev);
    for (let k = 0; k < nb; k++) cur[k] = Math.log1p(10 * Math.hypot(re[k]!, im[k]!) / WIN * 8);
    if (f > 0) {
      for (let b = 0; b < 3; b++) {
        let s = 0;
        for (let k = bands[b]![0]; k < bands[b]![1]; k++) { const d = cur[k]! - prev[k]!; if (d > 0) s += d; }
        flux[b]![f] = s / (bands[b]![1] - bands[b]![0]);
      }
      let s = 0;
      for (let k = 1; k < nb; k++) { const d = cur[k]! - prev[k]!; if (d > 0) s += d; }
      total[f] = s / nb;
    }
    prev.set(cur);
    if ((f & 255) === 0) progress(0.9 * f / frames);
  }
  const env = flux.map(normSmooth);
  const envT = normSmooth(total);
  const centerOff = (WIN / 2) / sr;
  const names: Onset['band'][] = ['low', 'mid', 'high'];
  const onsets = env.flatMap((e, b) => pickPeaks(e, fps, names[b]!, 0.1, centerOff)).sort((a, b) => a.t - b.t);
  progress(0.93);

  const bpm = frames > fps * 4 ? estimateBpm(envT, fps) : 120;
  const P = fps * 60 / bpm;
  let bestPh = 0, bestSum = -Infinity;
  for (let ph = 0; ph < P; ph += 0.25) {
    let s = 0;
    for (let p = ph; p < frames - 1; p += P) {
      const i = Math.floor(p), fr = p - i;
      s += envT[i]! * (1 - fr) + envT[i + 1]! * fr;
    }
    if (s > bestSum) { bestSum = s; bestPh = ph; }
  }
  const beats: number[] = [];
  for (let p = bestPh; p < frames; p += P) beats.push(p / fps + centerOff);

  const seg = Math.round(sr / 10);
  const energyCurve: number[] = [];
  for (let s = 0; s < samples.length; s += seg) {
    const e = Math.min(samples.length, s + seg);
    let sum = 0;
    for (let i = s; i < e; i++) sum += samples[i]! * samples[i]!;
    energyCurve.push(Math.sqrt(sum / Math.max(1, e - s)));
  }
  progress(1);
  return { bpm, beats, onsets, duration, energyCurve };
}

self.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    let last = 0;
    const result = analyze(e.data.samples, e.data.sampleRate, (p) => {
      if (p - last >= 0.02 || p === 1) { last = p; (self as unknown as Worker).postMessage({ type: 'progress', p }); }
    });
    (self as unknown as Worker).postMessage({ type: 'done', result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: String(err) });
  }
};
