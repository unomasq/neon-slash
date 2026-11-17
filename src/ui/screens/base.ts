import type { App } from '../app';

export function q<T extends HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`${sel} not found`);
  return el;
}

/** Базовый экран: корневой div поверх сцены, show()/hide() */
export abstract class BaseScreen {
  protected app: App;
  protected root: HTMLElement;

  constructor(app: App, cls: string, html: string) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.className = `screen ${cls}`;
    this.root.hidden = true;
    this.root.innerHTML = html;
    document.getElementById('ui')!.appendChild(this.root);
  }

  show(): void { this.root.hidden = false; }
  hide(): void { this.root.hidden = true; }
}
