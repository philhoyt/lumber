/**
 * The shop drawings overlay: three views of the model, then a sheet per unique part,
 * all drawn from the model as SVG. Print sends just these pages to the printer.
 */
import { Printer, X } from 'lucide';
import { drawingRows, modelViewsSvg, partSheetSvg } from '../drawing';
import { hardwareRows, kindInfo } from '../fastener';
import type { Store } from '../store';
import { fmt } from '../units';
import { esc } from './dom';
import { icon } from './icons';

export class DrawingsOverlay {
  private el: HTMLElement;
  private body: HTMLElement;

  constructor(
    host: HTMLElement,
    private store: Store,
    private projectName: () => string,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'overlay drawings-overlay';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="drawings"><div class="dlg-head"><h2>Shop drawings</h2><span class="muted">Three views of the model, then a sheet per unique part. Drawn from the model, not the picture.</span><span class="spacer"></span><button id="drPrint" class="primary"></button><button class="icon ghost" id="drClose" title="Close (Esc)"></button></div><div class="dlg-body drawings-body"></div></div>`;
    host.appendChild(this.el);
    this.body = this.el.querySelector('.drawings-body')!;
    const print = this.el.querySelector<HTMLButtonElement>('#drPrint')!;
    print.append(icon(Printer, 14), 'Print');
    print.onclick = () => window.print();
    const close = this.el.querySelector<HTMLButtonElement>('#drClose')!;
    close.appendChild(icon(X));
    close.onclick = () => this.hide();
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide();
    });
    store.subscribe((kind) => {
      if (kind === 'model' && this.open) this.render();
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }
  show(): void {
    this.render();
    this.el.hidden = false;
    document.body.classList.add('drawings-open');
  }
  hide(): void {
    this.el.hidden = true;
    document.body.classList.remove('drawings-open');
  }
  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  private render(): void {
    const parts = this.store.parts;
    if (!parts.length) {
      this.body.innerHTML = '<div class="muted">Add parts and the drawings draw themselves.</div>';
      return;
    }
    const date = new Date().toLocaleDateString();
    const views = modelViewsSvg(parts);
    const rows = drawingRows(parts.filter((p) => !p.hidden));
    const hardware = hardwareRows(parts);
    let html = `<div class="sheet title-block"><h1>${esc(this.projectName())}</h1><div class="muted">${date} · ${parts.length} part${parts.length === 1 ? '' : 's'}, ${rows.length} unique · overall ${fmt(views.size[0])} W × ${fmt(views.size[1])} D × ${fmt(views.size[2])} H</div></div>`;
    html += `<div class="sheet"><h2>Views</h2>${views.svg}</div>`;
    rows.forEach((r, i) => {
      const { svg, notes } = partSheetSvg(r);
      const size = r.stock.sheet
        ? `${fmt(r.t)} × ${fmt(r.w)} × ${fmt(r.len)}`
        : `${esc(r.stock.name)} · ${fmt(r.len)} long`;
      html += `<div class="sheet"><h2>${i + 1}. ${esc(r.names.join(', '))}</h2><div class="muted">${size} · make ${r.qty}${r.stock.sheet ? ` from ${esc(r.stock.name)}` : ''}</div>${svg}${
        notes.length
          ? `<ul class="notes">${notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
          : ''
      }</div>`;
    });
    if (hardware.length)
      html += `<div class="sheet"><h2>Hardware</h2><ul class="notes">${hardware
        .map(
          (h) =>
            `<li>${h.qty} × ${esc(h.size)} <span class="muted">${esc(kindInfo(h.kind).label.toLowerCase())} · ${esc(h.names.join(', '))}</span></li>`,
        )
        .join('')}</ul></div>`;
    this.body.innerHTML = html;
  }
}
