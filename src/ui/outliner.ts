/**
 * The outliner: groups as expandable nodes, then loose parts under their stock. Click
 * selects (a group row selects all its members), Shift or Ctrl extends, double-click
 * or F2 renames, the eye hides or shows, and hovering a part row highlights it in the
 * view (and the view's selection highlights the rows).
 */
import { createElement, ChevronDown, ChevronRight, Eye, EyeOff, Boxes } from 'lucide';
import { partDims, type Group, type Part } from '../model';
import { getStock, stockById } from '../stock';
import type { Store } from '../store';
import type { ListTarget } from './menu';
import { DRAG_TYPE } from './palette';
import { fmt } from '../units';
import { hex } from './dom';

export interface HoverTarget {
  hover(id: number | null): void;
  /** The centre-between tool is waiting for a part: a row click picks it instead. */
  readonly centering: boolean;
  pickCenterBetween(id: number): void;
}

type Renaming = { kind: 'part' | 'group'; id: number } | null;

/** Drag data for rows: the part ids, or the group id, being moved. */
const PARTS_TYPE = 'application/x-lumber-parts';
const GROUP_TYPE = 'application/x-lumber-group';

/** What a drag carries, read from its types. */
type Dragged =
  { kind: 'parts'; ids: number[] } | { kind: 'group'; id: number } | { kind: 'stock'; id: string };

function readDrag(dt: DataTransfer | null): Dragged | null {
  if (!dt) return null;
  if (dt.types.includes(PARTS_TYPE))
    return { kind: 'parts', ids: JSON.parse(dt.getData(PARTS_TYPE) || '[]') as number[] };
  if (dt.types.includes(GROUP_TYPE)) return { kind: 'group', id: Number(dt.getData(GROUP_TYPE)) };
  if (dt.types.includes(DRAG_TYPE)) return { kind: 'stock', id: dt.getData(DRAG_TYPE) };
  return null;
}

function canDrop(dt: DataTransfer | null): boolean {
  return !!dt && [PARTS_TYPE, GROUP_TYPE, DRAG_TYPE].some((t) => dt.types.includes(t));
}

/** The context-menu key, or Shift+F10, on a focused row. */
function isMenuKey(e: KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

/** Where a keyboard-opened menu goes: just inside the row's left edge. */
function rowPoint(el: HTMLElement): [number, number] {
  const r = el.getBoundingClientRect();
  return [r.left + 24, r.bottom - 4];
}

export class OutlinerPanel {
  /** Set by the app: open a menu for a row at a screen point. */
  onContextMenu: ((x: number, y: number, target: ListTarget) => void) | null = null;
  private filter = '';
  private renaming: Renaming = null;
  /** The part row last clicked without Shift: where a Shift+click's run starts. */
  private anchor: number | null = null;
  private collapsed = new Set<number>();

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
    // Dropping on the list's background, or a stock heading, takes parts out of their
    // group, and adds dragged stock as a loose part.
    body.addEventListener('dragover', (e) => {
      if (!canDrop(e.dataTransfer)) return;
      e.preventDefault();
      body.classList.add('drop-loose');
    });
    body.addEventListener('dragleave', (e) => {
      if (e.target === body) body.classList.remove('drop-loose');
    });
    body.addEventListener('drop', (e) => {
      body.classList.remove('drop-loose');
      if (e.defaultPrevented) return;
      e.preventDefault();
      this.dropOn(readDrag(e.dataTransfer), undefined);
    });
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
    const focusedKey =
      active && body.contains(active)
        ? active.closest<HTMLElement>('.out-row')?.dataset.key
        : undefined;
    body.textContent = '';
    const hidden = store.parts.filter((p) => p.hidden).length;
    this.countEl.textContent = `${store.parts.length}${hidden ? ` · ${hidden} hidden` : ''}`;
    if (!store.parts.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No parts yet.';
      body.appendChild(e);
      return;
    }
    let shown = 0;
    for (const g of this.sortedGroups(undefined)) shown += this.renderGroup(g, 0);
    const loose = store.parts.filter((p) => p.group === undefined && this.matches(p));
    for (const s of getStock()) {
      const group = this.sortParts(loose.filter((p) => p.stock === s.id));
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
      for (const p of group) body.appendChild(this.partRow(p, 0));
      shown += group.length;
    }
    if (!shown) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No part matches the filter.';
      body.appendChild(e);
    }
    body.querySelector('.out-row.selected')?.scrollIntoView({ block: 'nearest' });
    if (focusedKey !== undefined && this.renaming === null)
      body.querySelector<HTMLElement>(`.out-row[data-key="${focusedKey}"]`)?.focus();
  }

  private sortParts(list: Part[]): Part[] {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  private sortedGroups(parent: number | undefined): Group[] {
    return [...this.store.childGroups(parent)].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }

  /** Render a group node and its contents; returns how many part rows were shown. */
  private renderGroup(g: Group, depth: number): number {
    const { store, body } = this;
    const members = store.membersOf(g.id);
    const visible = members.filter((p) => this.matches(p));
    if (this.filter && !visible.length && !g.name.toLowerCase().includes(this.filter)) return 0;
    const open = !this.collapsed.has(g.id);
    const allSelected = members.length > 0 && members.every((p) => store.selected.has(p.id));
    const allHidden = members.length > 0 && members.every((p) => p.hidden);

    const el = document.createElement('div');
    el.className = 'out-row group';
    el.dataset.key = `g${g.id}`;
    el.style.paddingLeft = `${6 + depth * 14}px`;
    if (allSelected) el.classList.add('selected');
    if (allHidden) el.classList.add('hidden-part');
    el.tabIndex = 0;

    const chev = document.createElement('button');
    chev.className = 'chev';
    chev.type = 'button';
    chev.title = open ? 'Collapse' : 'Expand';
    chev.appendChild(createElement(open ? ChevronDown : ChevronRight, { width: 14, height: 14 }));
    chev.addEventListener('click', (e) => {
      e.stopPropagation();
      if (open) this.collapsed.add(g.id);
      else this.collapsed.delete(g.id);
      this.render();
    });
    const icon = document.createElement('span');
    icon.className = 'gicon';
    icon.appendChild(createElement(Boxes, { width: 14, height: 14 }));

    const name = document.createElement('span');
    name.className = 'name';
    if (this.renaming?.kind === 'group' && this.renaming.id === g.id)
      name.appendChild(this.renameInput(g.name, (v) => store.renameGroup(g.id, v)));
    else name.textContent = g.name;

    const count = document.createElement('span');
    count.className = 'size';
    count.textContent = g.array
      ? `array · ${members.length} part${members.length === 1 ? '' : 's'}`
      : `${members.length} part${members.length === 1 ? '' : 's'}`;

    const eye = this.eyeButton(allHidden, () =>
      store.setHidden(
        members.map((p) => p.id),
        !allHidden,
      ),
    );
    el.append(chev, icon, name, count, eye);
    const ids = members.filter((p) => !p.hidden).map((p) => p.id);
    el.addEventListener('click', (e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) store.toggleSelectMany(ids);
      else store.select(ids);
    });
    el.addEventListener('dblclick', () => this.startRename({ kind: 'group', id: g.id }));
    const menu = (x: number, y: number) => {
      if (!allSelected) store.select(ids);
      this.onContextMenu?.(x, y, { kind: 'group', id: g.id });
    };
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') store.select(ids);
      else if (e.key === 'F2') this.startRename({ kind: 'group', id: g.id });
      else if (isMenuKey(e)) menu(...rowPoint(el));
      else if (e.key === 'ArrowLeft') this.collapsed.add(g.id);
      else if (e.key === 'ArrowRight') this.collapsed.delete(g.id);
      else return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key.startsWith('Arrow')) this.render();
    });
    el.addEventListener('mouseenter', () => this.view.hover(null));
    this.wireDrag(el, { kind: 'group', id: g.id }, () => [GROUP_TYPE, String(g.id)]);
    body.appendChild(el);

    let shown = 0;
    if (open) {
      for (const child of this.sortedGroups(g.id)) shown += this.renderGroup(child, depth + 1);
      const direct = this.sortParts(store.parts.filter((p) => p.group === g.id && this.matches(p)));
      for (const p of direct) body.appendChild(this.partRow(p, depth + 1));
      shown += direct.length;
    }
    return shown + (open ? 0 : visible.length);
  }

  private partRow(p: Part, depth: number): HTMLElement {
    const { store, view } = this;
    const el = document.createElement('div');
    el.className = 'out-row';
    el.dataset.key = `p${p.id}`;
    el.style.paddingLeft = `${6 + depth * 14 + (depth ? 18 : 0)}px`;
    if (store.selected.has(p.id)) el.classList.add('selected');
    if (p.hidden) el.classList.add('hidden-part');
    el.tabIndex = 0;

    const name = document.createElement('span');
    name.className = 'name';
    if (this.renaming?.kind === 'part' && this.renaming.id === p.id)
      name.appendChild(this.renameInput(p.name, (v) => store.renamePart(p.id, v)));
    else name.textContent = p.name;

    const size = document.createElement('span');
    size.className = 'size';
    const d = partDims(p);
    const s = stockById(p.stock);
    size.textContent = depth
      ? `${s.name} · ${s.sheet ? `${fmt(d[1])} × ` : ''}${fmt(d[0])}`
      : s.sheet
        ? `${fmt(d[1])} × ${fmt(d[0])}`
        : fmt(d[0]);

    const eye = this.eyeButton(!!p.hidden, () => store.setHidden([p.id], !p.hidden));
    el.append(name, size, eye);
    el.addEventListener('click', (e) => {
      if (p.hidden) return;
      if (view.centering) {
        view.pickCenterBetween(p.id);
        return;
      }
      if (e.shiftKey && this.anchor !== null && this.anchor !== p.id) {
        store.select(new Set([...store.selected, ...this.rowsBetween(this.anchor, p.id)]));
        return;
      }
      this.anchor = p.id;
      if (e.ctrlKey || e.metaKey || e.shiftKey) store.toggleSelect(p.id);
      else store.select([p.id]);
    });
    el.addEventListener('dblclick', () => this.startRename({ kind: 'part', id: p.id }));
    const menu = (x: number, y: number) => {
      if (!p.hidden && !store.selected.has(p.id)) store.select([p.id]);
      this.onContextMenu?.(x, y, { kind: 'part', id: p.id });
    };
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') store.select([p.id]);
      else if (e.key === 'F2') this.startRename({ kind: 'part', id: p.id });
      else if (isMenuKey(e)) menu(...rowPoint(el));
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('mouseenter', () => view.hover(p.hidden ? null : p.id));
    // A selected row drags the whole selection; any other row drags just itself.
    this.wireDrag(el, { kind: 'part', id: p.id }, () => [
      PARTS_TYPE,
      JSON.stringify(store.selected.has(p.id) ? [...store.selected] : [p.id]),
    ]);
    return el;
  }

  private eyeButton(hidden: boolean, onClick: () => void): HTMLButtonElement {
    const eye = document.createElement('button');
    eye.className = 'eye';
    eye.type = 'button';
    eye.title = hidden ? 'Show' : 'Hide';
    eye.appendChild(createElement(hidden ? EyeOff : Eye, { width: 14, height: 14 }));
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return eye;
  }

  /** The visible part rows from one part to another, in the order the list shows them. */
  private rowsBetween(fromId: number, toId: number): number[] {
    const ids: number[] = [];
    for (const el of this.body.querySelectorAll<HTMLElement>('.out-row:not(.group)')) {
      const key = el.dataset.key ?? '';
      if (!key.startsWith('p') || el.classList.contains('hidden-part')) continue;
      ids.push(Number(key.slice(1)));
    }
    const a = ids.indexOf(fromId);
    const b = ids.indexOf(toId);
    if (a < 0 || b < 0) return [toId];
    return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  /** What a drop means: into a group (or none), or onto a part. */
  private dropOn(d: Dragged | null, onto: ListTarget | undefined): void {
    const { store } = this;
    if (!d) return;
    const intoGroup = onto?.kind === 'group' ? onto.id : undefined;
    const ontoPart = onto?.kind === 'part' ? store.partById(onto.id) : undefined;
    if (d.kind === 'stock') {
      const p = store.addPartLikeSelection(d.id);
      const g = intoGroup ?? ontoPart?.group;
      if (g !== undefined) store.moveToGroup([p.id], g);
      return;
    }
    if (d.kind === 'group') {
      if (onto?.kind === 'part') return;
      store.reparentGroup(d.id, intoGroup);
      return;
    }
    const ids = d.ids.filter((id) => id !== ontoPart?.id);
    if (!ids.length) return;
    if (ontoPart && ontoPart.group === undefined) {
      // Dropped on a loose part: the two (or more) become a new group.
      store.select([...ids, ontoPart.id]);
      store.groupSelected();
      return;
    }
    store.moveToGroup(ids, ontoPart ? ontoPart.group : intoGroup);
  }

  /** Make a row a drag source and a drop target. */
  private wireDrag(el: HTMLElement, target: ListTarget, dragData: () => [string, string]): void {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      const [type, data] = dragData();
      e.dataTransfer.setData(type, data);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      if (!canDrop(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer)
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_TYPE) ? 'copy' : 'move';
      el.classList.add('drop-into');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-into'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-into');
      this.body.classList.remove('drop-loose');
      this.dropOn(readDrag(e.dataTransfer), target);
    });
  }

  /** Start renaming a row in place, as F2 does. */
  rename(target: ListTarget): void {
    this.startRename(target);
  }

  private startRename(target: Renaming): void {
    this.renaming = target;
    this.render();
  }

  private renameInput(value: string, commit: (v: string) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.maxLength = 60;
    const done = (ok: boolean) => {
      if (!this.renaming) return;
      this.renaming = null;
      if (ok) commit(input.value);
      else this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }
}
