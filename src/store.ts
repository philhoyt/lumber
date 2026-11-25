/**
 * Application state: the parts, their groups, the selection, settings, and undo/redo.
 * Every change to parts goes through `mutate`, which snapshots the model first so it
 * can be undone, then autosaves and tells subscribers.
 */
import {
  alignParts,
  clonePart,
  createPart,
  dropDistance,
  migrateFromYUp,
  rotateParts,
  translateParts,
  AXIS_INDEX,
  type AlignMode,
  type Axis,
  type AxisIndex,
  type Group,
  type Part,
  type Vec3,
} from './model';

export interface Settings {
  grid: number;
  snapParts: boolean;
  kerf: number;
  /** Chosen purchase length per board stock id. */
  stockLen: Record<string, number>;
  /** Price overrides per stock id. */
  prices: Record<string, number>;
}

/** The saved file format. Version 1 was Y-up; version 2 is Z-up and may carry groups. */
export interface Document {
  version: 2;
  parts: Part[];
  groups?: Group[];
  stockLen?: Record<string, number>;
  prices?: Record<string, number>;
}

export type ChangeKind = 'model' | 'selection' | 'settings' | 'drag';
export type Listener = (kind: ChangeKind) => void;

const AUTOSAVE_KEY = 'lumber.autosave.v2';

interface Snapshot {
  parts: Part[];
  groups?: Group[];
  nextId: number;
  nextGroupId?: number;
}

export class Store {
  parts: Part[] = [];
  groups: Group[] = [];
  nextId = 1;
  nextGroupId = 1;
  selected = new Set<number>();
  settings: Settings = { grid: 0.5, snapParts: true, kerf: 0.125, stockLen: {}, prices: {} };

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify(kind: ChangeKind): void {
    for (const fn of this.listeners) fn(kind);
  }

  // ---- undo / redo ----
  snapshot(): string {
    const s: Snapshot = {
      parts: this.parts,
      groups: this.groups,
      nextId: this.nextId,
      nextGroupId: this.nextGroupId,
    };
    return JSON.stringify(s);
  }
  restore(s: string): void {
    const o = JSON.parse(s) as Snapshot;
    this.parts = o.parts;
    this.groups = o.groups ?? [];
    this.nextId = o.nextId;
    this.nextGroupId = o.nextGroupId ?? Math.max(0, ...this.groups.map((g) => g.id)) + 1;
    this.selected = new Set(
      [...this.selected].filter((id) => this.parts.some((p) => p.id === id && !p.hidden)),
    );
    this.notify('model');
  }
  /** Record `before` as the undo point for a change that has already been applied. */
  commit(before: string): void {
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.autosave();
    this.notify('model');
  }
  mutate(fn: () => void): void {
    const before = this.snapshot();
    fn();
    this.pruneGroups();
    this.commit(before);
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  undo(): void {
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.autosave();
  }
  redo(): void {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.autosave();
  }
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  // ---- selection ----
  select(ids: Iterable<number>): void {
    this.selected = new Set([...ids].filter((id) => !this.partById(id)?.hidden));
    this.notify('selection');
  }
  toggleSelect(id: number): void {
    this.toggleSelectMany([id]);
  }
  /** Add the ids to the selection, or remove them all if every one is already selected. */
  toggleSelectMany(ids: Iterable<number>): void {
    const list = [...ids];
    const s = new Set(this.selected);
    if (list.every((id) => s.has(id))) list.forEach((id) => s.delete(id));
    else list.forEach((id) => s.add(id));
    this.select(s);
  }
  selectAll(): void {
    this.select(this.visibleParts().map((p) => p.id));
  }
  selectedParts(): Part[] {
    return this.parts.filter((p) => this.selected.has(p.id));
  }
  visibleParts(): Part[] {
    return this.parts.filter((p) => !p.hidden);
  }
  partById(id: number): Part | undefined {
    return this.parts.find((p) => p.id === id);
  }

  // ---- groups ----
  groupById(id: number): Group | undefined {
    return this.groups.find((g) => g.id === id);
  }
  /** The outermost group a part belongs to, or undefined when it is loose. */
  rootGroupOf(partId: number): Group | undefined {
    let g = this.groupById(this.partById(partId)?.group ?? -1);
    while (g?.parent !== undefined) {
      const parent = this.groupById(g.parent);
      if (!parent) break;
      g = parent;
    }
    return g;
  }
  /** Groups directly inside a group (or, with undefined, the top-level groups). */
  childGroups(parent: number | undefined): Group[] {
    return this.groups.filter((g) => g.parent === parent);
  }
  /** Every part inside a group, including those in nested groups. */
  membersOf(groupId: number): Part[] {
    const ids = new Set<number>([groupId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of this.groups)
        if (g.parent !== undefined && ids.has(g.parent) && !ids.has(g.id)) {
          ids.add(g.id);
          grew = true;
        }
    }
    return this.parts.filter((p) => p.group !== undefined && ids.has(p.group));
  }
  /** What a click on a part should select: its whole assembly, or just the part when loose. */
  selectionForClick(partId: number): number[] {
    const root = this.rootGroupOf(partId);
    return root ? this.membersOf(root.id).map((p) => p.id) : [partId];
  }
  /** The group whose members are exactly the selection, if there is one. */
  selectedGroup(): Group | undefined {
    if (this.selected.size < 1) return undefined;
    const first = this.selectedParts()[0];
    let g = first ? this.groupById(first.group ?? -1) : undefined;
    while (g) {
      const members = this.membersOf(g.id);
      if (members.length === this.selected.size && members.every((p) => this.selected.has(p.id)))
        return g;
      g = g.parent === undefined ? undefined : this.groupById(g.parent);
    }
    return undefined;
  }
  /** Put the selected parts in a new group. Parts that all share a group nest inside it. */
  groupSelected(name?: string): Group | undefined {
    const list = this.selectedParts();
    if (list.length < 2) return undefined;
    const common = list[0]!.group;
    const parent = list.every((p) => p.group === common) ? common : undefined;
    let g!: Group;
    this.mutate(() => {
      g = { id: this.nextGroupId++, name: name ?? `Group ${this.nextGroupId - 1}` };
      if (parent !== undefined) g.parent = parent;
      this.groups.push(g);
      for (const p of list) p.group = g.id;
    });
    return g;
  }
  /** Take the selected parts out of their groups, one level up. Empty groups go away. */
  ungroupSelected(): void {
    const list = this.selectedParts().filter((p) => p.group !== undefined);
    if (!list.length) return;
    this.mutate(() => {
      for (const p of list) {
        const parent = this.groupById(p.group!)?.parent;
        if (parent === undefined) delete p.group;
        else p.group = parent;
      }
    });
  }
  renameGroup(id: number, name: string): void {
    const g = this.groupById(id);
    const next = name.trim();
    if (!g || !next || g.name === next) return;
    this.mutate(() => (g.name = next));
  }
  /** Drop groups with no parts left (directly or in nested groups) and dangling references. */
  private pruneGroups(): void {
    const known = new Set(this.groups.map((g) => g.id));
    for (const p of this.parts) if (p.group !== undefined && !known.has(p.group)) delete p.group;
    for (const g of this.groups)
      if (g.parent !== undefined && !known.has(g.parent)) delete g.parent;
    let changed = true;
    while (changed) {
      changed = false;
      for (const g of [...this.groups])
        if (!this.membersOf(g.id).length) {
          this.groups = this.groups.filter((x) => x !== g);
          for (const c of this.groups) if (c.parent === g.id) delete c.parent;
          changed = true;
        }
    }
  }

  // ---- settings ----
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    this.notify('settings');
  }

  // ---- part operations ----
  addPart(stockId: string, at: Vec3 = [0, 0, 0]): Part {
    let p!: Part;
    this.mutate(() => {
      p = createPart(this.nextId++, stockId, at);
      this.parts.push(p);
    });
    this.select([p.id]);
    return p;
  }
  deleteSelected(): void {
    if (!this.selected.size) return;
    this.mutate(() => {
      this.parts = this.parts.filter((p) => !this.selected.has(p.id));
    });
    this.select([]);
  }
  /**
   * Copy parts with offsets. A group whose members are all being copied is copied as a
   * new group, so a duplicated assembly stays an assembly of its own.
   */
  private cloneParts(list: Part[], offsets: Vec3[]): number[] {
    const ids: number[] = [];
    const selected = new Set(list.map((p) => p.id));
    const wholeGroups = this.groups.filter((g) => {
      const m = this.membersOf(g.id);
      return m.length > 0 && m.every((p) => selected.has(p.id));
    });
    for (const offset of offsets) {
      const groupMap = new Map<number, number>();
      for (const g of wholeGroups) groupMap.set(g.id, this.nextGroupId++);
      for (const g of wholeGroups) {
        const copy: Group = { id: groupMap.get(g.id)!, name: g.name };
        const parent = g.parent === undefined ? undefined : (groupMap.get(g.parent) ?? g.parent);
        if (parent !== undefined) copy.parent = parent;
        this.groups.push(copy);
      }
      for (const p of list) {
        const c = clonePart(p, this.nextId++, offset);
        if (p.group !== undefined) c.group = groupMap.get(p.group) ?? p.group;
        this.parts.push(c);
        ids.push(c.id);
      }
    }
    return ids;
  }
  /** Copy the selection, offset, and select the copies. */
  duplicateSelected(offset: Vec3 = [16, 0, 0]): void {
    const list = this.selectedParts();
    if (!list.length) return;
    let ids: number[] = [];
    this.mutate(() => {
      ids = this.cloneParts(list, [offset]);
    });
    this.select(ids);
  }
  arraySelected(axis: Axis, count: number, spacing: number): void {
    const list = this.selectedParts();
    if (!list.length || count < 2) return;
    const offsets: Vec3[] = [];
    for (let i = 1; i < count; i++) {
      const offset: Vec3 = [0, 0, 0];
      offset[AXIS_INDEX[axis]] = spacing * i;
      offsets.push(offset);
    }
    let ids: number[] = [];
    this.mutate(() => {
      ids = this.cloneParts(list, offsets);
    });
    this.select(ids);
  }
  rotateSelected(axis: Axis, turns = 1): void {
    const list = this.selectedParts();
    if (!list.length) return;
    this.mutate(() => rotateParts(list, axis, turns));
  }
  nudge(d: Vec3): void {
    const list = this.selectedParts();
    if (!list.length) return;
    this.mutate(() => translateParts(list, d));
  }
  alignSelected(axis: AxisIndex, mode: AlignMode): void {
    const list = this.selectedParts();
    if (list.length < 2) return;
    this.mutate(() => alignParts(list, axis, mode));
  }
  /** Lower the selection until it rests on the floor or on the parts beneath it. */
  dropSelected(): void {
    const list = this.selectedParts();
    if (!list.length) return;
    const others = this.parts.filter((p) => !this.selected.has(p.id));
    const dz = dropDistance(list, others);
    if (dz === 0) return;
    this.mutate(() => translateParts(list, [0, 0, dz]));
  }
  /** Hide or show particular parts; hiding drops them from the selection. */
  setHidden(ids: Iterable<number>, hidden: boolean): void {
    const list = [...ids].map((id) => this.partById(id)).filter((p): p is Part => !!p);
    const changing = list.filter((p) => !!p.hidden !== hidden);
    if (!changing.length) return;
    this.mutate(() =>
      changing.forEach((p) => {
        if (hidden) p.hidden = true;
        else delete p.hidden;
      }),
    );
    if (hidden) this.select([...this.selected].filter((id) => !changing.some((p) => p.id === id)));
  }
  renamePart(id: number, name: string): void {
    const p = this.partById(id);
    const next = name.trim();
    if (!p || !next || p.name === next) return;
    this.mutate(() => (p.name = next));
  }
  hideSelected(): void {
    const list = this.selectedParts();
    if (!list.length) return;
    this.mutate(() => list.forEach((p) => (p.hidden = true)));
    this.select([]);
  }
  unhideAll(): void {
    const hidden = this.parts.filter((p) => p.hidden);
    if (!hidden.length) return;
    this.mutate(() => hidden.forEach((p) => delete p.hidden));
    this.select(hidden.map((p) => p.id));
  }
  /** Replace the whole model (new file, sample, open). */
  replaceParts(parts: Part[], groups: Group[] = []): void {
    this.mutate(() => {
      this.parts = parts;
      this.groups = groups;
      this.nextId = Math.max(0, ...parts.map((p) => p.id)) + 1;
      this.nextGroupId = Math.max(0, ...groups.map((g) => g.id)) + 1;
    });
    this.select([]);
  }

  // ---- files ----
  toDocument(): Document {
    return {
      version: 2,
      parts: this.parts,
      groups: this.groups,
      stockLen: this.settings.stockLen,
      prices: this.settings.prices,
    };
  }
  loadDocument(doc: Document): void {
    this.settings.stockLen = doc.stockLen ?? {};
    this.settings.prices = doc.prices ?? {};
    this.replaceParts(doc.parts, doc.groups ?? []);
    this.notify('settings');
  }

  autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, this.snapshot());
    } catch {
      /* no storage here (tests), or storage full: autosave is best effort */
    }
  }
  /** Restore the autosaved model, if any. Returns whether something was restored. */
  loadAutosave(): boolean {
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY);
      if (!s) return false;
      this.restore(s);
      return true;
    } catch {
      return false;
    }
  }
}

/** Check a parsed JSON value is a saved model, migrating older versions. */
export function parseDocument(o: unknown): Document | null {
  if (!o || typeof o !== 'object') return null;
  const d = o as {
    version?: unknown;
    parts?: unknown;
    groups?: unknown;
    stockLen?: unknown;
    prices?: unknown;
  };
  if (!Array.isArray(d.parts)) return null;
  for (const p of d.parts as unknown[]) {
    if (!p || typeof p !== 'object') return null;
    const x = p as Partial<Part>;
    if (
      typeof x.id !== 'number' ||
      typeof x.stock !== 'string' ||
      typeof x.len !== 'number' ||
      !Array.isArray(x.pos) ||
      x.pos.length !== 3 ||
      !Array.isArray(x.q) ||
      x.q.length !== 4
    )
      return null;
  }
  let parts = d.parts as Part[];
  if (d.version !== 2) parts = migrateFromYUp(parts);
  const groups = Array.isArray(d.groups)
    ? (d.groups as unknown[]).filter(
        (g): g is Group =>
          !!g &&
          typeof g === 'object' &&
          typeof (g as Group).id === 'number' &&
          typeof (g as Group).name === 'string',
      )
    : [];
  return {
    version: 2,
    parts,
    groups,
    stockLen: d.stockLen as Record<string, number> | undefined,
    prices: d.prices as Record<string, number> | undefined,
  };
}
