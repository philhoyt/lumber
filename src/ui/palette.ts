/**
 * The stock palette: each stock with a to-scale cross-section thumbnail. Drag a stock
 * onto the scene, or click to add one at the centre. The search box filters by name.
 */
import { getStock, stockVersion, type Stock } from '../stock';
import type { Store } from '../store';
import { addStock, recentStock } from './recent';
import { fmt, fmtSheet } from '../units';
import { esc, hex } from './dom';

export const DRAG_TYPE = 'text/stock';

/** A little SVG of the cross-section (boards) or the sheet edge (sheets), to scale. */
function thumbnail(s: Stock): string {
  const W = 32;
  const H = 24;
  const fill = hex(s.color);
  if (s.shape === 'cylinder') {
    // A can seen from slightly above: a body with an elliptical lid.
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="M9 6 v12 a7 3 0 0 0 14 0 v-12" fill="${fill}" stroke="rgba(0,0,0,.45)"/><ellipse cx="16" cy="6" rx="7" ry="3" fill="${fill}" stroke="rgba(0,0,0,.45)"/></svg>`;
  }
  if (s.reference) {
    // A box in a corner view: the front face with its top and side set back.
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="M7 8 l5 -4 h13 l-5 4 z" fill="${fill}" opacity=".75" stroke="rgba(0,0,0,.45)"/><path d="M20 8 l5 -4 v12 l-5 4 z" fill="${fill}" opacity=".55" stroke="rgba(0,0,0,.45)"/><rect x="7" y="8" width="13" height="12" fill="${fill}" stroke="rgba(0,0,0,.45)"/></svg>`;
  }
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
  recentEl: HTMLElement,
  boardsEl: HTMLElement,
  sheetsEl: HTMLElement,
  refEl: HTMLElement,
  searchEl: HTMLInputElement,
  store: Store,
): void {
  let items: { el: HTMLElement; text: string }[] = [];
  let recentItems: { el: HTMLElement; text: string }[] = [];
  const applyFilter = () => {
    const q = searchEl.value.trim().toLowerCase();
    for (const it of [...items, ...recentItems]) it.el.hidden = !!q && !it.text.includes(q);
  };
  const makeItem = (s: Stock): { el: HTMLElement; text: string } => {
    const el = document.createElement('div');
    el.className = 'stock';
    el.draggable = true;
    el.title = s.reference
      ? 'A stand-in for something to design around. It is not cut or bought. Click to add, or drag it onto the scene'
      : `Click to add a ${s.name} at the center, or drag it onto the scene`;
    const dim =
      s.shape === 'cylinder' && s.sheet
        ? `⌀${fmt(s.sheet[0])} × ${fmt(s.t)} tall`
        : s.sheet
          ? `${fmt(s.t)} · ${fmtSheet(s.sheet[0], s.sheet[1])}`
          : `${fmt(s.t)} × ${fmt(s.w ?? 0)}`;
    el.innerHTML = `${thumbnail(s)}<div><div class="nm">${esc(s.name)}</div><div class="dim">${dim}</div></div>`;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, s.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('click', () => addStock(store, s.id, [0, 0, 0]));
    return { el, text: `${s.name} ${dim}`.toLowerCase() };
  };
  // The stock used lately, on top; the heading hides when there is none.
  let shownRecent = '';
  const buildRecent = () => {
    const ids = recentStock();
    const key = ids.join(',') + '|' + String(stockVersion());
    if (key === shownRecent) return;
    shownRecent = key;
    recentEl.textContent = '';
    recentItems = [];
    const byId = new Map(getStock().map((s) => [s.id, s]));
    for (const id of ids) {
      const s = byId.get(id);
      if (!s) continue;
      const it = makeItem(s);
      recentEl.appendChild(it.el);
      recentItems.push(it);
    }
    recentEl.hidden = !recentItems.length;
    recentEl.previousElementSibling?.toggleAttribute('hidden', !recentItems.length);
    applyFilter();
  };
  let built = -1;
  const build = () => {
    if (built === stockVersion()) return;
    built = stockVersion();
    boardsEl.textContent = '';
    sheetsEl.textContent = '';
    refEl.textContent = '';
    items = [];
    for (const s of getStock()) {
      const it = makeItem(s);
      (s.reference ? refEl : s.sheet ? sheetsEl : boardsEl).appendChild(it.el);
      items.push(it);
    }
    applyFilter();
  };
  build();
  buildRecent();
  searchEl.addEventListener('input', applyFilter);
  store.subscribe((kind) => {
    if (kind === 'model') {
      build();
      buildRecent();
    }
  });
}
