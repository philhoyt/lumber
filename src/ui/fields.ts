/**
 * Length fields (class "len") step with the arrow keys: Up and Down move by the grid
 * step, Shift by an inch, Ctrl by a sixteenth. Dragging a field's label scrubs its value
 * the same way. The change applies at once, as if typed. Escape in any field puts back
 * what it held when it took focus and leaves it.
 */
import { MIN_LEN } from '../model';
import type { Store } from '../store';
import { fmt, parseLen } from '../units';

/** The step an arrow press means, given the modifiers held. */
export function arrowStep(
  e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  grid: number,
): number {
  if (e.ctrlKey || e.metaKey) return MIN_LEN;
  if (e.shiftKey) return 1;
  return grid || MIN_LEN;
}

/**
 * The step for a plain number field (angles, counts): 1, Shift 5, Ctrl the field's own
 * step when that is finer than 1.
 */
export function numberStep(
  e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  fine: number,
): number {
  if (e.ctrlKey || e.metaKey) return Number.isFinite(fine) && fine > 0 && fine < 1 ? fine : 1;
  if (e.shiftKey) return 5;
  return 1;
}

/** The value after one arrow press, rounded to a 64th and kept within `min` and `max`. */
export function stepValue(
  current: number,
  step: number,
  up: boolean,
  min: number,
  max = Infinity,
): number {
  const next = Math.round((current + (up ? step : -step)) * 64) / 64;
  return Math.min(max, Math.max(min, next));
}

/** Pixels of drag per step when scrubbing a field. */
export const SCRUB_PX = 4;

/** The value a scrub of `dx` pixels from `start` means, one step per few pixels. */
export function scrubValue(
  start: number,
  dx: number,
  step: number,
  min: number,
  max = Infinity,
): number {
  const steps = Math.trunc(dx / SCRUB_PX);
  if (!steps) return start;
  return stepValue(start, step * Math.abs(steps), steps > 0, min, max);
}

interface Mods {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** How a field reads and writes its value: a length (text, class "len") or a plain number. */
function fieldOf(el: HTMLInputElement, grid: number) {
  const len = el.classList.contains('len');
  const min = el.dataset.min !== undefined ? parseFloat(el.dataset.min) : parseFloat(el.min);
  const max = parseFloat(el.max);
  return {
    read: (): number | null => {
      if (len) return parseLen(el.value);
      const v = parseFloat(el.value);
      return Number.isFinite(v) ? v : null;
    },
    write: (v: number): void => {
      el.value = len ? fmt(v) : String(v);
    },
    step: (e: Mods): number => (len ? arrowStep(e, grid) : numberStep(e, parseFloat(el.step))),
    min: Number.isFinite(min) ? min : -Infinity,
    max: Number.isFinite(max) ? max : Infinity,
  };
}

/** The field a label scrubs: the one it is for, or the input right after it. */
function scrubTarget(target: EventTarget | null, alt: boolean): HTMLInputElement | null {
  if (!(target instanceof Element)) return null;
  if (isField(target)) return alt && target.id ? target : null;
  const label = target.closest('label');
  if (!label) return null;
  const el = label.control ?? label.nextElementSibling;
  return isField(el) && el.id ? el : null;
}

/** A text or number input in a panel: the fields that step, scrub and revert. */
function isField(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'number');
}

export function wireLengthFields(store: Store): void {
  // Remember what a field held when it took focus, so Escape can put it back.
  document.addEventListener('focusin', (e) => {
    if (isField(e.target)) e.target.dataset.was = e.target.value;
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Escape' && isField(el)) {
      const was = el.dataset.was;
      if (was !== undefined) el.value = was;
      el.blur();
      e.stopPropagation();
      return;
    }
    if (!isField(el) || !el.classList.contains('len')) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const f = fieldOf(el, store.settings.grid);
    const current = f.read();
    if (current === null) return;
    f.write(stepValue(current, f.step(e), e.key === 'ArrowUp', f.min, f.max));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    e.preventDefault();
  });

  // Scrub: drag a field's label (or Alt-drag the field) to slide its value, one step per
  // few pixels with the same modifiers as the arrow keys. The panel may rebuild while
  // the drag runs, so the field is found again by id on every move.
  let scrub: { id: string; x: number; start: number; last: number } | null = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || scrub) return;
    const el = scrubTarget(e.target, e.altKey);
    if (!el) return;
    const start = fieldOf(el, store.settings.grid).read();
    if (start === null) return;
    e.preventDefault();
    scrub = { id: el.id, x: e.clientX, start, last: start };
    document.body.setPointerCapture(e.pointerId);
    document.body.classList.add('scrubbing');
    store.beginCoalesce();
  });
  document.addEventListener('pointermove', (e) => {
    if (!scrub) return;
    const el = document.getElementById(scrub.id);
    if (!isField(el)) return;
    const f = fieldOf(el, store.settings.grid);
    const v = scrubValue(scrub.start, e.clientX - scrub.x, f.step(e), f.min, f.max);
    if (v === scrub.last) return;
    scrub.last = v;
    f.write(v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const endScrub = (e: PointerEvent): void => {
    if (!scrub) return;
    scrub = null;
    if (document.body.hasPointerCapture(e.pointerId))
      document.body.releasePointerCapture(e.pointerId);
    document.body.classList.remove('scrubbing');
    store.endCoalesce();
  };
  document.addEventListener('pointerup', endScrub);
  document.addEventListener('pointercancel', endScrub);
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
