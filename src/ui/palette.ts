/** The stock palette: drag a stock onto the scene, or click to add one at the centre. */
import { STOCK } from '../stock';
import type { Store } from '../store';
import { fmt } from '../units';
import { esc, hex } from './dom';

export const DRAG_TYPE = 'text/stock';

export function renderPalette(boardsEl: HTMLElement, sheetsEl: HTMLElement, store: Store): void {
  for (const s of STOCK) {
    const el = document.createElement('div');
    el.className = 'stock';
    el.draggable = true;
    const dim = s.sheet
      ? `${fmt(s.t)} · ${s.sheet[0] / 12}×${s.sheet[1] / 12} ft`
      : `${fmt(s.t)} × ${fmt(s.w ?? 0)}`;
    el.innerHTML = `<div class="sw" style="background:${hex(s.color)}"></div><div><div class="nm">${esc(s.name)}</div><div class="dim">${dim}</div></div>`;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, s.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('click', () => store.addPart(s.id, [0, 0, 0]));
    (s.sheet ? sheetsEl : boardsEl).appendChild(el);
  }
}
