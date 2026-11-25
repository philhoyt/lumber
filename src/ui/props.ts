/** The Part panel: name, stock, size and position of the selection, plus the part actions. */
import { aabbSize, unionAABB, withMinKept, type AlignMode, type Axis } from '../model';
import { STOCK, stockById } from '../stock';
import type { Store } from '../store';
import { fmt, parseLen } from '../units';
import { esc, onChange, onClick } from './dom';
import { keepFocus } from './fields';

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
    const hidden = store.parts.filter((p) => p.hidden).length;
    const hiddenNote = hidden
      ? `<div class="muted note">${hidden} hidden part${hidden === 1 ? '' : 's'} · Alt+H shows them</div>`
      : '';
    if (!list.length) {
      el.innerHTML = `<h2>Part</h2><div class="empty">Nothing selected. Click a part, or drag stock in from the left.</div>${hiddenNote}`;
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
        <div class="row"><div><label class="small">Length (S)</label><input type="text" class="len" data-min="0.0625" id="pLen" value="${fmt(p.len)}"></div>
        ${
          s.sheet
            ? `<div><label class="small">Width</label><input type="text" class="len" data-min="0.0625" id="pW" value="${fmt(p.w ?? s.sheet[0])}"></div>`
            : `<div><label class="small">Section</label><div class="static">${fmt(s.t)} × ${fmt(s.w ?? 0)}</div></div>`
        }</div>`;
    } else {
      html += `<h2>${list.length} parts</h2>`;
    }
    html += `<div class="row"><div><label class="small">X (left)</label><input type="text" class="len" id="pX" value="${fmt(u.min[0])}"></div><div><label class="small">Y (front)</label><input type="text" class="len" id="pY" value="${fmt(u.min[1])}"></div><div><label class="small">Z (bottom)</label><input type="text" class="len" id="pZ" value="${fmt(u.min[2])}"></div></div>
      <div class="muted footprint">Footprint ${fmt(size[0])} × ${fmt(size[1])}, height ${fmt(size[2])}</div>
      <label class="small">Rotate 90° (R, then axis)</label>
      <div class="row btns"><button id="bRotX" title="R X">About X</button><button id="bRotY" title="R Y">About Y</button><button id="bRotZ" title="R Z">About Z</button></div>
      <div class="row btns"><button id="bDrop" title="Alt+G: rest on the floor or the parts below">Drop</button><button id="bDup" title="Shift+D, or Ctrl+D for an offset copy">Duplicate</button><button id="bHide" title="H">Hide</button><button id="bDel" class="danger" title="X or Delete">Delete</button></div>`;
    if (list.length > 1) {
      const btn = (axis: number, mode: string, label: string, title: string) =>
        `<button data-align="${axis}:${mode}" title="${title}">${label}</button>`;
      html += `<label class="small">Align</label>
      <div class="row btns align">${btn(0, 'min', 'Left', 'Flush on the left (min X)')}${btn(0, 'center', 'Center X', 'Centre on X')}${btn(0, 'max', 'Right', 'Flush on the right (max X)')}</div>
      <div class="row btns align">${btn(1, 'min', 'Front', 'Flush at the front (min Y)')}${btn(1, 'center', 'Center Y', 'Centre on Y')}${btn(1, 'max', 'Back', 'Flush at the back (max Y)')}</div>
      <div class="row btns align">${btn(2, 'min', 'Bottom', 'Flush on the bottom (min Z)')}${btn(2, 'center', 'Center Z', 'Centre on Z')}${btn(2, 'max', 'Top', 'Flush on top (max Z)')}</div>`;
    }
    html += `<div class="row"><div><label class="small">Array along</label><select id="arrAxis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></div>
        <div><label class="small">Count</label><input type="number" id="arrN" value="4" min="2" step="1"></div><div><label class="small">On center</label><input type="text" class="len" data-min="0.0625" id="arrS" value="16"></div><div class="grow0"><button id="bArr">Array</button></div></div>${hiddenNote}`;
    const restoreFocus = keepFocus(el);
    el.innerHTML = html;
    restoreFocus();

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
    onClick(el, 'bRotX', () => store.rotateSelected('x'));
    onClick(el, 'bRotY', () => store.rotateSelected('y'));
    onClick(el, 'bRotZ', () => store.rotateSelected('z'));
    onClick(el, 'bDrop', () => store.dropSelected());
    onClick(el, 'bHide', () => store.hideSelected());
    el.querySelectorAll<HTMLButtonElement>('[data-align]').forEach((b) =>
      b.addEventListener('click', () => {
        const [axis, mode] = b.dataset.align!.split(':');
        store.alignSelected(+axis! as 0 | 1 | 2, mode as AlignMode);
      }),
    );
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
