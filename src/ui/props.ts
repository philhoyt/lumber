/** The Part panel: name, stock, size and position of the selection, plus the part actions. */
import { aabbSize, unionAABB, withMinKept, type Axis } from '../model';
import { STOCK, stockById } from '../stock';
import type { Store } from '../store';
import { fmt, parseLen } from '../units';
import { esc, onChange, onClick } from './dom';

export class PropsPanel {
  constructor(
    private el: HTMLElement,
    private store: Store,
  ) {
    store.subscribe(() => this.render());
    this.render();
  }

  render(): void {
    const { store, el } = this;
    const list = store.selectedParts();
    if (!list.length) {
      el.innerHTML =
        '<h2>Part</h2><div class="empty">Nothing selected. Click a part, or drag stock in from the left.</div>';
      return;
    }
    const u = unionAABB(list);
    const size = aabbSize(u);
    let html = '';
    if (list.length === 1) {
      const p = list[0]!;
      const s = stockById(p.stock);
      const options = STOCK.map(
        (x) =>
          `<option value="${x.id}" ${x.id === p.stock ? 'selected' : ''}>${esc(x.name)}</option>`,
      ).join('');
      html += `<h2>Part</h2>
        <div class="row"><div><label class="small">Name</label><input type="text" id="pName" value="${esc(p.name)}"></div>
        <div><label class="small">Stock</label><select id="pStock">${options}</select></div></div>
        <div class="row"><div><label class="small">Length</label><input type="text" id="pLen" value="${fmt(p.len)}"></div>
        ${
          s.sheet
            ? `<div><label class="small">Width</label><input type="text" id="pW" value="${fmt(p.w ?? s.sheet[0])}"></div>`
            : `<div><label class="small">Section</label><div class="static">${fmt(s.t)} × ${fmt(s.w ?? 0)}</div></div>`
        }</div>`;
    } else {
      html += `<h2>${list.length} parts</h2>`;
    }
    html += `<div class="row"><div><label class="small">X (left)</label><input type="text" id="pX" value="${fmt(u.min[0])}"></div><div><label class="small">Y (bottom)</label><input type="text" id="pY" value="${fmt(u.min[1])}"></div><div><label class="small">Z (front)</label><input type="text" id="pZ" value="${fmt(u.min[2])}"></div></div>
      <div class="muted footprint">Footprint ${fmt(size[0])} × ${fmt(size[2])}, height ${fmt(size[1])}</div>
      <div class="row btns"><button id="bRotY" title="R">Rotate ↻ (R)</button><button id="bRotX" title="T">Tip (T)</button><button id="bRotZ" title="F">Flip (F)</button></div>
      <div class="row btns"><button id="bDup" title="Ctrl+D">Duplicate</button><button id="bDel" class="danger" title="Delete">Delete</button></div>
      <div class="row"><div><label class="small">Array along</label><select id="arrAxis"><option value="x">X</option><option value="z">Z</option><option value="y">Y</option></select></div>
        <div><label class="small">Count</label><input type="number" id="arrN" value="4" min="2" step="1"></div><div><label class="small">On center</label><input type="text" id="arrS" value="16"></div><div class="grow0"><button id="bArr">Array</button></div></div>`;
    el.innerHTML = html;

    if (list.length === 1) {
      const p = list[0]!;
      onChange(el, 'pName', (i) => store.mutate(() => (p.name = i.value)));
      onChange(el, 'pStock', (i) =>
        store.mutate(() =>
          withMinKept(p, () => {
            const was = stockById(p.stock);
            const ns = stockById(i.value);
            p.stock = ns.id;
            if (ns.sheet && !was.sheet) {
              p.w = ns.sheet[0];
              p.len = ns.sheet[1];
            }
            if (!ns.sheet) p.w = undefined;
          }),
        ),
      );
      onChange(el, 'pLen', (i) => {
        const v = parseLen(i.value);
        if (v !== null && v > 0) store.mutate(() => withMinKept(p, () => (p.len = v)));
        else this.render();
      });
      onChange(el, 'pW', (i) => {
        const v = parseLen(i.value);
        if (v !== null && v > 0) store.mutate(() => withMinKept(p, () => (p.w = v)));
        else this.render();
      });
    }
    const moveTo = (axis: 0 | 1 | 2, text: string) => {
      const v = parseLen(text);
      if (v === null) return this.render();
      const d = v - u.min[axis];
      store.mutate(() => list.forEach((p) => (p.pos[axis] += d)));
    };
    onChange(el, 'pX', (i) => moveTo(0, i.value));
    onChange(el, 'pY', (i) => moveTo(1, i.value));
    onChange(el, 'pZ', (i) => moveTo(2, i.value));
    onClick(el, 'bRotY', () => store.rotateSelected('y'));
    onClick(el, 'bRotX', () => store.rotateSelected('x'));
    onClick(el, 'bRotZ', () => store.rotateSelected('z'));
    onClick(el, 'bDup', () => store.duplicateSelected());
    onClick(el, 'bDel', () => store.deleteSelected());
    onClick(el, 'bArr', () => {
      const axis = el.querySelector<HTMLSelectElement>('#arrAxis')!.value as Axis;
      const count = +el.querySelector<HTMLInputElement>('#arrN')!.value;
      const spacing = parseLen(el.querySelector<HTMLInputElement>('#arrS')!.value) ?? 16;
      store.arraySelected(axis, count, spacing);
    });
  }
}
