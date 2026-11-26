/**
 * Application state: the parts, their groups, the selection, settings, and undo/redo.
 * Every change to parts goes through `mutate`, which snapshots the model first so it
 * can be undone, then tells subscribers (the project manager saves on those).
 */
import { normalizeStep } from './assembly';
import { applyFit, fitEnd, type EndFit } from './fit';
import { centerBetween, spaceBetween, type SpaceUnit } from './gap';
import { blockBetween, extentAlong, localAxisDir } from './frame';
import {
  cloneStock,
  DEFAULT_STOCK,
  getStock,
  sanitizeStock,
  setStock,
  stockById,
  withReferenceStock,
  type Stock,
} from './stock';
import { clampFastener, isFace, isFastenerKind, type Fastener } from './fastener';
import {
  aabbSize,
  partDims,
  alignParts,
  clonePart,
  createPart,
  MIN_LEN,
  dropDistance,
  migrateFromYUp,
  mirrorParts,
  rotateParts,
  rotatePartsBy,
  quatFromEuler,
  squareUp,
  translateParts,
  unionAABB,
  partAABB,
  AXIS_INDEX,
  arrayLayout,
  type AlignMode,
  type ArrayParams,
  type Axis,
  type AxisIndex,
  type Group,
  type Part,
  type Quat,
  type Cut,
  type Vec3,
  CUT_KINDS,
  GRAINS,
  MAX_MITER,
} from './model';

export interface Settings {
  grid: number;
  snapParts: boolean;
  kerf: number;
  /** Chosen purchase length per board stock id. */
  stockLen: Record<string, number>;
  /** What the fastener tool places next. */
  fastener: { kind: Fastener['kind']; size: string };
}

/** The saved file format. Version 1 was Y-up; version 2 is Z-up and may carry groups. */
export interface Document {
  version: 2;
  parts: Part[];
  groups?: Group[];
  /** The stock library as edited for this model; absent means the defaults. */
  stock?: Stock[];
  stockLen?: Record<string, number>;
  /** Price overrides from older files; folded into `stock` on load. */
  prices?: Record<string, number>;
}

export type ArraySpacing = 'center' | 'gap';
export type ChangeKind = 'model' | 'selection' | 'settings' | 'drag';
export type Listener = (kind: ChangeKind) => void;

interface Snapshot {
  parts: Part[];
  groups?: Group[];
  stock?: Stock[];
  nextId: number;
  nextGroupId?: number;
}

export class Store {
  parts: Part[] = [];
  groups: Group[] = [];
  nextId = 1;
  nextGroupId = 1;
  selected = new Set<number>();
  settings: Settings = {
    grid: 0.5,
    snapParts: true,
    kerf: 0.125,
    stockLen: {},
    fastener: { kind: 'screw', size: '' },
  };

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
      stock: getStock() as Stock[],
      nextId: this.nextId,
      nextGroupId: this.nextGroupId,
    };
    return JSON.stringify(s);
  }
  restore(s: string): void {
    const o = JSON.parse(s) as Snapshot;
    this.parts = o.parts;
    this.groups = o.groups ?? [];
    setStock(o.stock ?? DEFAULT_STOCK);
    this.nextId = o.nextId;
    this.nextGroupId = o.nextGroupId ?? Math.max(0, ...this.groups.map((g) => g.id)) + 1;
    this.selected = new Set(
      [...this.selected].filter((id) => this.parts.some((p) => p.id === id && !p.hidden)),
    );
    this.notify('model');
  }
  private coalescing: string | null = null;
  /**
   * Fold the changes until `endCoalesce` into one undo step: a scrub or a held arrow
   * key makes many small mutates that should undo together.
   */
  beginCoalesce(): void {
    this.coalescing ??= this.snapshot();
  }
  /** Stop coalescing without recording anything: the caller restored the model itself. */
  cancelCoalesce(): void {
    this.coalescing = null;
  }
  endCoalesce(): void {
    const before = this.coalescing;
    this.coalescing = null;
    if (before !== null && before !== this.snapshot()) this.commit(before);
  }
  /** Record `before` as the undo point for a change that has already been applied. */
  commit(before: string): void {
    if (this.coalescing !== null) {
      this.notify('model');
      return;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.notify('model');
  }
  mutate(fn: () => void): void {
    const before = this.snapshot();
    fn();
    this.regenerateArrays();
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
  }
  redo(): void {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }
  /** Forget the history, and any coalescing in flight, when a different model is loaded. */
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.coalescing = null;
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
  /**
   * What a click on a part should select: its whole assembly, or just the part when it
   * is loose. Once the selection is inside that assembly (some of its parts but not all,
   * as after a double-click), clicks pick single parts, so Shift+click extends part by
   * part instead of grabbing the whole group again.
   */
  selectionForClick(partId: number): number[] {
    const members = this.assemblyOf(partId);
    const chosen = members.filter((id) => this.selected.has(id)).length;
    const inside = chosen > 0 && chosen < members.length;
    return inside ? [partId] : members;
  }
  /** The ids of a part's whole assembly (its outermost group), or just the part when loose. */
  assemblyOf(partId: number): number[] {
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
  /**
   * Put parts into a group, or into none. A part joining an array group becomes part of
   * its source cell; a copy pulled out of one becomes an ordinary part and the array
   * fills its place again.
   */
  moveToGroup(ids: Iterable<number>, groupId: number | undefined): void {
    const target = groupId === undefined ? undefined : this.groupById(groupId);
    if (groupId !== undefined && !target) return;
    const list = [...ids]
      .map((id) => this.partById(id))
      .filter((p): p is Part => !!p && p.group !== groupId);
    if (!list.length) return;
    this.mutate(() => {
      for (const p of list) {
        if (groupId === undefined) delete p.group;
        else p.group = groupId;
        if (target?.array) p.arrayIndex = 0;
        else delete p.arrayIndex;
      }
    });
  }
  /** Nest a group inside another (or at the top level); never inside itself. */
  reparentGroup(id: number, parent: number | undefined): void {
    const g = this.groupById(id);
    if (!g || g.parent === parent || id === parent) return;
    if (parent !== undefined && (!this.groupById(parent) || this.isInside(parent, id))) return;
    this.mutate(() => {
      if (parent === undefined) delete g.parent;
      else g.parent = parent;
    });
  }
  /** Whether group `id` is `ancestor` or nested somewhere inside it. */
  isInside(id: number, ancestor: number): boolean {
    let g = this.groupById(id);
    while (g) {
      if (g.id === ancestor) return true;
      g = g.parent === undefined ? undefined : this.groupById(g.parent);
    }
    return false;
  }
  renameGroup(id: number, name: string): void {
    const g = this.groupById(id);
    const next = name.trim();
    if (!g || !next || g.name === next) return;
    this.mutate(() => (g.name = next));
  }
  // ---- array modifier ----
  /** The source cell of an array group: its direct members with index 0 (or no index). */
  arraySource(g: Group): Part[] {
    return this.parts.filter((p) => p.group === g.id && !p.arrayIndex);
  }
  /**
   * Turn the selection into an array group, or change the parameters of the array group
   * that is selected. Copies are generated at once.
   */
  setArray(params: ArrayParams): Group | undefined {
    const existing = this.selectedGroup();
    if (existing?.array) {
      this.mutate(() => (existing.array = { ...params }));
      return existing;
    }
    const list = this.selectedParts();
    if (!list.length) return undefined;
    let g!: Group;
    this.mutate(() => {
      const common = list[0]!.group;
      const parent = list.every((p) => p.group === common) ? common : undefined;
      g = { id: this.nextGroupId++, name: `Array ${this.nextGroupId - 1}`, array: { ...params } };
      if (parent !== undefined) g.parent = parent;
      this.groups.push(g);
      for (const p of list) {
        p.group = g.id;
        p.arrayIndex = 0;
      }
    });
    this.select(this.membersOf(g.id).map((p) => p.id));
    return g;
  }
  /** Keep the copies, drop the modifier: the group becomes an ordinary assembly. */
  applyArray(groupId: number): void {
    const g = this.groupById(groupId);
    if (!g?.array) return;
    this.mutate(() => {
      delete g.array;
      for (const p of this.parts) if (p.group === g.id) delete p.arrayIndex;
    });
  }
  /** Drop the copies and the modifier, leaving the source cell. */
  removeArray(groupId: number): void {
    const g = this.groupById(groupId);
    if (!g?.array) return;
    const keep = this.arraySource(g).map((p) => p.id);
    this.mutate(() => {
      delete g.array;
      this.parts = this.parts.filter((p) => p.group !== g.id || !p.arrayIndex);
      for (const p of this.parts) if (p.group === g.id) delete p.arrayIndex;
      // A lone part does not need a group of its own: dissolve it.
      if (this.membersOf(g.id).length < 2 && !this.childGroups(g.id).length) {
        for (const p of this.parts)
          if (p.group === g.id) {
            if (g.parent === undefined) delete p.group;
            else p.group = g.parent;
          }
        this.groups = this.groups.filter((x) => x !== g);
      }
    });
    this.select(keep);
  }
  /** Rebuild every array group's copies from its source cell. Runs inside each mutation. */
  private regenerateArrays(): void {
    for (const g of this.groups) {
      if (!g.array) continue;
      const source = this.arraySource(g);
      if (!source.length) {
        // The source is gone: whatever copies remain become ordinary parts.
        delete g.array;
        for (const p of this.parts) if (p.group === g.id) delete p.arrayIndex;
        continue;
      }
      const wasSelected = this.parts.some((p) => p.group === g.id && this.selected.has(p.id));
      for (const p of this.parts) if (p.group === g.id && p.arrayIndex) this.selected.delete(p.id);
      this.parts = this.parts.filter((p) => p.group !== g.id || !p.arrayIndex);
      const a = AXIS_INDEX[g.array.axis];
      // The copies run along a world axis, or along the source's own axis (up a slope).
      const dir: Vec3 = g.array.local
        ? localAxisDir(source[0]!.q, a).toArray()
        : [a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0];
      const extent = g.array.local
        ? extentAlong(source, localAxisDir(source[0]!.q, a))
        : aabbSize(unionAABB(source))[a];
      const { step, count } = arrayLayout(g.array, extent);
      for (let i = 1; i < count; i++) {
        const along = g.array.reverse ? -step * i : step * i;
        const offset: Vec3 = [dir[0] * along, dir[1] * along, dir[2] * along];
        for (const s of source) {
          const c = clonePart(s, this.nextId++, offset);
          c.name = `${s.name} ${i + 1}`;
          c.arrayIndex = i;
          this.parts.push(c);
          if (wasSelected) this.selected.add(c.id);
        }
      }
    }
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

  // ---- stock library ----
  get stock(): readonly Stock[] {
    return getStock();
  }
  /** How many parts use a stock; a stock in use cannot be deleted. */
  stockUseCount(id: string): number {
    return this.parts.filter((p) => p.stock === id).length;
  }
  updateStock(id: string, patch: Partial<Stock>): void {
    if (!getStock().some((s) => s.id === id)) return;
    this.mutate(() => setStock(getStock().map((s) => (s.id === id ? { ...s, ...patch } : s))));
  }
  addStock(kind: 'board' | 'sheet'): Stock {
    const used = new Set(getStock().map((s) => s.id));
    let n = 1;
    while (used.has(`custom${n}`)) n++;
    const s: Stock =
      kind === 'sheet'
        ? {
            id: `custom${n}`,
            name: 'New sheet',
            t: 0.75,
            sheet: [48, 96],
            price: 0,
            color: 0xd9c9a3,
          }
        : {
            id: `custom${n}`,
            name: 'New board',
            t: 0.75,
            w: 3.5,
            lengths: [96],
            price: 0,
            color: 0xcfa872,
          };
    this.mutate(() => setStock([...getStock(), s]));
    return s;
  }
  /** Remove a stock nobody uses. Returns false when parts still use it. */
  deleteStock(id: string): boolean {
    if (this.stockUseCount(id)) return false;
    if (!getStock().some((s) => s.id === id)) return false;
    this.mutate(() => setStock(getStock().filter((s) => s.id !== id)));
    return true;
  }
  resetStock(): void {
    this.mutate(() => setStock(DEFAULT_STOCK));
  }

  // ---- settings ----
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    this.notify('settings');
  }

  // ---- part operations ----
  addPart(stockId: string, at: Vec3 = [0, 0, 0], q?: Quat): Part {
    let p!: Part;
    this.mutate(() => {
      p = createPart(this.nextId++, stockId, at);
      if (q) p.q = [...q] as Quat;
      this.parts.push(p);
    });
    this.select([p.id]);
    return p;
  }
  /**
   * Add stock turned like the selection: a new piece arrives at the tilt of the part you
   * are working next to instead of flat. Loose when nothing is selected.
   */
  addPartLikeSelection(stockId: string, at: Vec3 = [0, 0, 0]): Part {
    const ref = this.selectedParts()[0];
    return this.addPart(stockId, at, ref?.q);
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
        if (g.array) copy.array = { ...g.array };
        const parent = g.parent === undefined ? undefined : (groupMap.get(g.parent) ?? g.parent);
        if (parent !== undefined) copy.parent = parent;
        this.groups.push(copy);
      }
      for (const p of list) {
        const c = clonePart(p, this.nextId++, offset);
        const g = p.group === undefined ? undefined : this.groupById(p.group);
        if (g?.array && !groupMap.has(g.id)) {
          // A piece of an array copied on its own leaves the array: inside it the copy
          // would be swept away (a copy) or double the run (the source) on regeneration.
          if (g.parent === undefined) delete c.group;
          else c.group = g.parent;
          delete c.arrayIndex;
        } else if (p.group !== undefined) c.group = groupMap.get(p.group) ?? p.group;
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
  /**
   * Stamp copies along an axis. `spacing` is centre to centre, or, with mode 'gap',
   * the clear space between copies (the selection's own extent on that axis is added).
   */
  arraySelected(axis: Axis, count: number, spacing: number, mode: ArraySpacing = 'center'): void {
    const list = this.selectedParts();
    if (!list.length || count < 2) return;
    const a = AXIS_INDEX[axis];
    const step = mode === 'gap' ? spacing + aabbSize(unionAABB(list))[a] : spacing;
    const offsets: Vec3[] = [];
    for (let i = 1; i < count; i++) {
      const offset: Vec3 = [0, 0, 0];
      offset[a] = step * i;
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
  /** Turn the selection by any angle, in degrees, about a world axis through its centre. */
  rotateSelectedBy(axis: Axis, deg: number): void {
    const list = this.selectedParts();
    if (!list.length || !deg) return;
    this.mutate(() => rotatePartsBy(list, axis, deg));
  }
  /** Set each selected part's orientation in place, as XYZ angles in degrees. */
  setRotation(ids: Iterable<number>, deg: Vec3): void {
    const list = [...ids].map((id) => this.partById(id)).filter((p) => p !== undefined);
    if (!list.length) return;
    const q = quatFromEuler(deg);
    this.mutate(() => {
      for (const p of list) p.q = [...q];
    });
  }
  /**
   * Cut one end of a part (0 for A, 1 for B) to lie flat on what it points at, and move
   * its long point onto that surface. Returns what was done, or null when nothing is in reach.
   */
  fitEnd(partId: number, end: 0 | 1): EndFit | null {
    const p = this.partById(partId);
    if (!p) return null;
    const others = this.parts.filter((o) => o.id !== partId && !o.hidden);
    const fit = fitEnd(p, end, others);
    if (!fit) return null;
    this.mutate(() => applyFit(p, end, fit));
    return fit;
  }
  /** Snap each selected part to the nearest quarter-turn orientation, in place. */
  squareUpSelected(): void {
    const list = this.selectedParts();
    if (!list.length) return;
    this.mutate(() => {
      for (const p of list) p.q = squareUp(p.q);
    });
  }
  // ---- fasteners ----
  addFastener(partId: number, f: Fastener): void {
    const p = this.partById(partId);
    if (!p) return;
    this.mutate(() => {
      p.fasteners = [...(p.fasteners ?? []), clampFastener(f, partDims(p))];
    });
  }
  /** Replace a part's markers; an empty list clears them. */
  setFasteners(partId: number, list: Fastener[]): void {
    const p = this.partById(partId);
    if (!p) return;
    this.mutate(() => {
      const dims = partDims(p);
      const next = list.map((f) => clampFastener(f, dims));
      if (next.length) p.fasteners = next;
      else delete p.fasteners;
    });
  }
  removeFastener(partId: number, index: number): void {
    const p = this.partById(partId);
    if (!p?.fasteners || index < 0 || index >= p.fasteners.length) return;
    this.setFasteners(
      partId,
      p.fasteners.filter((_, i) => i !== index),
    );
  }
  /** Set (or clear, with null) the assembly step of the given parts. */
  setStep(ids: Iterable<number>, step: number | null): void {
    const s = normalizeStep(step);
    const list = [...ids].map((id) => this.partById(id)).filter((p) => p !== undefined);
    if (!list.length) return;
    this.mutate(() => {
      for (const p of list) {
        if (s === undefined) delete p.step;
        else p.step = s;
      }
    });
  }
  mirrorSelected(axis: Axis): void {
    const list = this.selectedParts();
    if (!list.length) return;
    this.mutate(() => mirrorParts(list, axis));
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
  /**
   * Centre the selection between two other parts, along the axis those two are apart
   * on. Returns the axis moved on, or null when there was nothing to do.
   */
  centerSelectedBetween(aId: number, bId: number): AxisIndex | null {
    const a = this.partById(aId);
    const b = this.partById(bId);
    const list = this.selectedParts().filter((p) => p.id !== aId && p.id !== bId);
    if (!a || !b || a === b || !list.length) return null;
    const move = centerBetween(unionAABB(list), partAABB(a), partAABB(b));
    if (!move) return null;
    if (move.delta) {
      const d: Vec3 = [0, 0, 0];
      d[move.axis] = move.delta;
      this.mutate(() => translateParts(list, d));
    }
    return move.axis;
  }
  /**
   * Space the selection evenly between two other parts: equal clear gaps along the axis
   * those two are apart on. A whole assembly in the selection moves as one piece, and a
   * live array along that axis keeps being an array, re-spaced by its gap. Returns the
   * axis, or null when there was nothing to do.
   */
  spaceSelectedBetween(aId: number, bId: number): AxisIndex | null {
    const a = this.partById(aId);
    const b = this.partById(bId);
    const list = this.selectedParts().filter((p) => p.id !== aId && p.id !== bId);
    if (!a || !b || a === b || !list.length) return null;
    const boxA = partAABB(a);
    const boxB = partAABB(b);
    const g = this.selectedGroup();
    if (g?.array) {
      // Re-space the array itself: keep its count, set the gap, and put the source cell
      // first in the run.
      const source = this.arraySource(g);
      const axis = AXIS_INDEX[g.array.axis];
      const extent = aabbSize(unionAABB(source))[axis];
      const { count } = arrayLayout(g.array, extent);
      const units: SpaceUnit[] = Array.from({ length: count }, (_, i) => ({
        id: i,
        box: { min: [i, i, i], max: [i + extent, i + extent, i + extent] },
      }));
      const r = spaceBetween(units, boxA, boxB);
      if (r?.axis === axis) {
        const first = r.moves.find((m) => m.id === 0)!;
        const d: Vec3 = [0, 0, 0];
        d[axis] = first.delta - unionAABB(source).min[axis];
        this.mutate(() => {
          translateParts(source, d);
          g.array = { axis: g.array!.axis, mode: 'gap', spacing: r.gap, count };
        });
        return axis;
      }
    }
    // Otherwise each part, or each whole assembly, is a unit of its own.
    const units: SpaceUnit<Part[]>[] = [];
    const seen = new Set<number>();
    for (const p of list) {
      if (seen.has(p.id)) continue;
      const root = this.rootGroupOf(p.id);
      const members = root ? this.membersOf(root.id) : [p];
      const whole = members.every((m) => this.selected.has(m.id));
      const unit = whole ? members : [p];
      for (const m of unit) seen.add(m.id);
      units.push({ id: unit, box: unionAABB(unit) });
    }
    const r = spaceBetween(units, boxA, boxB);
    if (!r) return null;
    this.mutate(() => {
      for (const m of r.moves) {
        const d: Vec3 = [0, 0, 0];
        d[r.axis] = m.delta;
        translateParts(m.id, d);
      }
    });
    return r.axis;
  }
  /**
   * Add a piece of blocking between two parallel parts (see `blockBetween`): the first
   * part's stock, cut to the clear gap, flush with their faces, at their lower end. The
   * new part is selected. Null when the two cannot take a block.
   */
  addBlockBetween(aId: number, bId: number): Part | null {
    const a = this.partById(aId);
    const b = this.partById(bId);
    if (!a || !b || a === b || stockById(a.stock).sheet) return null;
    const fit = blockBetween(a, b);
    if (!fit || fit.len < MIN_LEN) return null;
    let p!: Part;
    this.mutate(() => {
      p = createPart(this.nextId++, a.stock, fit.pos);
      p.pos = [...fit.pos]; // createPart rests parts on the floor; the fit says where
      p.name = 'Block';
      p.len = fit.len;
      p.q = fit.q;
      if (a.group !== undefined) p.group = a.group;
      this.parts.push(p);
    });
    this.select([p.id]);
    return p;
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
  replaceParts(parts: Part[], groups: Group[] = [], stock?: Stock[]): void {
    this.mutate(() => {
      this.parts = parts;
      this.groups = groups;
      if (stock) setStock(stock);
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
      stock: cloneStock(getStock()),
      stockLen: this.settings.stockLen,
    };
  }
  loadDocument(doc: Document): void {
    this.settings.stockLen = doc.stockLen ?? {};
    // Older files carried price overrides instead of a stock table: fold them in.
    const stock = withReferenceStock(cloneStock(doc.stock ?? DEFAULT_STOCK));
    for (const s of stock) if (doc.prices?.[s.id] !== undefined) s.price = doc.prices[s.id]!;
    this.replaceParts(doc.parts, doc.groups ?? [], stock);
    this.notify('settings');
  }
}

/** Check a parsed JSON value is a saved model, migrating older versions. */
export function parseDocument(o: unknown): Document | null {
  if (!o || typeof o !== 'object') return null;
  const d = o as {
    version?: unknown;
    parts?: unknown;
    groups?: unknown;
    stock?: unknown;
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
    if (x.cuts !== undefined) {
      const ok = Array.isArray(x.cuts)
        ? (x.cuts as unknown[]).filter((c): c is Cut => {
            if (!c || typeof c !== 'object') return false;
            const k = (c as Cut).kind;
            if (!CUT_KINDS.includes(k)) return false;
            const o = c as Record<string, unknown>;
            const nums = k === 'rabbet' ? ['width', 'depth'] : ['at', 'width', 'depth'];
            if (!nums.every((f) => typeof o[f] === 'number' && o[f] >= 0)) return false;
            if (k === 'notch') return o.edge === 'front' || o.edge === 'back';
            if (o.face !== 'top' && o.face !== 'bottom') return false;
            if (k === 'rabbet') return ['endA', 'endB', 'front', 'back'].includes(o.edge as string);
            return true;
          })
        : [];
      if (ok.length) x.cuts = ok;
      else delete x.cuts;
    }
    if (x.t !== undefined && !(typeof x.t === 'number' && x.t > 0)) delete x.t;
    if (x.step !== undefined) {
      const s = normalizeStep(typeof x.step === 'number' ? x.step : null);
      if (s === undefined) delete x.step;
      else x.step = s;
    }
    if (x.fasteners !== undefined) {
      const ok = Array.isArray(x.fasteners)
        ? (x.fasteners as unknown[]).flatMap((f): Fastener[] => {
            if (!f || typeof f !== 'object') return [];
            const o = f as Record<string, unknown>;
            if (!isFastenerKind(o.kind) || !isFace(o.face)) return [];
            const at = o.at;
            if (!Array.isArray(at) || at.length !== 2 || !at.every((n) => typeof n === 'number'))
              return [];
            const out: Fastener = {
              kind: o.kind,
              face: o.face,
              at: [at[0]!, at[1]!],
            };
            if (typeof o.size === 'string' && o.size.trim()) out.size = o.size.trim();
            return [out];
          })
        : [];
      if (ok.length) x.fasteners = ok;
      else delete x.fasteners;
    }
    if (x.grain !== undefined && !GRAINS.includes(x.grain)) delete x.grain;
    if (x.grain === 'any') delete x.grain;
    const clear = (part: Partial<Part>, key: 'miter' | 'bevel') => {
      if (key === 'miter') delete part.miter;
      else delete part.bevel;
    };
    // Miters and bevels must be a pair of angles within range; anything else reads as square.
    for (const key of ['miter', 'bevel'] as const) {
      if (x[key] === undefined) continue;
      const m = x[key] as unknown;
      if (
        Array.isArray(m) &&
        m.length === 2 &&
        m.every((n) => typeof n === 'number' && Math.abs(n) <= MAX_MITER)
      ) {
        if (m[0] === 0 && m[1] === 0) clear(x, key);
      } else clear(x, key);
    }
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
  const stock = sanitizeStock(d.stock) ?? undefined;
  return {
    version: 2,
    parts,
    groups,
    stock: stock?.length ? stock : undefined,
    stockLen: d.stockLen as Record<string, number> | undefined,
    prices: d.prices as Record<string, number> | undefined,
  };
}
