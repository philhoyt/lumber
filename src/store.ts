/**
 * Application state: the parts, the selection, settings, and undo/redo. Every change
 * to parts goes through `mutate`, which snapshots the model first so it can be undone,
 * then autosaves and tells subscribers.
 */
import {
  clonePart,
  createPart,
  rotateParts,
  translateParts,
  AXIS_INDEX,
  type Axis,
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

/** The saved file format. */
export interface Document {
  version: 1;
  parts: Part[];
  stockLen?: Record<string, number>;
  prices?: Record<string, number>;
}

export type ChangeKind = 'model' | 'selection' | 'settings' | 'drag';
export type Listener = (kind: ChangeKind) => void;

const AUTOSAVE_KEY = 'lumber.autosave';

export class Store {
  parts: Part[] = [];
  nextId = 1;
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
    return JSON.stringify({ parts: this.parts, nextId: this.nextId });
  }
  restore(s: string): void {
    const o = JSON.parse(s) as { parts: Part[]; nextId: number };
    this.parts = o.parts;
    this.nextId = o.nextId;
    this.selected = new Set([...this.selected].filter((id) => this.parts.some((p) => p.id === id)));
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
    this.selected = new Set(ids);
    this.notify('selection');
  }
  toggleSelect(id: number): void {
    const s = new Set(this.selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.select(s);
  }
  selectedParts(): Part[] {
    return this.parts.filter((p) => this.selected.has(p.id));
  }
  partById(id: number): Part | undefined {
    return this.parts.find((p) => p.id === id);
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
  duplicateSelected(offset: Vec3 = [16, 0, 0]): void {
    const list = this.selectedParts();
    if (!list.length) return;
    const ids: number[] = [];
    this.mutate(() => {
      for (const p of list) {
        const c = clonePart(p, this.nextId++, offset);
        this.parts.push(c);
        ids.push(c.id);
      }
    });
    this.select(ids);
  }
  arraySelected(axis: Axis, count: number, spacing: number): void {
    const list = this.selectedParts();
    if (!list.length || count < 2) return;
    const ids: number[] = [];
    this.mutate(() => {
      for (let i = 1; i < count; i++)
        for (const p of list) {
          const offset: Vec3 = [0, 0, 0];
          offset[AXIS_INDEX[axis]] = spacing * i;
          const c = clonePart(p, this.nextId++, offset);
          this.parts.push(c);
          ids.push(c.id);
        }
    });
    this.select(ids);
  }
  rotateSelected(axis: Axis): void {
    const list = this.selectedParts();
    if (!list.length) return;
    this.mutate(() => rotateParts(list, axis));
  }
  nudge(d: Vec3): void {
    const list = this.selectedParts();
    if (!list.length) return;
    this.mutate(() => translateParts(list, d));
  }
  /** Replace the whole model (new file, sample, open). */
  replaceParts(parts: Part[]): void {
    this.mutate(() => {
      this.parts = parts;
      this.nextId = Math.max(0, ...parts.map((p) => p.id)) + 1;
    });
    this.select([]);
  }

  // ---- files ----
  toDocument(): Document {
    return {
      version: 1,
      parts: this.parts,
      stockLen: this.settings.stockLen,
      prices: this.settings.prices,
    };
  }
  loadDocument(doc: Document): void {
    this.settings.stockLen = doc.stockLen ?? {};
    this.settings.prices = doc.prices ?? {};
    this.replaceParts(doc.parts);
    this.notify('settings');
  }

  autosave(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, this.snapshot());
    } catch {
      /* storage full or disabled: autosave is best effort */
    }
  }
  /** Restore the autosaved model, if any. Returns whether something was restored. */
  loadAutosave(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const s = localStorage.getItem(AUTOSAVE_KEY);
    if (!s) return false;
    try {
      this.restore(s);
      return true;
    } catch {
      return false;
    }
  }
}

/** Check a parsed JSON value is a saved model. */
export function parseDocument(o: unknown): Document | null {
  if (!o || typeof o !== 'object') return null;
  const d = o as Partial<Document>;
  if (!Array.isArray(d.parts)) return null;
  for (const p of d.parts) {
    if (
      typeof p !== 'object' ||
      p === null ||
      typeof p.id !== 'number' ||
      typeof p.stock !== 'string' ||
      typeof p.len !== 'number' ||
      !Array.isArray(p.pos) ||
      p.pos.length !== 3 ||
      !Array.isArray(p.q) ||
      p.q.length !== 4
    )
      return null;
  }
  return { version: 1, parts: d.parts, stockLen: d.stockLen, prices: d.prices };
}
