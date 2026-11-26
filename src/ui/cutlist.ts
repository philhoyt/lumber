/** The cut list and buy list panel, with cutting diagrams and a cost estimate. */
import { cutRows, packBoards, packBoardsAuto, packSheets, partsByStock } from '../pack';
import { isReferencePart } from '../model';
import { hardwareRows, kindInfo } from '../fastener';
import { describeCut, grainOf } from '../model';
import { sawBevel } from '../model';
import { boardFeet, stockById } from '../stock';
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
    const { settings } = store;
    const parts = store.parts.filter((p) => !isReferencePart(p));
    if (!parts.length) {
      el.innerHTML = '<div class="muted">Add parts and the cut list writes itself.</div>';
      return;
    }
    let html = `<table><tr><th>Stock</th><th>Cut</th><th class="r">Qty</th><th>Parts</th></tr>`;
    for (const r of cutRows(parts)) {
      const mitered = r.miter[0] !== 0 || r.miter[1] !== 0;
      const beveled = r.bevel[0] !== 0 || r.bevel[1] !== 0;
      const ends = [
        mitered ? `miter ${angleText(r.miter)}` : '',
        beveled ? `bevel ${angleText(r.bevel, 'top', 'bottom')}` : '',
        ...([0, 1] as const)
          .filter((e) => r.miter[e] && r.bevel[e])
          .map(
            (e) =>
              `saw ${e ? 'B' : 'A'}: ${Math.abs(r.miter[e])}° / ${sawBevel(r.miter[e], r.bevel[e])}°`,
          ),
      ]
        .filter(Boolean)
        .join(' · ');
      const grainMark =
        r.grain === 'length'
          ? ' <span class="muted" title="Length runs with the grain">∥ grain</span>'
          : r.grain === 'width'
            ? ' <span class="muted" title="Length runs across the grain">⊥ grain</span>'
            : '';
      const cut = r.stock.sheet
        ? `${fmt(r.w)} × ${fmt(r.len)}${grainMark}`
        : mitered || beveled
          ? `${fmt(r.len)} <span class="muted">long · ${fmt(r.short)} short · ${ends}</span>`
          : fmt(r.len);
      const joinery = r.cuts.length
        ? `<div class="muted joinery">${r.cuts.map((c) => esc(describeCut(c, fmt))).join('<br>')}</div>`
        : '';
      html += `<tr><td>${esc(r.stock.name)}</td><td>${cut}${joinery}</td><td class="r">${r.qty}</td><td class="muted names">${esc(r.names.join(', '))}</td></tr>`;
    }
    html += `</table>`;
    html += `<h2 class="buy-head">Buy list <span>kerf <input class="price len" data-min="0" id="kerfIn" value="${fmt(settings.kerf)}"></span></h2>`;

    let total = 0;
    let totalBf = 0;
    let totalSqFt = 0;
    for (const [stockId, list] of partsByStock(parts)) {
      const s = stockById(stockId);
      const price = s.price;
      const perBf = s.priceUnit === 'bf';
      const priceInput = `<input class="price" data-price="${s.id}" value="${price.toFixed(2)}" title="${perBf ? 'Price per board foot' : 'Price per piece'}">${perBf ? '<span class="muted">/bf</span>' : ''}`;
      if (!s.sheet) {
        const lengths = s.lengths ?? [96];
        const chosen = settings.stockLen[s.id] ?? 0; // 0: pick the least-waste length
        const items = list.map((p) => ({ len: p.len, name: p.name }));
        const { length: L, bins } =
          chosen > 0
            ? { length: chosen, bins: packBoards(items, chosen, settings.kerf) }
            : packBoardsAuto(items, lengths, settings.kerf);
        const partsBf = list.reduce((sum, p) => sum + boardFeet(s, p.len), 0);
        const boughtBf = boardFeet(s, L) * bins.length;
        totalBf += boughtBf;
        // A per-piece price is for the first listed length; longer boards cost in proportion.
        const pieceCost = perBf ? 0 : price * (L / (lengths[0] ?? L));
        const cost = perBf ? boughtBf * price : bins.length * pieceCost;
        total += cost;
        const lenOptions = [
          `<option value="0"${chosen === 0 ? ' selected' : ''}>Auto · ${fmtFt(L)}</option>`,
          ...lengths.map(
            (l) => `<option value="${l}"${l === chosen ? ' selected' : ''}>${fmtFt(l)}</option>`,
          ),
        ].join('');
        html += `<div class="grp"><span>${bins.length} × ${esc(s.name)} @ ${fmtFt(L)}</span><span><select data-stock="${s.id}" class="lenSel" title="Purchase length; Auto buys the least total length">${lenOptions}</select> ${priceInput} = ${money(cost)}</span></div>
        <div class="muted bf">${partsBf.toFixed(1)} bf of parts · ${boughtBf.toFixed(1)} bf bought · ${Math.round((partsBf / Math.max(boughtBf, 1e-9)) * 100)}% used</div>`;
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
        totalSqFt += (sheets.length * SW * SL) / 144;
        html += `<div class="grp"><span>${sheets.length} × ${esc(s.name)} ${fmtSheet(SW, SL)}</span><span>${priceInput} = ${money(cost)}</span></div>`;
        for (const sh of sheets) {
          const sc = DIAGRAM_W / SL;
          const H = SW * sc;
          let svg = `<svg viewBox="0 0 ${DIAGRAM_W} ${H + 2}"><rect x="0" y="1" width="${DIAGRAM_W}" height="${H}" fill="#3a3326" stroke="#555"/>`;
          let used = 0;
          for (const it of sh.items) {
            {
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
          }
          // The saw cuts in order, numbered at their midpoints.
          sh.cuts.forEach((c, k) => {
            svg += `<line x1="${c.x1 * sc}" y1="${1 + c.y1 * sc}" x2="${c.x2 * sc}" y2="${1 + c.y2 * sc}" stroke="#e8e6e1" stroke-width="0.8" stroke-dasharray="3 2"/>`;
            const mx = ((c.x1 + c.x2) / 2) * sc;
            const my = 1 + ((c.y1 + c.y2) / 2) * sc;
            svg += `<circle cx="${mx}" cy="${my}" r="5" fill="#e8e6e1"/><text x="${mx}" y="${my + 2.6}" font-size="7" text-anchor="middle" fill="#1b1c1f" font-family="system-ui" font-weight="700">${k + 1}</text>`;
          });
          svg += `</svg>`;
          const cap = sh.over
            ? `<span class="warn">${esc(sh.over.name)} does not fit on one sheet</span>`
            : `${Math.round((used / (SW * SL)) * 100)}% used · ${sh.cuts.length} cut${sh.cuts.length === 1 ? '' : 's'} in the numbered order${s.grain === false ? ' · no grain' : ' · grain runs the long way'}`;
          html += `<div class="bin">${svg}<div class="cap">${cap}</div></div>`;
        }
      }
    }
    const hardware = hardwareRows(parts);
    if (hardware.length) {
      html += `<h3 class="hw-head">Hardware</h3>`;
      for (const r of hardware) {
        // The usual sizes already name the kind ("1 1/4\" pocket screw"); custom ones may not.
        const label = kindInfo(r.kind).label.toLowerCase();
        const kind = r.size.toLowerCase().includes(label.split(' ').pop()!)
          ? ''
          : ` <span class="muted">${esc(label)}</span>`;
        html += `<div class="grp"><span>${r.qty} × ${esc(r.size)}${kind}</span><span class="muted names">${esc(r.names.join(', '))}</span></div>`;
      }
    }
    const totals: string[] = [];
    if (totalBf) totals.push(`${totalBf.toFixed(1)} board feet of lumber`);
    if (totalSqFt) totals.push(`${totalSqFt.toFixed(0)} sq ft of sheet goods`);
    html += `<div class="total"><span>Estimated total</span><span>${money(total)}</span></div>${totals.length ? `<div class="muted bf">${totals.join(' · ')}</div>` : ''}<div class="muted note">Prices come from the stock table; edit them there or here. A per-piece price is for the first listed length and scales with the length bought. Board feet use the nominal size (2x4 is 2 × 4) over the length bought.</div>`;
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
/** "20°▴ / square": each end's angle with where the short point is (▴ back or top, ▾ front or bottom). */
export function angleText(m: [number, number], up = 'back', down = 'front'): string {
  const one = (a: number) =>
    a === 0
      ? 'square'
      : `<span title="Short point on the ${a > 0 ? up : down}">${Math.abs(a)}°${a > 0 ? '▴' : '▾'}</span>`;
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
      'Bevel A',
      'Bevel B',
      'Grain',
      'Cuts',
      'Qty',
      'Board feet',
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
      r.bevel[0],
      r.bevel[1],
      r.grain,
      r.cuts.map((c) => describeCut(c, fmt)).join('; '),
      r.qty,
      r.stock.sheet ? '' : (boardFeet(r.stock, r.len) * r.qty).toFixed(2),
    ]);
  const hardware = hardwareRows(store.parts);
  if (hardware.length) {
    rows.push([], ['Hardware', 'Size', 'Qty', 'Parts']);
    for (const r of hardware)
      rows.push([kindInfo(r.kind).label, r.size, r.qty, r.names.join('; ')]);
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
