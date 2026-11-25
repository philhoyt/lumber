/**
 * The stock table editor: a dialog listing boards and sheets with editable sizes,
 * purchase lengths, prices and colors. Changes apply at once and are undoable; parts
 * follow their stock. Sizes accept metric ("38mm") and show in inches.
 */
import { Plus, RotateCcw, Trash2, X } from 'lucide';
import type { Store } from '../store';
import { fmt, fmtFt, parseLen } from '../units';
import { esc, hex } from './dom';
import { keepFocus } from './fields';
import { icon } from './icons';

export class StockEditor {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;

  constructor(
    host: HTMLElement,
    private store: Store,
  ) {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'stock-dlg';
    this.dialog.innerHTML = `<div class="dlg-head"><h2>Stock</h2><span class="muted">Actual sizes in inches; metric works too (38mm). Changes apply at once and parts follow.</span><span class="spacer"></span><button class="icon ghost" id="stClose" title="Close (Esc)"></button></div><div class="dlg-body"></div><div class="dlg-foot"><button id="stAddBoard"></button><button id="stAddSheet"></button><span class="spacer"></span><button id="stReset" class="ghost" title="Back to the built-in library"></button></div>`;
    host.appendChild(this.dialog);
    this.body = this.dialog.querySelector('.dlg-body')!;
    const close = this.dialog.querySelector<HTMLButtonElement>('#stClose')!;
    close.appendChild(icon(X));
    close.onclick = () => this.dialog.close();
    const addBoard = this.dialog.querySelector<HTMLButtonElement>('#stAddBoard')!;
    addBoard.append(icon(Plus, 14), 'Board');
    addBoard.onclick = () => this.store.addStock('board');
    const addSheet = this.dialog.querySelector<HTMLButtonElement>('#stAddSheet')!;
    addSheet.append(icon(Plus, 14), 'Sheet');
    addSheet.onclick = () => this.store.addStock('sheet');
    const reset = this.dialog.querySelector<HTMLButtonElement>('#stReset')!;
    reset.append(icon(RotateCcw, 14), 'Reset to defaults');
    reset.onclick = () => this.store.resetStock();
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    this.body.addEventListener('change', this.onChange);
    store.subscribe((kind) => {
      if (kind === 'model' && this.dialog.open) this.render();
    });
  }

  get open(): boolean {
    return this.dialog.open;
  }
  show(): void {
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }
  hide(): void {
    this.dialog.close();
  }

  private render(): void {
    const { store, body } = this;
    const restore = keepFocus(body);
    const boards = store.stock.filter((s) => !s.sheet);
    const sheets = store.stock.filter((s) => s.sheet);
    const len = (id: string, field: string, value: number, min = 0.0625) =>
      `<input type="text" class="len" data-min="${min}" id="st-${id}-${field}" value="${fmt(value)}">`;
    const common = (s: (typeof boards)[number]) =>
      `<td><input type="color" id="st-${s.id}-color" value="${hex(s.color)}" title="Color"></td><td><input type="text" id="st-${s.id}-name" value="${esc(s.name)}"></td>`;
    const tail = (s: (typeof boards)[number]) => {
      const used = store.stockUseCount(s.id);
      return `<td><input type="text" class="price" id="st-${s.id}-price" value="${s.price.toFixed(2)}"></td><td><button class="icon ghost danger" data-del="${s.id}" ${used ? `disabled title="Used by ${used} part${used === 1 ? '' : 's'}"` : 'title="Delete"'}></button></td>`;
    };
    let html = `<h3>Boards</h3><table class="stock-table"><tr><th></th><th>Name</th><th>Thick</th><th>Wide</th><th>Sold as</th><th>Price</th><th></th></tr>`;
    for (const s of boards)
      html += `<tr>${common(s)}<td>${len(s.id, 't', s.t)}</td><td>${len(s.id, 'w', s.w ?? 0)}</td><td><input type="text" id="st-${s.id}-lengths" value="${esc((s.lengths ?? []).map(fmtFt).join(', '))}" title="Purchase lengths, e.g. 8 ft, 10 ft, 12 ft"></td>${tail(s)}</tr>`;
    html += `</table><h3>Sheets</h3><table class="stock-table"><tr><th></th><th>Name</th><th>Thick</th><th>Wide</th><th>Long</th><th title="Untick for MDF, OSB and other stock with no grain to respect">Grain</th><th>Price</th><th></th></tr>`;
    for (const s of sheets)
      html += `<tr>${common(s)}<td>${len(s.id, 't', s.t)}</td><td>${len(s.id, 'sw', s.sheet![0], 1)}</td><td>${len(s.id, 'sl', s.sheet![1], 1)}</td><td><input type="checkbox" id="st-${s.id}-grain"${s.grain === false ? '' : ' checked'}></td>${tail(s)}</tr>`;
    html += `</table>`;
    body.innerHTML = html;
    body.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => {
      b.appendChild(icon(Trash2, 14));
      b.addEventListener('click', () => store.deleteStock(b.dataset.del!));
    });
    restore();
  }

  private onChange = (e: Event): void => {
    const el = e.target as HTMLInputElement;
    const m = /^st-(.+)-(name|color|t|w|sw|sl|lengths|price|grain)$/.exec(el.id);
    if (!m) return;
    const [, id, field] = m;
    const s = this.store.stock.find((x) => x.id === id);
    if (!s) return;
    const num = () => parseLen(el.value);
    switch (field) {
      case 'name':
        if (el.value.trim()) this.store.updateStock(id!, { name: el.value.trim() });
        else this.render();
        break;
      case 'color':
        this.store.updateStock(id!, { color: parseInt(el.value.slice(1), 16) });
        break;
      case 't': {
        const v = num();
        if (v && v > 0) this.store.updateStock(id!, { t: v });
        else this.render();
        break;
      }
      case 'w': {
        const v = num();
        if (v && v > 0) this.store.updateStock(id!, { w: v });
        else this.render();
        break;
      }
      case 'sw':
      case 'sl': {
        const v = num();
        if (v && v > 0 && s.sheet)
          this.store.updateStock(id!, {
            sheet: field === 'sw' ? [v, s.sheet[1]] : [s.sheet[0], v],
          });
        else this.render();
        break;
      }
      case 'lengths': {
        const list = el.value
          .split(/[,;]/)
          .map((x) => parseLen(x))
          .filter((x): x is number => x !== null && x > 0)
          .sort((a, b) => a - b);
        if (list.length) this.store.updateStock(id!, { lengths: list });
        else this.render();
        break;
      }
      case 'grain':
        this.store.updateStock(id!, { grain: el.checked ? undefined : false });
        break;
      case 'price': {
        const v = parseFloat(el.value);
        if (!isNaN(v) && v >= 0) this.store.updateStock(id!, { price: v });
        else this.render();
        break;
      }
    }
  };
}
