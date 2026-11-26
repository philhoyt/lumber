/**
 * The stock used most recently, so the add menus and the palette can offer it first.
 * Remembered per browser; a short list, newest first.
 */
import type { Store } from '../store';
import { getStock } from '../stock';
import type { Vec3 } from '../model';

const KEY = 'lumber.recentStock';
const MAX = 5;
let memory: string[] | null = null;

function read(): string[] {
  if (memory) return memory;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    memory = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    memory = [];
  }
  return memory;
}

/** Stock ids used lately, newest first, limited to stock that still exists. */
export function recentStock(): string[] {
  const known = new Set(getStock().map((s) => s.id));
  return read().filter((id) => known.has(id));
}

export function noteStockUsed(id: string): void {
  const list = [id, ...read().filter((x) => x !== id)].slice(0, MAX);
  memory = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* best effort */
  }
}

/** Forget the list (tests). */
export function clearRecentStock(): void {
  memory = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* best effort */
  }
}

/** Add stock the way every entry point does: turned like the selection, and remembered. */
export function addStock(store: Store, id: string, at: Vec3 = [0, 0, 0]) {
  noteStockUsed(id);
  return store.addPartLikeSelection(id, at);
}
