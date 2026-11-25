/**
 * Length fields (class "len") step with the arrow keys: Up and Down move by the grid
 * step, Shift by an inch, Ctrl by a sixteenth. The change applies at once, as if typed.
 */
import type { Store } from '../store';
import { fmt, parseLen } from '../units';

/** The step an arrow press means, given the modifiers held. */
export function arrowStep(
  e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  grid: number,
): number {
  if (e.ctrlKey || e.metaKey) return 1 / 16;
  if (e.shiftKey) return 1;
  return grid || 1 / 16;
}

/** The value after one arrow press, rounded to a 64th and kept at or above `min`. */
export function stepValue(current: number, step: number, up: boolean, min: number): number {
  const next = Math.round((current + (up ? step : -step)) * 64) / 64;
  return Math.max(min, next);
}

export function wireLengthFields(store: Store): void {
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.classList.contains('len')) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const current = parseLen(el.value);
    if (current === null) return;
    const min = el.dataset.min !== undefined ? parseFloat(el.dataset.min) : -Infinity;
    el.value = fmt(stepValue(current, arrowStep(e, store.settings.grid), e.key === 'ArrowUp', min));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    e.preventDefault();
  });
}

/**
 * Remember which field inside `root` has focus, so a panel can put the caret back after
 * it rebuilds its HTML. Returns a function that restores it.
 */
export function keepFocus(root: HTMLElement): () => void {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement)) return () => {};
  if (!root.contains(active) || !active.id) return () => {};
  const id = active.id;
  return () => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
    el.focus();
    if (el instanceof HTMLInputElement && el.type === 'text') el.select();
  };
}
