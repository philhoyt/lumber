/** The status bar: part count, what you can do right now, and the model's overall size. */
import { aabbSize, isReferencePart, unionAABB } from '../model';
import type { Store } from '../store';
import { fmt } from '../units';

const HINTS = {
  none: [
    ['Click', 'select'],
    ['Shift+A', 'add stock'],
    ['M', 'measure'],
    ['F', 'fasteners'],
    ['Right-click', 'menu'],
    ['?', 'keys'],
  ],
  one: [
    ['G', 'grab'],
    ['R', 'rotate'],
    ['S', 'length'],
    ['Shift+D', 'duplicate'],
    ['Shift+R', 'array'],
    ['C', 'center between'],
    ['X', 'delete'],
    ['?', 'keys'],
  ],
  many: [
    ['G', 'grab'],
    ['R', 'rotate'],
    ['Ctrl+G', 'group'],
    ['Shift+D', 'duplicate'],
    ['Shift+R', 'array'],
    ['X', 'delete'],
    ['?', 'keys'],
  ],
} as const;

export function wireStatus(
  countEl: HTMLElement,
  hintsEl: HTMLElement,
  overallEl: HTMLElement,
  store: Store,
): void {
  const render = () => {
    const n = store.parts.length;
    const sel = store.selected.size;
    const refs = store.parts.filter(isReferencePart).length;
    const built = n - refs;
    countEl.textContent = `${built} part${built === 1 ? '' : 's'}${refs ? ` · ${refs} reference` : ''}${sel ? ` · ${sel} selected` : ''}`;
    const overlaps = store.overlaps();
    if (overlaps.ids.size) {
      // Parts that run into each other: the count is a button that selects them.
      const b = document.createElement('button');
      b.id = 'overlapCount';
      b.className = 'overlap';
      b.textContent = `${overlaps.ids.size} overlapping`;
      b.title = 'Parts that run into each other (shown red); click to select them';
      b.addEventListener('click', () => {
        store.select(overlaps.ids);
      });
      countEl.append(' · ', b);
    }
    const hints = sel === 0 ? HINTS.none : sel === 1 ? HINTS.one : HINTS.many;
    hintsEl.textContent = '';
    hints.forEach(([k, what], i) => {
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      hintsEl.append(kbd, `${what}${i < hints.length - 1 ? '   ' : ''}`);
    });
    if (!n) {
      overallEl.textContent = '—';
      return;
    }
    const real = store.parts.filter((p) => !isReferencePart(p));
    if (!real.length) {
      overallEl.textContent = '—';
      return;
    }
    const s = aabbSize(unionAABB(real));
    overallEl.textContent = `${fmt(s[0])} W × ${fmt(s[1])} D × ${fmt(s[2])} H`;
  };
  // Counts and the overall size are cheap, so they follow a drag live.
  store.subscribe(() => {
    render();
  });
  render();
}
