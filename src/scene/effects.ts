import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group,
  Mesh, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial, RingGeometry,
} from 'three';
import { COLORS, CUBE_SPEED } from '../config';
import { fx } from '../fx/bus';
import type { Vec2 } from '../types';
import { getGlowTexture } from './util';

const HALVES = 12;
const HALF_LIFE = 0.6;
const SPARKS = 280;
const RINGS = 8;
const RING_LIFE = 0.3;
const RING_MAX = 2.5;
const BURST = 40;
const SPARK_LIFE = 0.5;
const FLASHES = 8;
const FLASH_LIFE = 0.25;
const GRAV = 9;
const SIZE = 0.9;
const OFFSCREEN = -999;

interface Half {
  pivot: Group; mat: MeshBasicMaterial; life: number;
  vx: number; vy: number; vz: number; sx: number; sy: number; sz: number; base: number;
}
interface Ring { mesh: Mesh; mat: MeshBasicMaterial; life: number }
interface Flash { mesh: Mesh; mat: MeshBasicMaterial; life: number; scale: number }

const tmp = new Color();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Effects {
  readonly group = new Group();
  sparksEnabled = true;
  private halves: Half[] = [];
  private halfNext = 0;
  private flashes: Flash[] = [];
  private flashNext = 0;
  private rings: Ring[] = [];
  private ringNext = 0;
  private offs: Array<() => void> = [];
  private sparks: Points;
  private sPos = new Float32Array(SPARKS * 3);
  private sCol = new Float32Array(SPARKS * 3);
  private sBase = new Float32Array(SPARKS * 3); // базовый цвет
  private sVel = new Float32Array(SPARKS * 3);
  private sLife = new Float32Array(SPARKS);
  private sNext = 0;
  private sPosAttr: BufferAttribute;
  private sColAttr: BufferAttribute;

  constructor() {
    const halfGeo = new BoxGeometry(SIZE, SIZE / 2, SIZE);
    for (let i = 0; i < HALVES; i++) {
      const mat = new MeshBasicMaterial({ transparent: true });
      const mesh = new Mesh(halfGeo, mat);
      mesh.position.y = (i % 2 === 0 ? 1 : -1) * SIZE / 4;
      const pivot = new Group();
      pivot.add(mesh);
      pivot.visible = false;
      this.group.add(pivot);
      this.halves.push({ pivot, mat, life: 0, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, base: 0 });
    }
    const fGeo = new PlaneGeometry(1, 1);
    const tex = getGlowTexture();
    for (let i = 0; i < FLASHES; i++) {
      const mat = new MeshBasicMaterial({
        map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false,
      });
      const mesh = new Mesh(fGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.flashes.push({ mesh, mat, life: 0, scale: 1 });
    }
    const rGeo = new RingGeometry(0.88, 1, 48);
    for (let i = 0; i < RINGS; i++) {
      const mat = new MeshBasicMaterial({
        transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide,
      });
      const mesh = new Mesh(rGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, life: 0 });
    }
    this.offs.push(fx.on('hit', (e) => {
      const hex = COLORS[e.hand];
      this.flash(e.x, e.y, e.z + 0.6, hex, e.perfect ? 4.6 : 3.6);
      this.ring(e.x, e.y, e.z + 0.3, tmp.set(hex).multiplyScalar(1.8));
      if (e.perfect) {
        this.ring(e.x, e.y, e.z + 0.35, tmp.set(0xffffff).multiplyScalar(2));
        if (this.sparksEnabled) {
          const a = Math.random() * Math.PI * 2;
          this.emitSparks(e.x, e.y, e.z, hex, Math.cos(a), Math.sin(a)); // ×2 искр на perfect
        }
      }
    }));
    for (let i = 0; i < SPARKS; i++) this.sPos[i * 3 + 1] = OFFSCREEN;
    const g = new BufferGeometry();
    this.sPosAttr = new BufferAttribute(this.sPos, 3).setUsage(DynamicDrawUsage);
    this.sColAttr = new BufferAttribute(this.sCol, 3).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.sPosAttr);
    g.setAttribute('color', this.sColAttr);
    this.sparks = new Points(g, new PointsMaterial({
      size: 0.16, map: tex, vertexColors: true, transparent: true,
      blending: AdditiveBlending, depthWrite: false,
    }));
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  /** Разрез/развал куба в точке (x,y,z). */
  burst(x: number, y: number, z: number, hex: number, bad: boolean, dir?: Vec2): void {
    let dx = 1, dy = 0;
    if (dir) {
      const l = Math.hypot(dir.x, dir.y);
      if (l > 1e-4) { dx = dir.x / l; dy = dir.y / l; }
    }
    // нормаль к плоскости разреза
    const nx = -dy, ny = dx;
    const base = Math.atan2(ny, nx) - Math.PI / 2;
    const sep = bad ? 1.2 : 2.6;
    const col = bad ? tmp.set(0x555566) : tmp.set(hex).multiplyScalar(1.6);
    for (let k = 0; k < 2; k++) {
      const h = this.halves[this.halfNext];
      this.halfNext = (this.halfNext + 1) % HALVES;
      const sg = k === 0 ? 1 : -1;
      h.life = HALF_LIFE;
      h.mat.color.copy(col);
      h.mat.opacity = 1;
      h.pivot.position.set(x, y, z);
      h.pivot.scale.setScalar(1);
      h.base = base;
      // половинки: k=0 — верхняя (child y>0), k=1 — нижняя; индексы пула чередуют знак
      h.pivot.children[0].position.y = sg * SIZE / 4;
      h.vx = nx * sg * sep + rnd(-0.3, 0.3);
      h.vy = ny * sg * sep + rnd(-0.3, 0.3);
      h.vz = CUBE_SPEED * 0.6;
      const spin = bad ? 1.5 : 4;
      h.sx = rnd(-spin, spin); h.sy = rnd(-spin, spin); h.sz = sg * rnd(0.5, spin);
      h.pivot.rotation.set(0, 0, base);
      h.pivot.visible = true;
    }
    this.flash(x, y, z + 0.5, bad ? 0x888899 : hex, bad ? 2 : 3.2);
    if (!bad && this.sparksEnabled) this.emitSparks(x, y, z, hex, dx, dy);
  }

  private flash(x: number, y: number, z: number, hex: number, scale: number): void {
    const f = this.flashes[this.flashNext];
    this.flashNext = (this.flashNext + 1) % FLASHES;
    f.life = FLASH_LIFE;
    f.scale = scale;
    f.mat.color.set(hex).multiplyScalar(1.5);
    f.mat.opacity = 1;
    f.mesh.position.set(x, y, z);
    f.mesh.visible = true;
  }

  private ring(x: number, y: number, z: number, col: Color): void {
    const r = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % RINGS;
    r.life = RING_LIFE;
    r.mat.color.copy(col);
    r.mat.opacity = 1;
    r.mesh.position.set(x, y, z);
    r.mesh.scale.setScalar(0.01);
    r.mesh.visible = true;
  }

  dispose(): void { for (const o of this.offs) o(); this.offs.length = 0; }

  private emitSparks(x: number, y: number, z: number, hex: number, dx: number, dy: number): void {
    const c = tmp.set(hex).multiplyScalar(2);
    for (let n = 0; n < BURST; n++) {
      const i = this.sNext;
      this.sNext = (this.sNext + 1) % SPARKS;
      const o = i * 3;
      // вдоль линии разреза в обе стороны + разброс
      const sg = Math.random() < 0.5 ? 1 : -1;
      const sp = rnd(2, 7);
      this.sVel[o] = dx * sg * sp + rnd(-1.5, 1.5);
      this.sVel[o + 1] = dy * sg * sp + rnd(-1, 2.5);
      this.sVel[o + 2] = CUBE_SPEED * 0.5 + rnd(-2, 2);
      this.sPos[o] = x; this.sPos[o + 1] = y; this.sPos[o + 2] = z;
      this.sBase[o] = c.r; this.sBase[o + 1] = c.g; this.sBase[o + 2] = c.b;
      this.sLife[i] = SPARK_LIFE;
    }
  }

  /** Прогрев: показывает половинки, вспышку и искры в кадре; возвращает откат. */
  warmShow(z: number): () => void {
    const hs = this.halves.slice(0, 2), f = this.flashes[0], rg = this.rings[0];
    rg.mesh.position.set(0, 0.6, z); rg.mesh.scale.setScalar(1); rg.mesh.visible = true;
    hs.forEach((h, i) => { h.pivot.position.set(i - 0.5, 0.6, z); h.pivot.visible = true; });
    f.mesh.position.set(0, 0.6, z); f.mesh.visible = true;
    const posY = this.sPos[1];
    this.sPos[0] = 0; this.sPos[1] = 0.6; this.sPos[2] = z;
    this.sCol[0] = this.sCol[1] = this.sCol[2] = 1;
    this.sPosAttr.needsUpdate = true; this.sColAttr.needsUpdate = true;
    return () => {
      for (const h of hs) h.pivot.visible = false;
      f.mesh.visible = false;
      rg.mesh.visible = false;
      this.sPos[1] = posY;
      this.sCol[0] = this.sCol[1] = this.sCol[2] = 0;
      this.sPosAttr.needsUpdate = true; this.sColAttr.needsUpdate = true;
    };
  }

  setSparks(on: boolean): void {
    this.sparksEnabled = on;
    if (!on) {
      this.sLife.fill(0);
      this.sCol.fill(0);
      for (let i = 0; i < SPARKS; i++) this.sPos[i * 3 + 1] = OFFSCREEN;
      this.sPosAttr.needsUpdate = true; this.sColAttr.needsUpdate = true;
    }
  }

  update(dt: number): void {
    for (const h of this.halves) {
      if (h.life <= 0) continue;
      h.life -= dt;
      if (h.life <= 0) { h.pivot.visible = false; continue; }
      const t = HALF_LIFE - h.life;
      const p = h.pivot;
      p.position.x += h.vx * dt; p.position.y += h.vy * dt; p.position.z += h.vz * dt;
      p.rotation.set(h.sx * t, h.sy * t, h.base + h.sz * t);
      h.mat.opacity = h.life / HALF_LIFE;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.mesh.visible = false; continue; }
      const k = 1 - f.life / FLASH_LIFE;
      f.mesh.scale.setScalar(f.scale * (0.4 + 0.6 * k));
      f.mat.opacity = 1 - k;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const k = 1 - r.life / RING_LIFE;
      r.mesh.scale.setScalar(Math.max(0.01, RING_MAX * (1 - (1 - k) * (1 - k))));
      r.mat.opacity = (1 - k) * (1 - k);
    }
    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      const l = this.sLife[i];
      if (l <= 0) continue;
      any = true;
      const o = i * 3;
      const nl = l - dt;
      this.sLife[i] = nl;
      if (nl <= 0) {
        this.sPos[o + 1] = OFFSCREEN;
        this.sCol[o] = this.sCol[o + 1] = this.sCol[o + 2] = 0;
        continue;
      }
      this.sVel[o + 1] -= GRAV * dt;
      this.sPos[o] += this.sVel[o] * dt;
      this.sPos[o + 1] += this.sVel[o + 1] * dt;
      this.sPos[o + 2] += this.sVel[o + 2] * dt;
      const f = nl / SPARK_LIFE;
      this.sCol[o] = this.sBase[o] * f; this.sCol[o + 1] = this.sBase[o + 1] * f; this.sCol[o + 2] = this.sBase[o + 2] * f;
    }
    if (any) {
      this.sPosAttr.needsUpdate = true; this.sColAttr.needsUpdate = true;
    }
  }
}
