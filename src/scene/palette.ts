import { Color } from 'three';
import { fxState } from '../fx/bus';

export interface PaletteColors { tunnel: Color; floor: Color; judge: Color; fog: Color; bg: Color; dust: Color }

const mk = (t: number, f: number, j: number, fog: number, bg: number, d: number): PaletteColors => ({
  tunnel: new Color(t), floor: new Color(f), judge: new Color(j), fog: new Color(fog), bg: new Color(bg), dust: new Color(d),
});

const TIERS: PaletteColors[] = [
  mk(0x8a2cff, 0x3a2cff, 0x9ffcff, 0x05060d, 0x05060d, 0x8a8cff),
  mk(0xc02cff, 0x18e0d0, 0x7ffff0, 0x080512, 0x080512, 0x66f5ea),
  mk(0xc02cff, 0xffb020, 0xffe08a, 0x0c0610, 0x0c0610, 0xffd060),
  mk(0xff7a10, 0xffb020, 0xffffff, 0x120804, 0x120804, 0xffe6b0),
];
const KEYS: (keyof PaletteColors)[] = ['tunnel', 'floor', 'judge', 'fog', 'bg', 'dust'];
const DARK = new Color(0x020204);
const TRANS = 0.8;

/** Палитры по ComboTier; current плавно движется к палитре fxState.tier, dim затемняет и обесцвечивает. */
export class Palette {
  readonly current: PaletteColors = mk(0, 0, 0, 0, 0, 0);
  private base: PaletteColors = mk(0, 0, 0, 0, 0, 0);
  private gray = new Color();

  constructor() {
    for (const k of KEYS) { this.base[k].copy(TIERS[0][k]); this.current[k].copy(TIERS[0][k]); }
  }

  update(dt: number): void {
    const target = TIERS[fxState.tier];
    const a = 1 - Math.exp(-dt * 4 / TRANS); // ~98% за 0.8 с
    const dim = fxState.dim;
    for (const k of KEYS) {
      const b = this.base[k];
      b.lerp(target[k], a);
      const c = this.current[k].copy(b);
      if (dim > 0) {
        const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
        this.gray.setRGB(l, l, l);
        c.lerp(this.gray, dim * 0.7).lerp(DARK, dim * 0.6);
      }
    }
  }
}
