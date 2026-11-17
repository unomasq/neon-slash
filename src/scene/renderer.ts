import {
  Color, Fog, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { COLORS, CUBE_SPEED } from '../config';
import { fx, fxState } from '../fx/bus';
import { getSetting } from '../game/storage';
import type { Hand, Note, Vec2 } from '../types';
import { CubePool, type ActiveCube } from './cubes';
import { Decor } from './decor';
import { Effects } from './effects';
import { Sabers } from './sabers';
import { CameraRig } from './cameraRig';
import { PostFx } from './postfx';
import { Palette } from './palette';
import { Dust } from './dust';
import { TunnelWave } from './tunnelWave';
import { HIT_BOX_PAD } from '../game/tuning';

export type { ActiveCube };

const BLOOM_BASE = 1.1;
const _pv = new Vector3();
const _cv = new Vector3();
const _po = { x: 0, y: 0 };

export class GameScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private cubes = new CubePool();
  private sabers = new Sabers();
  private effects = new Effects();
  private palette = new Palette();
  private decor = new Decor(this.palette);
  private dust = new Dust(this.palette);
  private wave = new TunnelWave(this.palette);
  private rig: CameraRig;
  private postfx = new PostFx();
  private lag = 0;
  private holdT = 0;
  private offs: Array<() => void> = [];
  private quality: 0 | 1 | 2 | 3 = 1;
  private lowSince = 0;
  private highSince = 0;
  private fps = 60;
  private lastRender = 0;
  private renderMs = 0;
  private drawCalls = 0;
  private warmed = false;
  private onResize = () => this.resize();

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: false, stencil: false, depth: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x05060d);
    this.scene.fog = new Fog(0x05060d, 14, 42);
    this.camera = new PerspectiveCamera(65, 1, 0.1, 100);
    this.camera.position.set(0, 1.2, 7);
    this.camera.lookAt(0, 0.6, -6);
    this.rig = new CameraRig(this.camera);

    this.scene.add(this.decor.group, this.cubes.group, this.effects.group, this.sabers.group, this.dust.object3d, this.wave.object3d);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(window.innerWidth / 2, window.innerHeight / 2), BLOOM_BASE, 0.4, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.postfx.pass);
    this.composer.addPass(new OutputPass());
    this.offs.push(fx.on('hit', (e) => {
      if (e.perfect) { this.lag = Math.min(0.06, this.lag + 0.05); this.holdT = 0.05; }
    }));
    this.setQuality(Math.min(this.qualityCeiling(), 2) as 0 | 1 | 2 | 3);
    window.addEventListener('resize', this.onResize);
    this.warmUp();
  }

  /** Прогрев шейдеров/текстур: один раз показывает по объекту каждого типа, компилирует и рендерит. Идемпотентно. */
  warmUp(): void {
    if (this.warmed) return;
    this.warmed = true;
    const undo = [
      this.cubes.warmShow(-3), this.effects.warmShow(-3), this.sabers.warmShow(),
    ];
    const bloomWas = this.bloom.enabled, pfWas = this.postfx.pass.enabled;
    try {
      this.renderer.compile(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera); // базовый путь (+ загрузка текстур граней)
      this.bloom.enabled = true;
      this.postfx.pass.enabled = true;
      this.composer.render(); // bloom + OutputPass
    } catch { /* прогрев не критичен */ }
    this.bloom.enabled = bloomWas;
    this.postfx.pass.enabled = pfWas;
    for (const u of undo) u();
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera); // очистить кадр от прогревочных объектов
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.bloom.setSize(w * pr / 2, h * pr / 2); // bloom в половинном разрешении (после composer.setSize)
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setSaber(hand: Hand, wrist: Vec2, tip: Vec2, visible: boolean): void {
    this.sabers.setSaber(hand, wrist, tip, visible);
  }

  update(songTime: number, dt: number): void {
    // хитстоп: визуальное время кубов отстаёт на lag; логика engine (z) остаётся от songTime
    if (this.holdT > 0) this.holdT -= dt;
    else if (this.lag > 0) { this.lag *= Math.exp(-dt / 0.025); if (this.lag < 0.001) this.lag = 0; }
    fxState.hitstop = this.lag;
    this.cubes.update(songTime - this.lag);
    if (this.lag > 0) {
      const act = this.cubes.getActive();
      for (let i = 0; i < act.length; i++) act[i].z = (songTime - act[i].note.time) * CUBE_SPEED;
    }
    const fdt = this.holdT > 0 ? dt * 0.1 : dt;
    this.rig.update(dt);
    this.sabers.update(dt);
    this.effects.update(fdt);
    this.palette.update(dt);
    (this.scene.fog as Fog).color.copy(this.palette.current.fog);
    (this.scene.background as Color).copy(this.palette.current.bg);
    this.decor.update(dt);
    this.dust.update(dt);
    this.wave.update(dt);
    this.postfx.update(dt, this.quality >= 2 ? this.bloom : null, BLOOM_BASE);
  }

  render(): void {
    const now = performance.now();
    if (this.lastRender > 0) {
      const d = now - this.lastRender;
      if (d > 0) this.fps += (1000 / d - this.fps) * 0.05;
    }
    this.lastRender = now;
    if (this.quality >= 2) this.composer.render();
    else this.renderer.render(this.scene, this.camera); // без bloom и OutputPass
    this.renderMs += (performance.now() - now - this.renderMs) * 0.05;
    this.drawCalls = this.renderer.info.render.calls;
  }

  spawnCube(note: Note): void { this.cubes.spawn(note); }

  setCubeArmed(id: number, armed: boolean): void { this.cubes.setArmed(id, armed); }

  getActiveCubes(): ActiveCube[] { return this.cubes.getActive(); }

  removeCube(id: number, kind: 'good' | 'bad' | 'miss', sliceDir?: Vec2): void {
    const c = this.cubes.remove(id);
    if (!c || kind === 'miss') return;
    const hex = COLORS[c.note.hand];
    this.effects.burst(c.x, c.y, c.z, hex, kind === 'bad', sliceDir);
  }

  getSaberSegment(hand: Hand): { a: Vector3; b: Vector3 } { return this.sabers.getSegment(hand); }

  getAspect(): number { return this.camera.aspect; }

  /** Проекция мировой точки в экранные единицы: x = NDC.x*aspect, y = NDC.y. */
  projectToScreen(v: Vector3, out: { x: number; y: number }): void {
    _pv.copy(v).applyMatrix4(this.camera.matrixWorldInverse).applyMatrix4(this.camera.projectionMatrix);
    out.x = _pv.x * this.camera.aspect;
    out.y = _pv.y;
  }

  /** Экранный бокс куба (8 углов AABB, полуразмер half+HIT_BOX_PAD) в экранных единицах. */
  getCubeScreenBox(cube: ActiveCube, out: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const r = cube.half + HIT_BOX_PAD;
    out.minX = out.minY = Infinity; out.maxX = out.maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      _cv.set(cube.x + (i & 1 ? r : -r), cube.y + (i & 2 ? r : -r), cube.z + (i & 4 ? r : -r));
      this.projectToScreen(_cv, _po);
      if (_po.x < out.minX) out.minX = _po.x;
      if (_po.x > out.maxX) out.maxX = _po.x;
      if (_po.y < out.minY) out.minY = _po.y;
      if (_po.y > out.maxY) out.maxY = _po.y;
    }
  }

  setQuality(level: 0 | 1 | 2 | 3): void {
    this.quality = level;
    fxState.quality = level;
    const post = level >= 2;
    this.bloom.enabled = post;
    this.postfx.pass.enabled = post;
    this.postfx.aberrationOn = level === 3;
    const halo = level <= 1;
    this.cubes.setHalo(halo);
    this.sabers.setHalo(halo);
    this.effects.setSparks(level > 0);
    this.dust.setQuality(level);
    this.renderer.setPixelRatio(level === 3 ? Math.min(window.devicePixelRatio, 1.5) : 1);
    this.resize();
  }

  private qualityCeiling(): 1 | 2 | 3 {
    const v = getSetting<string>('fxLevel', 'max');
    return v === 'min' ? 1 : v === 'norm' ? 2 : 3;
  }

  /** Автокачество: -1 при fps<50 в течение 2 с, +1 при fps>=58 в течение 8 с, не выше потолка настройки. */
  updateAutoQuality(now: number): void {
    const cap = this.qualityCeiling();
    if (this.quality > cap) { this.setQuality(cap); this.lowSince = this.highSince = 0; return; }
    if (this.fps < 50) {
      this.highSince = 0;
      if (!this.lowSince) this.lowSince = now;
      else if (now - this.lowSince >= 2000 && this.quality > 0) {
        this.setQuality((this.quality - 1) as 0 | 1 | 2 | 3);
        this.lowSince = 0; this.fps = 54;
      }
    } else if (this.fps >= 58 && this.quality < cap) {
      this.lowSince = 0;
      if (!this.highSince) this.highSince = now;
      else if (now - this.highSince >= 8000) {
        this.setQuality((this.quality + 1) as 0 | 1 | 2 | 3);
        this.highSince = 0; this.fps = 54;
      }
    } else { this.lowSince = 0; this.highSince = 0; }
  }

  playIntro(duration: number): void { this.rig.playIntro(duration); }

  getFps(): number { return this.fps; }

  getStats(): { renderMs: number; drawCalls: number } {
    return { renderMs: this.renderMs, drawCalls: this.drawCalls };
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.scene.traverse((o) => {
      const m = o as unknown as { geometry?: { dispose(): void }; material?: unknown };
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats as { map?: { dispose(): void } | null; dispose(): void }[]) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
    for (const o of this.offs) o();
    this.rig.dispose(); this.postfx.dispose(); this.effects.dispose();
    this.decor.dispose(); this.dust.dispose(); this.wave.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
