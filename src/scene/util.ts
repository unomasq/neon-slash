import { CanvasTexture, Color, SRGBColorSpace } from 'three';

/** Цвет с множителем >1 — чтобы пройти порог bloom (HDR-буфер). */
export function glow(hex: number, k: number): Color {
  return new Color(hex).multiplyScalar(k);
}

let glowTex: CanvasTexture | null = null;
/** Общая мягкая круглая текстура для вспышек и искр. */
export function getGlowTexture(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new CanvasTexture(c);
  glowTex.colorSpace = SRGBColorSpace;
  return glowTex;
}
