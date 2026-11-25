/**
 * The outliner: every part as a row, grouped by stock. Click selects, Shift or Ctrl
 * extends, double-click renames, the eye hides or shows, and hovering a row highlights
 * the part in the view (and the view's selection highlights the rows).
 */
import { createElement, Eye, EyeOff } from 'lucide';
import { partDims, type Part } from '../model';
import { STOCK, stockById } from '../stock';
import type { Store } from '../store';
import { fmt } from '../units';
import { hex } from './dom';

export interface HoverTarget {
  hover(id: number | null): void;
}

export class OutlinerPanel {
  private filter = '';
  private renaming: number | null = null;

  constructor(
    private body: HTMLElement,
    private countEl: HTMLElement,
    filterEl: HTMLInputElement,
    private store: Store,
    private view: HoverTarget,
  ) {
    filterEl.addEventListener('input', () => {
      this.filter = filterEl.value.trim().toLowerCase();
      this.render();
    });
    body.addEventListener('mouseleave', () => view.hover(null));
    store.subscribe((kind) => {
      if (kind !== 'drag') this.render();
    });
    this.render();
  }

  private matches(p: Part): boolean {
    if (!this.filter) return true;
    return (
      p.name.toLowerCase().includes(this.filter) ||
      stockById(p.stock).name.toLowerCase().includes(this.filter)
    );
  }

  render(): void {
    const { store, body } = this;
    // Rebuilding the rows would drop keyboard focus; remember which row had it.
    const active = document.activeElement as HTMLElement | null;
    const focusedId =
      active && body.contains(active)
        ? active.closest<HTMLElement>('.out-row')?.dataset.id
        : undefined;
    body.textContent = '';
    const parts = store.parts.filter((p) => this.matches(p));
    const hidden = store.parts.filter((p) => p.hidden).length;
    this.countEl.textContent = `${store.parts.length}${hidden ? ` · ${hidden} hidden` : ''}`;
    if (!parts.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = store.parts.length ? 'No part matches the filter.' : 'No parts yet.';
      body.appendChild(e);
      return;
    }
    for (const s of STOCK) {
      const group = parts
        .filter((p) => p.stock === s.id)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!group.length) continue;
      const h = document.createElement('div');
      h.className = 'out-group';
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = hex(s.color);
      const nm = document.createElement('span');
      nm.textContent = s.name;
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(group.length);
      h.append(sw, nm, n);
      body.appendChild(h);
      for (const p of group) body.appendChild(this.row(p));
    }
    const sel = body.querySelector('.out-row.selected');
    sel?.scrollIntoView({ block: 'nearest' });
    if (focusedId !== undefined && this.renaming === null)
      body.querySelector<HTMLElement>(`.out-row[data-id="${focusedId}"]`)?.focus();
  }

  private row(p: Part): HTMLElement {
    const { store, view } = this;
    const el = document.createElement('div');
    el.className = 'out-row';
    el.dataset.id = String(p.id);
    if (store.selected.has(p.id)) el.classList.add('selected');
    if (p.hidden) el.classList.add('hidden-part');
    el.tabIndex = 0;

    const name = document.createElement('span');
    name.className = 'name';
    if (this.renaming === p.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = p.name;
      input.maxLength = 60;
      const done = (commit: boolean) => {
        if (this.renaming !== p.id) return;
        this.renaming = null;
        if (commit) store.renamePart(p.id, input.value);
        else this.render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
        else if (e.key === 'Escape') done(false);
        e.stopPropagation();
      });
      input.addEventListener('blur', () => done(true));
      input.addEventListener('click', (e) => e.stopPropagation());
      name.appendChild(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    } else name.textContent = p.name;

    const size = document.createElement('span');
    size.className = 'size';
    const d = partDims(p);
    const s = stockById(p.stock);
    size.textContent = s.sheet ? `${fmt(d[1])} × ${fmt(d[0])}` : fmt(d[0]);

    const eye = document.createElement('button');
    eye.className = 'eye';
    eye.type = 'button';
    eye.title = p.hidden ? 'Show' : 'Hide';
    eye.appendChild(createElement(p.hidden ? EyeOff : Eye, { width: 14, height: 14 }));
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      store.setHidden([p.id], !p.hidden);
    });

    el.append(name, size, eye);
    el.addEventListener('click', (e) => {
      if (p.hidden) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) store.toggleSelect(p.id);
      else store.select([p.id]);
    });
    el.addEventListener('dblclick', () => {
      this.renaming = p.id;
      this.render();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') store.select([p.id]);
      else if (e.key === 'F2') {
        this.renaming = p.id;
        this.render();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('mouseenter', () => view.hover(p.hidden ? null : p.id));
    return el;
  }
}
