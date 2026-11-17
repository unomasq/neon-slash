import {
  AdditiveBlending, BackSide, BoxGeometry, CanvasTexture, Color, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
} from 'three';
import { COLORS, CUBE_SPAWN_Z, CUBE_SPEED, LANE_X, ROW_Y } from '../config';
import type { Dir8, Hand, Note } from '../types';
import { fxState } from '../fx/bus';
import { glow } from './util';

export interface ActiveCube { note: Note; z: number; x: number; y: number; half: number }

const POOL = 64;
const HANDS: Hand[] = ['left', 'right'];
const SIZE = 0.9;
const HALO_OPACITY = 0.22;
const HALO_FADE_FAR = -2.0; // дальше — полный ореол
const HALO_FADE_NEAR = -1.0; // ближе — ореол выключен (экономия overdraw вблизи)
const CULL_Z = 6.5; // за камерой — тихо убираем

interface Slot { group: Group; body: Mesh; edges: LineSegments; face: Mesh; halo: Mesh; haloMat: MeshBasicMaterial; frame: LineSegments; armed: boolean; cube: ActiveCube }

function makeFaceTexture(dir: Dir8): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#07080f';
  g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  g.fillStyle = '#ffffff';
  if (dir === 'any') {
    g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 6;
    g.beginPath(); g.arc(0, 0, 54, 0, Math.PI * 2); g.stroke();
  } else {
    g.rotate(dir * Math.PI / 4); // по часовой от «вверх»
    g.beginPath();
    g.moveTo(0, -48); g.lineTo(42, 4); g.lineTo(18, 4); g.lineTo(18, 46);
    g.lineTo(-18, 46); g.lineTo(-18, 4); g.lineTo(-42, 4);
    g.closePath(); g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class CubePool {
  readonly group = new Group();
  private free: Slot[] = [];
  private byId = new Map<number, Slot>();
  private active: ActiveCube[] = [];
  private bodyGeo = new BoxGeometry(SIZE, SIZE, SIZE);
  private edgeGeo = new EdgesGeometry(new BoxGeometry(SIZE * 1.01, SIZE * 1.01, SIZE * 1.01));
  private faceGeo = new PlaneGeometry(SIZE * 0.84, SIZE * 0.84);
  private bodyMat: Record<Hand, MeshBasicMaterial>;
  private edgeMat: Record<Hand, LineBasicMaterial>;
  private edgeArmedMat: Record<Hand, LineBasicMaterial>;
  private frameGeo = new EdgesGeometry(new BoxGeometry(SIZE * 1.18, SIZE * 1.18, SIZE * 1.18));
  private frameMat = new LineBasicMaterial({ color: glow(0xffffff, 2), fog: false });
  private faceMat = new Map<string, MeshBasicMaterial>();
  private haloGeo = new BoxGeometry(SIZE * 1.3, SIZE * 1.3, SIZE * 1.3);
  private haloBase: Record<Hand, MeshBasicMaterial>;
  private haloOn = false;
  private edgeBase: Record<Hand, Color>;
  private edgeArmedBase: Record<Hand, Color>;

  constructor() {
    this.bodyMat = {
      left: new MeshBasicMaterial({ color: glow(COLORS.left, 0.3) }),
      right: new MeshBasicMaterial({ color: glow(COLORS.right, 0.3) }),
    };
    this.edgeMat = {
      left: new LineBasicMaterial({ color: glow(COLORS.left, 3) }),
      right: new LineBasicMaterial({ color: glow(COLORS.right, 3) }),
    };
    this.edgeArmedMat = {
      left: new LineBasicMaterial({ color: glow(COLORS.left, 3 * 1.6) }),
      right: new LineBasicMaterial({ color: glow(COLORS.right, 3 * 1.6) }),
    };
    this.edgeBase = { left: this.edgeMat.left.color.clone(), right: this.edgeMat.right.color.clone() };
    this.edgeArmedBase = { left: this.edgeArmedMat.left.color.clone(), right: this.edgeArmedMat.right.color.clone() };
    const hm = (hex: number) => new MeshBasicMaterial({
      color: glow(hex, 1.2), transparent: true, opacity: 0.22, blending: AdditiveBlending,
      side: BackSide, depthWrite: false, fog: false,
    });
    this.haloBase = { left: hm(COLORS.left), right: hm(COLORS.right) };
    for (let i = 0; i < POOL; i++) {
      const body = new Mesh(this.bodyGeo, this.bodyMat.left);
      const edges = new LineSegments(this.edgeGeo, this.edgeMat.left);
      const face = new Mesh(this.faceGeo);
      face.position.z = SIZE / 2 + 0.003;
      const group = new Group();
      const haloMat = this.haloBase.left.clone(); // свой материал на слот: прозрачность зависит от z
      const halo = new Mesh(this.haloGeo, haloMat);
      halo.visible = this.haloOn;
      const frame = new LineSegments(this.frameGeo, this.frameMat);
      frame.visible = false;
      group.add(body, edges, face, halo, frame);
      group.visible = false;
      this.group.add(group);
      const dummy: Note = { id: -1, time: 0, hand: 'left', dir: 'any', lane: 0, row: 0 };
      this.free.push({ group, body, edges, face, halo, haloMat, frame, armed: false, cube: { note: dummy, z: 0, x: 0, y: 0, half: SIZE / 2 } });
    }
  }

  private getFaceMat(hand: Hand, dir: Dir8): MeshBasicMaterial {
    const key = `${hand}${dir}`;
    let m = this.faceMat.get(key);
    if (!m) {
      m = new MeshBasicMaterial({ map: makeFaceTexture(dir), toneMapped: false });
      this.faceMat.set(key, m);
    }
    return m;
  }

  spawn(note: Note): boolean {
    const s = this.free.pop();
    if (!s) return false;
    const c = s.cube;
    c.note = note;
    c.x = LANE_X[note.lane] ?? 0;
    c.y = ROW_Y[note.row] ?? 0;
    c.z = CUBE_SPAWN_Z;
    s.body.material = this.bodyMat[note.hand];
    s.edges.material = this.edgeMat[note.hand];
    s.face.material = this.getFaceMat(note.hand, note.dir);
    s.haloMat.color.copy(this.haloBase[note.hand].color);
    s.haloMat.opacity = HALO_OPACITY;
    s.halo.visible = this.haloOn;
    s.armed = false;
    s.frame.visible = false;
    s.group.position.set(c.x, c.y, c.z);
    s.group.visible = true;
    this.byId.set(note.id, s);
    this.active.push(c);
    return true;
  }

  update(songTime: number): void {
    const bp = fxState.beatPulse;
    const sc = 1 + 0.06 * bp;
    const eb = 1 + 0.6 * bp;
    for (const h of HANDS) {
      this.edgeMat[h].color.copy(this.edgeBase[h]).multiplyScalar(eb);
      this.edgeArmedMat[h].color.copy(this.edgeArmedBase[h]).multiplyScalar(eb);
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      c.z = (songTime - c.note.time) * CUBE_SPEED;
      if (c.z > CULL_Z) { this.remove(c.note.id); continue; }
      const s = this.byId.get(c.note.id)!;
      s.group.position.z = c.z;
      s.group.scale.setScalar(sc);
      if (this.haloOn) {
        const k = Math.min(1, Math.max(0, (HALO_FADE_NEAR - c.z) / (HALO_FADE_NEAR - HALO_FADE_FAR)));
        s.haloMat.opacity = HALO_OPACITY * k;
        s.halo.visible = k > 0.01;
      }
    }
  }

  /** Возвращает данные куба (объект переиспользуется — читать сразу). */
  remove(id: number): ActiveCube | null {
    const s = this.byId.get(id);
    if (!s) return null;
    this.byId.delete(id);
    const i = this.active.indexOf(s.cube);
    if (i >= 0) this.active.splice(i, 1);
    s.armed = false;
    s.frame.visible = false;
    s.group.visible = false;
    this.free.push(s);
    return s.cube;
  }

  setArmed(id: number, armed: boolean): void {
    const s = this.byId.get(id);
    if (!s || s.armed === armed) return;
    s.armed = armed;
    const h = s.cube.note.hand;
    s.edges.material = armed ? this.edgeArmedMat[h] : this.edgeMat[h];
    s.frame.visible = armed;
  }

  /** Дешёвое свечение вместо bloom. */
  setHalo(on: boolean): void {
    this.haloOn = on;
    for (const s of this.free) s.halo.visible = on;
    for (const s of this.byId.values()) s.halo.visible = on;
  }

  /** Прогрев: показывает кубы всех рук/направлений (armed и нет) в кадре; возвращает функцию отката. */
  warmShow(z: number): () => void {
    const used: Slot[] = [];
    const hands: Hand[] = ['left', 'right'];
    const dirs: Dir8[] = [0, 1, 2, 3, 4, 5, 6, 7, 'any'];
    let n = 0;
    for (const hand of hands) {
      for (const dir of dirs) {
        const s = this.free.pop();
        if (!s) break;
        used.push(s);
        s.body.material = this.bodyMat[hand];
        s.face.material = this.getFaceMat(hand, dir);
        const armed = n % 2 === 0;
        s.edges.material = armed ? this.edgeArmedMat[hand] : this.edgeMat[hand];
        s.frame.visible = armed;
        s.haloMat.opacity = HALO_OPACITY;
        s.halo.visible = true;
        s.group.position.set(((n % 6) - 2.5) * 0.7, 0.6 + Math.floor(n / 6) * 0.7, z);
        s.group.visible = true;
        n++;
      }
    }
    return () => {
      for (const s of used) {
        s.group.visible = false;
        s.frame.visible = false;
        s.halo.visible = this.haloOn;
        this.free.push(s);
      }
    };
  }

  getActive(): ActiveCube[] { return this.active; }
}
