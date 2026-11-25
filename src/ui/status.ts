/** The status bar: part count, what you can do right now, and the model's overall size. */
import { aabbSize, unionAABB } from '../model';
import type { Store } from '../store';
import { fmt } from '../units';

const HINTS = {
  none: [
    ['Click', 'select'],
    ['Shift+A', 'add stock'],
    ['Right-click', 'menu'],
    ['?', 'keys'],
  ],
  one: [
    ['G', 'grab'],
    ['R', 'rotate'],
    ['S', 'length'],
    ['Shift+D', 'duplicate'],
    ['X', 'delete'],
    ['?', 'keys'],
  ],
  many: [
    ['G', 'grab'],
    ['R', 'rotate'],
    ['Ctrl+G', 'group'],
    ['Shift+D', 'duplicate'],
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
    countEl.textContent = `${n} part${n === 1 ? '' : 's'}${sel ? ` · ${sel} selected` : ''}`;
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
    const s = aabbSize(unionAABB(store.parts));
    overallEl.textContent = `${fmt(s[0])} W × ${fmt(s[1])} D × ${fmt(s[2])} H`;
  };
  store.subscribe((kind) => {
    if (kind !== 'drag') render();
  });
  render();
}
