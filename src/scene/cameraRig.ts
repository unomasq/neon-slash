import type { PerspectiveCamera } from 'three';
import { fx, fxState } from '../fx/bus';

const BASE_FOV = 65;
const BASE_X = 0, BASE_Y = 1.2, BASE_Z = 7;
const LOOK_X = 0, LOOK_Y = 0.6, LOOK_Z = -6;
const INTRO_X = 0, INTRO_Y = 3, INTRO_Z = 40;
const SHAKE_TAU = 0.045; // ~5% через 130 мс
const FOV_TAU = 0.12;
const NOISE_FREQ = 55;
const ROLL = 4 * Math.PI / 180;

// value-noise по решётке случайных значений (не синус)
const LAT = new Float32Array(256);
for (let i = 0; i < 256; i++) LAT[i] = Math.random() * 2 - 1;
function noise(t: number, seed: number): number {
  const f = Math.floor(t);
  const u = t - f;
  const s = u * u * (3 - 2 * u);
  const a = LAT[(f * 7 + seed * 31) & 255], b = LAT[((f + 1) * 7 + seed * 31) & 255];
  return a + (b - a) * s;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Тряска, FOV-пинки и вступительный пролёт камеры. Базовая поза не меняется. */
export class CameraRig {
  private shake = 0;
  private fovKick = 0;
  private time = 0;
  private introT = 1;
  private introDur = 0;
  private offs: Array<() => void> = [];

  private camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
    this.offs.push(
      fx.on('hit', (e) => {
        this.shake = Math.max(this.shake, e.perfect ? 0.09 : 0.04);
        if (e.perfect) this.fovKick = Math.max(this.fovKick, 1.5);
      }),
      fx.on('drop', () => { this.shake = Math.max(this.shake, 0.12); this.fovKick = Math.max(this.fovKick, 3); }),
      fx.on('introStart', (e) => this.playIntro(e.duration)),
    );
  }

  playIntro(duration: number): void {
    this.introDur = Math.max(0.01, duration);
    this.introT = 0;
    fxState.intro = 0;
  }

  update(dt: number): void {
    this.time += dt;
    const cam = this.camera;
    let x = BASE_X, y = BASE_Y, z = BASE_Z, roll = 0;
    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / this.introDur);
      fxState.intro = this.introT;
      const e = easeInOutCubic(this.introT);
      x = INTRO_X + (BASE_X - INTRO_X) * e;
      y = INTRO_Y + (BASE_Y - INTRO_Y) * e;
      z = INTRO_Z + (BASE_Z - INTRO_Z) * e;
      roll = Math.sin(e * Math.PI * 2) * ROLL;
    }
    const k = Math.exp(-dt / SHAKE_TAU);
    this.shake *= k;
    if (this.shake < 1e-4) this.shake = 0;
    if (this.shake > 0) {
      const t = this.time * NOISE_FREQ;
      x += noise(t, 1) * this.shake;
      y += noise(t, 2) * this.shake;
      z += noise(t, 3) * this.shake * 0.5;
    }
    cam.position.set(x, y, z);
    cam.lookAt(LOOK_X, LOOK_Y, LOOK_Z);
    if (roll !== 0) cam.rotateZ(roll);
    this.fovKick *= Math.exp(-dt / FOV_TAU);
    if (this.fovKick < 0.01) this.fovKick = 0;
    const fov = BASE_FOV + this.fovKick;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  dispose(): void { for (const o of this.offs) o(); this.offs.length = 0; }
}
