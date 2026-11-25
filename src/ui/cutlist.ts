/** The cut list and buy list panel, with cutting diagrams and a cost estimate. */
import { cutRows, packBoards, packSheets, partsByStock } from '../pack';
import { grainOf } from '../model';
import { stockById } from '../stock';
import type { Store } from '../store';
import { fmt, fmtFt, fmtSheet, money, parseLen } from '../units';
import { esc, hex } from './dom';
import { keepFocus } from './fields';

const DIAGRAM_W = 300;
const BAR_H = 14;
const LABEL = 'font-size="9" text-anchor="middle" fill="#1b1c1f" font-family="system-ui"';

export class CutlistPanel {
  constructor(
    private el: HTMLElement,
    private store: Store,
  ) {
    store.subscribe((kind) => {
      if (kind === 'model' || kind === 'settings') this.render();
    });
    this.render();
  }

  render(): void {
    const { store, el } = this;
    const { parts, settings } = store;
    if (!parts.length) {
      el.innerHTML = '<div class="muted">Add parts and the cut list writes itself.</div>';
      return;
    }
    let html = `<table><tr><th>Stock</th><th>Cut</th><th class="r">Qty</th><th>Parts</th></tr>`;
    for (const r of cutRows(parts)) {
      const mitered = r.miter[0] !== 0 || r.miter[1] !== 0;
      const grainMark =
        r.grain === 'length'
          ? ' <span class="muted" title="Length runs with the grain">∥ grain</span>'
          : r.grain === 'width'
            ? ' <span class="muted" title="Length runs across the grain">⊥ grain</span>'
            : '';
      const cut = r.stock.sheet
        ? `${fmt(r.w)} × ${fmt(r.len)}${grainMark}`
        : mitered
          ? `${fmt(r.len)} <span class="muted">long · ${fmt(r.short)} short · ${angleText(r.miter)}</span>`
          : fmt(r.len);
      html += `<tr><td>${esc(r.stock.name)}</td><td>${cut}</td><td class="r">${r.qty}</td><td class="muted names">${esc(r.names.join(', '))}</td></tr>`;
    }
    html += `</table>`;
    html += `<h2 class="buy-head">Buy list <span>kerf <input class="price len" data-min="0" id="kerfIn" value="${fmt(settings.kerf)}"></span></h2>`;

    let total = 0;
    for (const [stockId, list] of partsByStock(parts)) {
      const s = stockById(stockId);
      const price = s.price;
      const priceInput = `<input class="price" data-price="${s.id}" value="${price.toFixed(2)}">`;
      if (!s.sheet) {
        const lengths = s.lengths ?? [96];
        const L = settings.stockLen[s.id] ?? lengths[0]!;
        const bins = packBoards(
          list.map((p) => ({ len: p.len, name: p.name })),
          L,
          settings.kerf,
        );
        const cost = bins.length * price;
        total += cost;
        const lenOptions = lengths
          .map((l) => `<option value="${l}" ${l === L ? 'selected' : ''}>${fmtFt(l)}</option>`)
          .join('');
        html += `<div class="grp"><span>${bins.length} × ${esc(s.name)} @ ${fmtFt(L)}</span><span><select data-stock="${s.id}" class="lenSel">${lenOptions}</select> ${priceInput} = ${money(cost)}</span></div>`;
        for (const b of bins) {
          const sc = DIAGRAM_W / L;
          let x = 0;
          let svg = `<svg viewBox="0 0 ${DIAGRAM_W} ${BAR_H + 2}"><rect x="0" y="1" width="${DIAGRAM_W}" height="${BAR_H}" fill="#3a3326" stroke="#555"/>`;
          for (const it of b.items) {
            const w = it.len * sc;
            svg += `<rect x="${x}" y="1" width="${Math.max(w, 1)}" height="${BAR_H}" fill="${hex(s.color)}" stroke="#1b1c1f" stroke-width="0.6"/>`;
            if (w > 22)
              svg += `<text x="${x + w / 2}" y="${BAR_H / 2 + 4.5}" ${LABEL}>${esc(fmt(it.len))}</text>`;
            x += w + settings.kerf * sc;
          }
          svg += `</svg>`;
          const cap = b.over
            ? `<span class="warn">— longer than ${fmtFt(L)}</span>`
            : ` · offcut ${fmt(L - b.used)}`;
          html += `<div class="bin">${svg}<div class="cap">${b.items.map((i) => fmt(i.len)).join(' + ')}${cap}</div></div>`;
        }
      } else {
        const [SW, SL] = s.sheet;
        const sheets = packSheets(
          list.map((p) => ({
            w: p.w ?? SW,
            l: p.len,
            name: p.name,
            grain: s.grain === false ? 'any' : grainOf(p),
          })),
          SW,
          SL,
          settings.kerf,
        );
        const cost = sheets.length * price;
        total += cost;
        html += `<div class="grp"><span>${sheets.length} × ${esc(s.name)} ${fmtSheet(SW, SL)}</span><span>${priceInput} = ${money(cost)}</span></div>`;
        for (const sh of sheets) {
          const sc = DIAGRAM_W / SL;
          const H = SW * sc;
          let svg = `<svg viewBox="0 0 ${DIAGRAM_W} ${H + 2}"><rect x="0" y="1" width="${DIAGRAM_W}" height="${H}" fill="#3a3326" stroke="#555"/>`;
          let used = 0;
          for (const shelf of sh.shelves)
            for (const it of shelf.items) {
              used += it.a * it.b;
              svg += `<rect x="${it.x * sc}" y="${1 + it.y * sc}" width="${it.a * sc}" height="${it.b * sc}" fill="${hex(s.color)}" stroke="#1b1c1f" stroke-width="0.6"/>`;
              // Grain lines run the sheet's long way on stock that has grain.
              if (s.grain !== false)
                for (let k = 1; k <= 3; k++) {
                  const y = 1 + (it.y + (it.b * k) / 4) * sc;
                  svg += `<line x1="${(it.x + 1) * sc}" y1="${y}" x2="${(it.x + it.a - 1) * sc}" y2="${y}" stroke="rgba(0,0,0,.18)" stroke-width="0.6"/>`;
                }
              svg += `<text x="${(it.x + it.a / 2) * sc}" y="${1 + (it.y + it.b / 2) * sc + 3.5}" ${LABEL}>${esc(fmt(it.b) + '×' + fmt(it.a))}</text>`;
            }
          svg += `</svg>`;
          const cap = sh.over
            ? `<span class="warn">${esc(sh.over.name)} does not fit on one sheet</span>`
            : `${Math.round((used / (SW * SL)) * 100)}% used · shelf layout${s.grain === false ? ' · no grain' : ' · grain runs the long way'}`;
          html += `<div class="bin">${svg}<div class="cap">${cap}</div></div>`;
        }
      }
    }
    html += `<div class="total"><span>Estimated total</span><span>${money(total)}</span></div><div class="muted note">Prices are placeholders; edit them per stock. Board feet and sheet nesting with grain come later.</div>`;
    const restoreFocus = keepFocus(el);
    el.innerHTML = html;
    restoreFocus();

    el.querySelectorAll<HTMLSelectElement>('.lenSel').forEach((sel) =>
      sel.addEventListener('change', () => {
        store.setSetting('stockLen', { ...settings.stockLen, [sel.dataset.stock!]: +sel.value });
      }),
    );
    el.querySelectorAll<HTMLInputElement>('[data-price]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (!isNaN(v)) store.updateStock(inp.dataset.price!, { price: v });
        else this.render();
      }),
    );
    const kerfIn = el.querySelector<HTMLInputElement>('#kerfIn')!;
    kerfIn.addEventListener('change', () => {
      const v = parseLen(kerfIn.value);
      if (v !== null && v >= 0) store.setSetting('kerf', v);
      else this.render();
    });
  }
}

/** "45°/45°" with the short-point edge marked. */
export function angleText(m: [number, number]): string {
  const one = (a: number) => (a === 0 ? 'square' : `${Math.abs(a)}°${a > 0 ? '▴' : '▾'}`);
  return `${one(m[0])} / ${one(m[1])}`;
}

/** The cut list as CSV text. */
export function cutListCsv(store: Store): string {
  const rows: (string | number)[][] = [
    [
      'Part',
      'Stock',
      'Thickness',
      'Width',
      'Length (long point)',
      'Short point',
      'Miter A',
      'Miter B',
      'Grain',
      'Qty',
    ],
  ];
  for (const r of cutRows(store.parts))
    rows.push([
      r.names.join('; '),
      r.stock.name,
      r.stock.t,
      r.w,
      r.len,
      r.short,
      r.miter[0],
      r.miter[1],
      r.grain,
      r.qty,
    ]);
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
