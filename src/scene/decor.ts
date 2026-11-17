import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from 'three';
import { COLORS, CUBE_SPEED } from '../config';
import { fx, fxState } from '../fx/bus';
import { glow } from './util';
import { Palette } from './palette';
import { JudgeLine } from './judgeLine';

const X = 7, Y0 = -3.2, Y1 = 5.5;
const Z_NEAR = 6, Z_FAR = -45;
const FRAME_STEP = 5, FLOOR_STEP = 2;

function lines(pts: number[], mat: LineBasicMaterial): LineSegments {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const l = new LineSegments(g, mat);
  l.frustumCulled = false;
  return l;
}

/** Неоновый тоннель по краям + пол-сетка. Всего 5 LineSegments. */
export class Decor {
  readonly group = new Group();
  private frames: LineSegments;
  private floorCross: LineSegments;
  private scroll = 0;
  private judge: JudgeLine;
  private railMatL: LineBasicMaterial;
  private railMatR: LineBasicMaterial;
  private frameMat: LineBasicMaterial;
  private floorMat: LineBasicMaterial;
  private floorLong: LineSegments;
  private flash = 0;
  private off: () => void;
  private palette: Palette;

  constructor(palette: Palette = new Palette()) {
    this.palette = palette;
    this.judge = new JudgeLine(palette);
    this.off = fx.on('drop', () => { this.flash = 0.4; });
    const railL: number[] = [], railR: number[] = [];
    for (const y of [Y0, 1.2, Y1]) {
      railL.push(-X, y, Z_NEAR, -X, y, Z_FAR);
      railR.push(X, y, Z_NEAR, X, y, Z_FAR);
    }
    this.railMatL = new LineBasicMaterial({ color: glow(COLORS.left, 1.6) });
    this.railMatR = new LineBasicMaterial({ color: glow(COLORS.right, 1.6) });
    this.group.add(lines(railL, this.railMatL), lines(railR, this.railMatR));
    // рамки тоннеля, уходящие в глубину и плывущие к игроку
    const fr: number[] = [];
    for (let z = Z_NEAR; z >= Z_FAR; z -= FRAME_STEP) {
      fr.push(-X, Y0, z, X, Y0, z, X, Y0, z, X, Y1, z, X, Y1, z, -X, Y1, z, -X, Y1, z, -X, Y0, z);
    }
    this.frameMat = new LineBasicMaterial({ color: glow(0x8a2cff, 1.4) });
    this.frames = lines(fr, this.frameMat);
    this.group.add(this.frames);
    // пол: продольные линии статичны, поперечные плывут
    const fl: number[] = [];
    for (let x = -X; x <= X; x += 1) fl.push(x, Y0, Z_NEAR, x, Y0, Z_FAR);
    const cr: number[] = [];
    for (let z = Z_NEAR; z >= Z_FAR; z -= FLOOR_STEP) cr.push(-X, Y0, z, X, Y0, z);
    this.floorMat = new LineBasicMaterial({ color: glow(0x3a2cff, 1.2), transparent: true, opacity: 0.45 });
    this.floorCross = lines(cr, this.floorMat);
    this.floorLong = lines(fl, this.floorMat);
    this.group.add(this.floorLong, this.floorCross, this.judge.group);
  }

  update(dt: number): void {
    const bp = fxState.beatPulse;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    const boost = 1 + 1.5 * (this.flash / 0.4); // до ×2.5 на дропе
    const k = (1 + 1.2 * bp + 0.5 * fxState.bass) * boost;
    const pc = this.palette.current;
    const dim = 1 - fxState.dim * 0.7;
    this.railMatL.color.set(COLORS.left).multiplyScalar(1.6 * k * dim);
    this.railMatR.color.set(COLORS.right).multiplyScalar(1.6 * k * dim);
    this.frameMat.color.copy(pc.tunnel).multiplyScalar(1.4 * k);
    this.floorMat.color.copy(pc.floor).multiplyScalar(1.2 * k);
    const sc = 1 + 0.03 * bp;
    this.frames.scale.set(sc, sc, 1);
    this.frames.position.y = (1 - sc) * ((Y0 + Y1) / 2);
    const bob = -0.05 * bp;
    this.floorLong.position.y = bob;
    this.floorCross.position.y = bob;
    this.judge.update(dt, boost);
    this.scroll += dt * CUBE_SPEED;
    this.frames.position.z = this.scroll % FRAME_STEP;
    this.floorCross.position.z = this.scroll % FLOOR_STEP;
  }

  dispose(): void { this.off(); }
}
