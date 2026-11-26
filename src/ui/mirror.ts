/**
 * Mirror works like Blender's Ctrl+M: it waits for an axis key, then flips the selection
 * across that axis through its centre. The wait shows as a toast.
 */
import type { Axis } from '../model';
import type { Store } from '../store';
import { toast } from './toast';

let pending = false;

const AXIS_WORDS: Record<Axis, string> = { x: 'left-right', y: 'front-back', z: 'top-bottom' };

/** Start waiting for an axis key. */
export function beginMirror(store: Store): void {
  if (!store.selected.size) return;
  pending = true;
  toast('Mirror: press X, Y or Z for the axis, Esc to cancel', 8000);
}

/** Handle a key while waiting; true when the key was consumed. */
export function mirrorKey(e: KeyboardEvent, store: Store): boolean {
  if (!pending) return false;
  const k = e.key.toLowerCase();
  if (k === 'x' || k === 'y' || k === 'z') {
    pending = false;
    store.mirrorSelected(k);
    toast(`Mirrored ${AXIS_WORDS[k]} (${k.toUpperCase()})`, 2000);
    return true;
  }
  if (e.key === 'Escape') {
    pending = false;
    toast('Mirror cancelled', 1500);
    return true;
  }
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return true;
  pending = false;
  return false;
}
