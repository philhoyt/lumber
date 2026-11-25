/**
 * The stock palette: each stock with a to-scale cross-section thumbnail. Drag a stock
 * onto the scene, or click to add one at the centre. The search box filters by name.
 */
import { getStock, stockVersion, type Stock } from '../stock';
import type { Store } from '../store';
import { fmt, fmtSheet } from '../units';
import { esc, hex } from './dom';

export const DRAG_TYPE = 'text/stock';

/** A little SVG of the cross-section (boards) or the sheet edge (sheets), to scale. */
function thumbnail(s: Stock): string {
  const W = 32;
  const H = 24;
  const fill = hex(s.color);
  if (s.sheet) {
    // A sheet seen on edge: wide and thin, with a faint second line for the far edge.
    const t = Math.max(2, s.t * 4);
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect x="1" y="${H / 2 - t / 2}" width="${W - 2}" height="${t}" rx="1" fill="${fill}" stroke="rgba(0,0,0,.45)"/><rect x="5" y="${H / 2 - t / 2 - 4}" width="${W - 10}" height="${t}" rx="1" fill="${fill}" opacity=".45"/></svg>`;
  }
  // Boards: width across, thickness up, scaled so an 11 1/4" 2x12 still fits.
  const scale = Math.min((W - 4) / 11.25, (H - 4) / 3.5);
  const w = Math.max(3, (s.w ?? 1) * scale);
  const t = Math.max(3, s.t * scale);
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect x="${(W - w) / 2}" y="${(H - t) / 2}" width="${w}" height="${t}" rx="1" fill="${fill}" stroke="rgba(0,0,0,.45)"/></svg>`;
}

export function renderPalette(
  boardsEl: HTMLElement,
  sheetsEl: HTMLElement,
  searchEl: HTMLInputElement,
  store: Store,
): void {
  let items: { el: HTMLElement; text: string }[] = [];
  const applyFilter = () => {
    const q = searchEl.value.trim().toLowerCase();
    for (const it of items) it.el.hidden = !!q && !it.text.includes(q);
  };
  let built = -1;
  const build = () => {
    if (built === stockVersion()) return;
    built = stockVersion();
    boardsEl.textContent = '';
    sheetsEl.textContent = '';
    items = [];
    for (const s of getStock()) {
      const el = document.createElement('div');
      el.className = 'stock';
      el.draggable = true;
      el.title = `Click to add a ${s.name} at the center, or drag it onto the scene`;
      const dim = s.sheet
        ? `${fmt(s.t)} · ${fmtSheet(s.sheet[0], s.sheet[1])}`
        : `${fmt(s.t)} × ${fmt(s.w ?? 0)}`;
      el.innerHTML = `${thumbnail(s)}<div><div class="nm">${esc(s.name)}</div><div class="dim">${dim}</div></div>`;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(DRAG_TYPE, s.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      el.addEventListener('click', () => store.addPart(s.id, [0, 0, 0]));
      (s.sheet ? sheetsEl : boardsEl).appendChild(el);
      items.push({ el, text: `${s.name} ${dim}`.toLowerCase() });
    }
    applyFilter();
  };
  build();
  searchEl.addEventListener('input', applyFilter);
  store.subscribe((kind) => {
    if (kind === 'model') build();
  });
}
