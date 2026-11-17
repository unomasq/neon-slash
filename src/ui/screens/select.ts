import { buildBeatmap, trackDuration, type TrackDef } from '../../audio';
import { getBest } from '../../game/storage';
import type { Difficulty } from '../../types';
import { TRACKS } from '../../audio/tracks';
import { BaseScreen, q } from './base';
import type { App } from '../app';

const DESC: Record<Difficulty, string> = {
  easy: 'Легко: одна рука, без стрелок',
  normal: 'Нормально: две руки, без стрелок',
  hard: 'Сложно: стрелки и быстрые кубы',
};
const LABEL: Record<Difficulty, string> = { easy: 'Легко', normal: 'Нормально', hard: 'Сложно' };

function fmt(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class SelectScreen extends BaseScreen {
  private list: HTMLElement;
  private desc: HTMLElement;
  private practice: HTMLInputElement;
  private dev: { state: 'idle' | 'loading' | 'ready' | 'error'; pct: number; def: TrackDef | null } = { state: 'idle', pct: 0, def: null };

  private loadDev(): void {
    if (!import.meta.env.DEV) return;
    if (this.dev.state === 'loading') return;
    this.dev = { state: 'loading', pct: 0, def: null };
    this.refresh();
    this.app.loadDevTrack((p) => { this.dev.pct = Math.round(p * 100); this.refresh(); })
      .then((def) => { this.dev = { state: 'ready', pct: 100, def }; this.app.selection.track = def; this.refresh(); })
      .catch((e) => { console.error(e); this.dev = { state: 'error', pct: 0, def: null }; this.refresh(); });
  }

  private devCard(): HTMLElement {
    if (!import.meta.env.DEV) throw new Error('dev only');
    const sel = this.app.selection;
    const d = this.dev.def;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'track' + (d && sel.track === d ? ' on' : '');
    const name = document.createElement('div');
    name.className = 'track-name';
    name.textContent = 'Enemy (тест)';
    const sub = document.createElement('div');
    sub.className = 'track-sub';
    sub.textContent = 'Локальный mp3, только для разработки';
    const meta = document.createElement('div');
    meta.className = 'track-meta';
    if (this.dev.state === 'loading') meta.textContent = `Анализирую… ${this.dev.pct}%`;
    else if (this.dev.state === 'error') meta.textContent = 'Не удалось загрузить или проанализировать. Нажми, чтобы повторить';
    else if (d) meta.textContent = `BPM ${d.bpm}, кубов: ${buildBeatmap(d, sel.difficulty).notes.length}`;
    else meta.textContent = 'Нажми, чтобы загрузить и проанализировать';
    card.append(name, sub, meta);
    card.addEventListener('click', () => { if (d) { sel.track = d; this.refresh(); } else this.loadDev(); });
    return card;
  }

  constructor(app: App) {
    super(app, 'overlay-layer', `
      <div class="card select-card">
        <h2>Выбери трек</h2>
        <div class="track-list"></div>
        <div class="seg"></div>
        <p class="diff-desc"></p>
        <label class="row check"><input type="checkbox" class="sel-practice" /> Тренировка (без музыки)</label>
        <div class="k-btns">
          <button type="button" class="btn big sel-go">Поехали</button>
          <button type="button" class="btn small sel-back">Назад</button>
        </div>
      </div>`);
    this.list = q(this.root, '.track-list');
    this.desc = q(this.root, '.diff-desc');
    this.practice = q(this.root, '.sel-practice');
    const seg = q(this.root, '.seg');
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.dataset.d = d;
      b.textContent = LABEL[d];
      b.addEventListener('click', () => { app.setDifficulty(d); this.refresh(); });
      seg.appendChild(b);
    }
    q(this.root, '.sel-go').addEventListener('click', () => {
      this.app.selection.practice = this.practice.checked;
      void this.app.startGame();
    });
    q(this.root, '.sel-back').addEventListener('click', () => app.go('main'));
  }

  show(): void {
    super.show();
    this.practice.checked = this.app.selection.practice;
    this.refresh();
  }

  private refresh(): void {
    const sel = this.app.selection;
    this.root.querySelectorAll<HTMLElement>('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.d === sel.difficulty));
    this.desc.textContent = DESC[sel.difficulty];
    this.list.replaceChildren();
    for (const t of TRACKS) {
      const best = getBest(t.id, sel.difficulty);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'track' + (t.id === sel.track.id ? ' on' : '');
      const stars = t.difficultyStars ? '★'.repeat(t.difficultyStars) + '☆'.repeat(Math.max(0, 5 - t.difficultyStars)) : '';
      const name = document.createElement('div');
      name.className = 'track-name';
      name.textContent = t.name;
      const sub = document.createElement('div');
      sub.className = 'track-sub';
      sub.textContent = t.subtitle ?? t.style;
      const meta = document.createElement('div');
      meta.className = 'track-meta';
      meta.textContent = `${stars} ${stars ? '· ' : ''}${fmt(trackDuration(t))} · ${t.bpm} bpm`;
      const bst = document.createElement('div');
      bst.className = 'track-best';
      bst.textContent = best ? `Рекорд: ${best.score} (${Math.round(best.accuracy * 100)}%)` : 'Рекорда пока нет';
      card.append(name, sub, meta, bst);
      card.addEventListener('click', () => { sel.track = t; this.refresh(); });
      this.list.appendChild(card);
    }
    if (import.meta.env.DEV) this.list.appendChild(this.devCard());
  }
}
