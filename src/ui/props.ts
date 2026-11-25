/**
 * The properties panel: the selection in collapsible sections. Part (name, stock, size),
 * Transform (position, rotation), Arrange (duplicate, group, hide, align), Fasteners and
 * Array.
 */
import { ChevronDown, ChevronRight } from 'lucide';
import {
  aabbSize,
  clampCut,
  clampMiter,
  cutsOf,
  CUT_KINDS,
  defaultCut,
  partDims,
  type Cut,
  grainOf,
  GRAINS,
  miterOf,
  unionAABB,
  withMinKept,
  type AlignMode,
  type ArrayParams,
  type Axis,
  type AxisIndex,
  type Part,
} from '../model';
import {
  FACES as FASTENER_FACES,
  FASTENER_KINDS,
  faceFrame,
  fastenersOf,
  kindInfo,
  type Face,
  type Fastener,
  type FastenerKind,
} from '../fastener';
import { getStock, stockById } from '../stock';
import type { Store } from '../store';
import { fmt, parseLen } from '../units';
import { esc, onChange, onClick } from './dom';
import { keepFocus } from './fields';
import { icon } from './icons';

type SectionId = 'part' | 'transform' | 'arrange' | 'assembly' | 'fasteners' | 'array';

/** The Assembly section: one step number for the selection, blank when unset or mixed. */
function assemblyHtml(list: readonly Part[]): string {
  const steps = new Set(list.map((p) => p.step));
  const value = steps.size === 1 ? ([...steps][0] ?? '') : '';
  const hint = steps.size > 1 ? 'mixed' : 'none';
  return `<div class="row"><div><label class="small">Step</label><input type="number" min="1" step="1" id="pStep" value="${value}" placeholder="${hint}"></div></div>
    <div class="muted">The order the parts go together. Shift+E walks the steps; unnumbered parts come last.</div>`;
}

const FACES: [string, string][] = [
  ['top', 'Top face'],
  ['bottom', 'Bottom face'],
];
const EDGES_ALL: [string, string][] = [
  ['endA', 'End A'],
  ['endB', 'End B'],
  ['front', 'Front edge'],
  ['back', 'Back edge'],
];
const EDGES_SIDE: [string, string][] = [
  ['front', 'Front edge'],
  ['back', 'Back edge'],
];
const select = (id: string, opts: [string, string][], value: string) =>
  `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
const lenField = (id: string, value: number, title: string) =>
  `<input type="text" class="len" data-min="0" id="${id}" value="${fmt(value)}" title="${title}">`;

/** One row per cut: kind, where, and its numbers; plus an Add row. */
function cutsEditorHtml(p: { cuts?: Cut[] }): string {
  const cuts = cutsOf(p as never);
  let html = `<label class="small">Cuts</label>`;
  cuts.forEach((c, i) => {
    const id = (f: string) => `cut-${i}-${f}`;
    let where: string;
    let fields: string;
    if (c.kind === 'dado' || c.kind === 'groove') {
      where = select(id('face'), FACES, c.face);
      fields = `${lenField(id('at'), c.at, c.kind === 'dado' ? 'From end A' : 'From the front edge')}${lenField(id('width'), c.width, 'Width')}${lenField(id('depth'), c.depth, 'Depth')}`;
    } else if (c.kind === 'rabbet') {
      where = `${select(id('edge'), EDGES_ALL, c.edge)}${select(id('face'), FACES, c.face)}`;
      fields = `${lenField(id('width'), c.width, 'Width, in from the edge')}${lenField(id('depth'), c.depth, 'Depth')}`;
    } else {
      where = select(id('edge'), EDGES_SIDE, c.edge);
      fields = `${lenField(id('at'), c.at, 'From end A')}${lenField(id('width'), c.width, 'Width along the length')}${lenField(id('depth'), c.depth, 'Depth into the width')}`;
    }
    html += `<div class="cut-row">${select(
      id('kind'),
      CUT_KINDS.map((k) => [k, k[0]!.toUpperCase() + k.slice(1)]),
      c.kind,
    )}${where}${fields}<button class="icon ghost danger" data-delcut="${i}" title="Remove this cut">×</button></div>`;
  });
  html += `<div class="row btns"><button id="bAddCut" title="Add a dado; change its kind in the row">Add cut</button></div>
  <div class="muted note">Dado: across the width, position from end A. Groove: along the length, position from the front edge. Rabbet: along an end or edge. Notch: through the thickness into an edge.</div>`;
  return html;
}

function wireCutsEditor(
  el: HTMLElement,
  p: { cuts?: Cut[] } & Parameters<typeof partDims>[0],
  store: Store,
): void {
  const dims = partDims(p);
  const update = (i: number, change: (c: Cut) => Cut) =>
    store.mutate(() => {
      const cuts = cutsOf(p);
      const next = cuts.map((c, k) => (k === i ? clampCut(change(c), dims) : c));
      p.cuts = next.length ? next : undefined;
    });
  cutsOf(p).forEach((c, i) => {
    const id = (f: string) => `cut-${i}-${f}`;
    onChange(el, id('kind'), (inp) => update(i, () => defaultCut(inp.value as Cut['kind'])));
    onChange(el, id('face'), (inp) =>
      update(i, (cut) => ({ ...cut, face: inp.value as 'top' | 'bottom' }) as Cut),
    );
    onChange(el, id('edge'), (inp) => update(i, (cut) => ({ ...cut, edge: inp.value }) as Cut));
    for (const f of ['at', 'width', 'depth'] as const)
      onChange(el, id(f), (inp) => {
        const v = parseLen(inp.value);
        if (v === null) return;
        update(i, (cut) => ({ ...cut, [f]: v }));
      });
  });
  el.querySelectorAll<HTMLButtonElement>('[data-delcut]').forEach((b) =>
    b.addEventListener('click', () =>
      store.mutate(() => {
        const next = cutsOf(p).filter((_, k) => k !== +b.dataset.delcut!);
        p.cuts = next.length ? next : undefined;
      }),
    ),
  );
  onClick(el, 'bAddCut', () =>
    store.mutate(() => {
      p.cuts = [...cutsOf(p), clampCut(defaultCut('dado'), dims)];
    }),
  );
}
/** One row per marker: kind, face, where on the face, size; plus Place and Add. */
function fastenersHtml(p: Part): string {
  const from = (a: AxisIndex) =>
    a === 0 ? 'From end A' : a === 1 ? 'From the front edge' : 'From the bottom';
  let html = '';
  fastenersOf(p).forEach((f, i) => {
    const id = (x: string) => `fast-${i}-${x}`;
    const { u, v } = faceFrame(f.face);
    html += `<div class="fast-row">${select(
      id('kind'),
      FASTENER_KINDS.map((k) => [k.id, k.label]),
      f.kind,
    )}${select(
      id('face'),
      FASTENER_FACES.map((x) => [x.id, x.label]),
      f.face,
    )}${lenField(id('u'), f.at[0], from(u))}${lenField(id('v'), f.at[1], from(v))}<input type="text" id="${id('size')}" value="${esc(f.size ?? '')}" placeholder="${esc(kindInfo(f.kind).size)}" title="Size to buy; blank means the usual size"><button class="icon ghost danger" data-delfast="${i}" title="Remove this marker">×</button></div>`;
  });
  html += `<div class="row btns"><button id="bPlaceFast" title="F: click faces in the view to place markers, click a marker to remove it">Place (F)</button><button id="bAddFast" title="Add a marker in the middle of the top face">Add</button></div>
  <div class="muted note">Markers count as hardware in the buy list; they do not change the part.</div>`;
  return html;
}

function wireFastenersEditor(el: HTMLElement, p: Part, store: Store, place: () => void): void {
  const update = (i: number, change: (f: Fastener) => Fastener) =>
    store.setFasteners(
      p.id,
      fastenersOf(p).map((f, k) => (k === i ? change(f) : f)),
    );
  fastenersOf(p).forEach((_, i) => {
    const id = (x: string) => `fast-${i}-${x}`;
    onChange(el, id('kind'), (inp) =>
      update(i, (f) => ({ ...f, kind: inp.value as FastenerKind })),
    );
    onChange(el, id('face'), (inp) => update(i, (f) => ({ ...f, face: inp.value as Face })));
    onChange(el, id('u'), (inp) => {
      const v = parseLen(inp.value);
      if (v !== null) update(i, (f) => ({ ...f, at: [v, f.at[1]] }));
    });
    onChange(el, id('v'), (inp) => {
      const v = parseLen(inp.value);
      if (v !== null) update(i, (f) => ({ ...f, at: [f.at[0], v] }));
    });
    onChange(el, id('size'), (inp) =>
      update(i, (f) => {
        const n = { ...f };
        if (inp.value.trim()) n.size = inp.value.trim();
        else delete n.size;
        return n;
      }),
    );
  });
  el.querySelectorAll<HTMLButtonElement>('[data-delfast]').forEach((b) =>
    b.addEventListener('click', () => store.removeFastener(p.id, +b.dataset.delfast!)),
  );
  onClick(el, 'bAddFast', () => {
    const d = partDims(p);
    const { kind, size } = store.settings.fastener;
    const f: Fastener = { kind, face: 'top', at: [d[0] / 2, d[1] / 2] };
    if (size.trim()) f.size = size.trim();
    store.addFastener(p.id, f);
  });
  onClick(el, 'bPlaceFast', place);
}

const SECTIONS_KEY = 'lumber.sections';

export class PropsPanel {
  private closed = new Set<SectionId>();

  constructor(
    private el: HTMLElement,
    private store: Store,
    /** Start placing fastener markers in the view. */
    private place: () => void = () => {},
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '[]') as SectionId[];
      this.closed = new Set(saved);
    } catch {
      /* fresh */
    }
    store.subscribe(() => this.render());
    this.render();
  }

  /** Expand a section (the toolbar's Array button uses it). */
  openSection(id: SectionId): void {
    if (!this.closed.has(id)) return;
    this.closed.delete(id);
    this.saveSections();
    this.render();
  }
  private saveSections(): void {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify([...this.closed]));
    } catch {
      /* best effort */
    }
  }

  private section(id: SectionId, title: string, body: string, count = ''): string {
    const closed = this.closed.has(id);
    return `<section class="sec${closed ? ' closed' : ''}" data-sec="${id}"><h3 data-toggle="${id}"><span class="chev"></span>${title}${count ? `<span class="count">${count}</span>` : ''}</h3><div class="sec-body">${body}</div></section>`;
  }

  render(): void {
    const { store, el } = this;
    const list = store.selectedParts();
    const hidden = store.parts.filter((p) => p.hidden).length;
    const hiddenNote = hidden
      ? `<div class="muted note">${hidden} hidden part${hidden === 1 ? '' : 's'} · Alt+H shows them</div>`
      : '';
    if (!list.length) {
      el.innerHTML = `<div class="empty">Nothing selected. Click a part, drag stock in from the palette, or press Shift+A.${hiddenNote}</div>`;
      return;
    }
    const u = unionAABB(list);
    const size = aabbSize(u);
    const group = store.selectedGroup();
    const inGroup = list.some((p) => p.group !== undefined);

    // ---- Part ----
    let part: string;
    let partTitle = 'Part';
    let partCount = '';
    if (list.length === 1) {
      const p = list[0]!;
      const s = stockById(p.stock);
      const options = getStock()
        .map(
          (x) =>
            `<option value="${x.id}" ${x.id === p.stock ? 'selected' : ''}>${esc(x.name)}</option>`,
        )
        .join('');
      part = `<div class="row"><div><label class="small">Name</label><input type="text" id="pName" value="${esc(p.name)}"></div>
        <div><label class="small">Stock</label><select id="pStock">${options}</select></div></div>
        <div class="row"><div><label class="small">Length (S)</label><input type="text" class="len" data-min="0.0625" id="pLen" value="${fmt(p.len)}"></div>
        ${
          s.sheet
            ? `<div><label class="small">Width</label><input type="text" class="len" data-min="0.0625" id="pW" value="${fmt(p.w ?? s.sheet[0])}"></div>`
            : `<div><label class="small">Section</label><div class="static">${fmt(s.t)} × ${fmt(s.w ?? 0)}</div></div>`
        }</div>`;
      if (s.sheet && s.grain !== false) {
        const labels: Record<string, string> = {
          any: 'Either way',
          length: 'Along the length',
          width: 'Across the length',
        };
        part += `<div class="row"><div><label class="small">Grain</label><select id="pGrain">${GRAINS.map((g) => `<option value="${g}"${g === grainOf(p) ? ' selected' : ''}>${labels[g]}</option>`).join('')}</select></div></div>
        <div class="muted note">Plywood grain runs the long way of the sheet. The nesting only turns the part the way you allow.</div>`;
      }
      if (!s.sheet) {
        const [ma, mb] = miterOf(p);
        part += `<div class="row"><div><label class="small">Miter A (−X end)</label><input type="number" id="pMiterA" value="${ma}" min="-75" max="75" step="0.5"></div><div><label class="small">Miter B (+X end)</label><input type="number" id="pMiterB" value="${mb}" min="-75" max="75" step="0.5"></div></div>
        <div class="muted note">Degrees from square, across the width. Positive puts the short point on the back (+Y) edge. Length is long point to long point.</div>`;
      }
      if (!s.sheet) part += cutsEditorHtml(p);
      if (inGroup) {
        const g = store.groupById(p.group!);
        part += `<div class="muted note">In ${esc(g?.name ?? 'a group')} · click the part in the view to select the whole group</div>`;
      }
    } else {
      partTitle = group ? esc(group.name) : 'Selection';
      partCount = `${list.length} parts`;
      part = `<div class="muted">${group ? 'An assembly: it moves, rotates and copies as one.' : 'Several parts. Group them with Ctrl+G to keep them together.'}</div>`;
    }

    // ---- Transform ----
    const transform = `<div class="row"><div><label class="small">X (left)</label><input type="text" class="len" id="pX" value="${fmt(u.min[0])}"></div><div><label class="small">Y (front)</label><input type="text" class="len" id="pY" value="${fmt(u.min[1])}"></div><div><label class="small">Z (bottom)</label><input type="text" class="len" id="pZ" value="${fmt(u.min[2])}"></div></div>
      <div class="muted footprint">Footprint ${fmt(size[0])} × ${fmt(size[1])}, height ${fmt(size[2])}</div>
      <label class="small">Rotate 90° (R, then axis)</label>
      <div class="row btns"><button id="bRotX" title="R X">About X</button><button id="bRotY" title="R Y">About Y</button><button id="bRotZ" title="R Z">About Z</button></div>
      <label class="small">Mirror (Ctrl+M, then axis)</label>
      <div class="row btns"><button id="bMirX" title="Ctrl+M X: flip left-right">Left-right</button><button id="bMirY" title="Ctrl+M Y: flip front-back">Front-back</button><button id="bMirZ" title="Ctrl+M Z: flip top-bottom">Top-bottom</button></div>`;

    // ---- Arrange ----
    const groupBtns =
      (list.length > 1 && !group ? `<button id="bGroup" title="Ctrl+G">Group</button>` : '') +
      (inGroup ? `<button id="bUngroup" title="Ctrl+Shift+G">Ungroup</button>` : '');
    let arrange = `<div class="row btns"><button id="bDrop" title="Alt+G: rest on the floor or the parts below">Drop</button><button id="bDup" title="Shift+D, or Ctrl+D for an offset copy">Duplicate</button>${groupBtns}<button id="bHide" title="H">Hide</button><button id="bDel" class="danger" title="X or Delete">Delete</button></div>`;
    if (list.length > 1) {
      const btn = (axis: number, mode: string, label: string, title: string) =>
        `<button data-align="${axis}:${mode}" title="${title}">${label}</button>`;
      arrange += `<label class="small">Align</label>
      <div class="row btns align">${btn(0, 'min', 'Left', 'Flush on the left (min X)')}${btn(0, 'center', 'Center X', 'Centre on X')}${btn(0, 'max', 'Right', 'Flush on the right (max X)')}</div>
      <div class="row btns align">${btn(1, 'min', 'Front', 'Flush at the front (min Y)')}${btn(1, 'center', 'Center Y', 'Centre on Y')}${btn(1, 'max', 'Back', 'Flush at the back (max Y)')}</div>
      <div class="row btns align">${btn(2, 'min', 'Bottom', 'Flush on the bottom (min Z)')}${btn(2, 'center', 'Center Z', 'Centre on Z')}${btn(2, 'max', 'Top', 'Flush on top (max Z)')}</div>`;
    }

    // ---- Fasteners ----
    const nFast = list.reduce((n, p) => n + fastenersOf(p).length, 0);
    const fastCount = nFast ? `${nFast}` : '';
    const fasteners =
      list.length === 1
        ? fastenersHtml(list[0]!)
        : `<div class="muted">${nFast ? `${nFast} marker${nFast === 1 ? '' : 's'} on these parts.` : 'No markers on these parts yet.'}</div>
      <div class="row btns"><button id="bPlaceFast" title="F: click faces in the view to place markers">Place (F)</button></div>`;

    // ---- Array ----
    const arr = group?.array;
    const sel = (id: string, opts: [string, string][], value: string, title?: string) =>
      `<select id="${id}" class="inline"${title ? ` title="${title}"` : ''}>${opts
        .map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`)
        .join('')}</select>`;
    const axisSel = (value: string) =>
      sel(
        'arrAxis',
        [
          ['x', 'X'],
          ['y', 'Y'],
          ['z', 'Z'],
        ],
        value,
      );
    const modeSel = (value: string) =>
      sel(
        'arrMode',
        [
          ['center', 'On center'],
          ['gap', 'Gap'],
        ],
        value,
        'How the spacing is measured',
      );
    let array: string;
    let arrayCount = '';
    if (arr && group) {
      const byFit = arr.fit !== undefined;
      arrayCount = 'live';
      array = `<div class="row"><div><label class="small">Along</label>${axisSel(arr.axis)}</div>
        <div><label class="small">${sel(
          'arrHow',
          [
            ['count', 'Count'],
            ['fit', 'Fit length'],
          ],
          byFit ? 'fit' : 'count',
          'A fixed number, or as many as fit in a length',
        )}</label>${
          byFit
            ? `<input type="text" class="len" data-min="0" id="arrFit" value="${fmt(arr.fit!)}">`
            : `<input type="number" id="arrN" value="${arr.count ?? 2}" min="1" step="1">`
        }</div>
        <div><label class="small">${modeSel(arr.mode)}</label><input type="text" class="len" data-min="0" id="arrS" value="${fmt(arr.spacing)}"></div></div>
      <div class="row btns"><button id="bApplyArr" title="Keep the copies as ordinary parts">Apply</button><button id="bRemoveArr" class="danger" title="Drop the copies, keep the source">Remove array</button></div>`;
    } else {
      array = `<div class="row"><div><label class="small">Along</label>${axisSel('x')}</div>
        <div><label class="small">Count</label><input type="number" id="arrN" value="4" min="1" step="1"></div>
        <div><label class="small">${modeSel('center')}</label><input type="text" class="len" data-min="0" id="arrS" value="16"></div><div class="grow0"><button id="bArr" class="primary" title="Make a live array you can keep adjusting">Array</button></div></div>`;
    }

    const html =
      this.section('part', partTitle, part, partCount) +
      this.section('transform', 'Transform', transform) +
      this.section('arrange', 'Arrange', arrange) +
      this.section('assembly', 'Assembly', assemblyHtml(list)) +
      this.section('fasteners', 'Fasteners', fasteners, fastCount) +
      this.section('array', 'Array', array, arrayCount) +
      hiddenNote;

    const restoreFocus = keepFocus(el);
    el.innerHTML = html;
    el.querySelectorAll<HTMLElement>('.sec > h3').forEach((h) => {
      const id = h.dataset.toggle as SectionId;
      h.querySelector('.chev')!.appendChild(
        icon(this.closed.has(id) ? ChevronRight : ChevronDown, 13),
      );
      h.addEventListener('click', () => {
        if (this.closed.has(id)) this.closed.delete(id);
        else this.closed.add(id);
        this.saveSections();
        this.render();
      });
    });
    restoreFocus();

    const readArray = (): ArrayParams => {
      const axis = el.querySelector<HTMLSelectElement>('#arrAxis')!.value as Axis;
      const mode = el.querySelector<HTMLSelectElement>('#arrMode')!.value as ArrayParams['mode'];
      const spacing = parseLen(el.querySelector<HTMLInputElement>('#arrS')!.value) ?? 16;
      const how = el.querySelector<HTMLSelectElement>('#arrHow')?.value ?? 'count';
      const params: ArrayParams = { axis, mode, spacing };
      if (how === 'fit') {
        const fit = el.querySelector<HTMLInputElement>('#arrFit');
        params.fit = fit ? (parseLen(fit.value) ?? 48) : (arr?.fit ?? 48);
      } else {
        const n = el.querySelector<HTMLInputElement>('#arrN');
        params.count = Math.max(1, Math.floor(n ? +n.value : (arr?.count ?? 2)));
      }
      return params;
    };
    if (arr && group) {
      for (const id of ['arrAxis', 'arrHow', 'arrMode', 'arrS', 'arrN', 'arrFit'])
        onChange(el, id, () => store.setArray(readArray()));
      onClick(el, 'bApplyArr', () => store.applyArray(group.id));
      onClick(el, 'bRemoveArr', () => store.removeArray(group.id));
    } else onClick(el, 'bArr', () => store.setArray(readArray()));

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
      const setMiter = (end: 0 | 1, text: string) => {
        const v = clampMiter(parseFloat(text));
        store.mutate(() => {
          const m = miterOf(p);
          m[end] = v;
          if (m[0] === 0 && m[1] === 0) delete p.miter;
          else p.miter = m;
        });
      };
      onChange(el, 'pGrain', (i) =>
        store.mutate(() => {
          if (i.value === 'any') delete p.grain;
          else p.grain = i.value as (typeof GRAINS)[number];
        }),
      );
      wireCutsEditor(el, p, store);
      wireFastenersEditor(el, p, store, this.place);
      onChange(el, 'pMiterA', (i) => setMiter(0, i.value));
      onChange(el, 'pMiterB', (i) => setMiter(1, i.value));
    }
    const moveTo = (axis: 0 | 1 | 2, text: string) => {
      const v = parseLen(text);
      if (v === null) {
        this.render();
        return;
      }
      const d = v - u.min[axis];
      store.mutate(() => list.forEach((p) => (p.pos[axis] += d)));
    };
    onChange(el, 'pX', (i) => moveTo(0, i.value));
    onChange(el, 'pY', (i) => moveTo(1, i.value));
    onChange(el, 'pZ', (i) => moveTo(2, i.value));
    onChange(el, 'pStep', (i) =>
      store.setStep(
        list.map((p) => p.id),
        i.value.trim() === '' ? null : Number(i.value),
      ),
    );
    onClick(el, 'bRotX', () => store.rotateSelected('x'));
    onClick(el, 'bRotY', () => store.rotateSelected('y'));
    onClick(el, 'bRotZ', () => store.rotateSelected('z'));
    onClick(el, 'bMirX', () => store.mirrorSelected('x'));
    onClick(el, 'bMirY', () => store.mirrorSelected('y'));
    onClick(el, 'bMirZ', () => store.mirrorSelected('z'));
    onClick(el, 'bDrop', () => store.dropSelected());
    onClick(el, 'bHide', () => store.hideSelected());
    onClick(el, 'bGroup', () => store.groupSelected());
    onClick(el, 'bUngroup', () => store.ungroupSelected());
    el.querySelectorAll<HTMLButtonElement>('[data-align]').forEach((b) =>
      b.addEventListener('click', () => {
        const [axis, mode] = b.dataset.align!.split(':');
        store.alignSelected(+axis! as 0 | 1 | 2, mode as AlignMode);
      }),
    );
    if (list.length > 1) onClick(el, 'bPlaceFast', this.place);
    onClick(el, 'bDup', () => store.duplicateSelected());
    onClick(el, 'bDel', () => store.deleteSelected());
  }
}
