/**
 * The bar across the top of the view while fastener markers are being placed: what to
 * place next and how to stop.
 */
import { FASTENER_KINDS, kindInfo, type FastenerKind } from '../fastener';
import type { LumberScene } from '../scene';
import type { Store } from '../store';
import { esc } from './dom';

export function wireFastenBar(viewport: HTMLElement, store: Store, scene: LumberScene): void {
  const bar = document.createElement('div');
  bar.className = 'fasten-bar';
  bar.hidden = true;
  const { kind, size } = store.settings.fastener;
  bar.innerHTML = `<strong>Fasteners</strong>
    <select id="fastKind" title="What to place">${FASTENER_KINDS.map(
      (k) => `<option value="${k.id}"${k.id === kind ? ' selected' : ''}>${esc(k.label)}</option>`,
    ).join('')}</select>
    <input id="fastSize" type="text" value="${esc(size)}" placeholder="${esc(kindInfo(kind).size)}" title="Size to buy; blank means the usual size">
    <span class="muted">Click a face to place · click a marker to remove · Esc to finish</span>
    <button id="fastDone" type="button">Done</button>`;
  viewport.appendChild(bar);
  const kindSel = bar.querySelector<HTMLSelectElement>('#fastKind')!;
  const sizeIn = bar.querySelector<HTMLInputElement>('#fastSize')!;
  const apply = () => {
    const k = kindSel.value as FastenerKind;
    sizeIn.placeholder = kindInfo(k).size;
    store.setSetting('fastener', { kind: k, size: sizeIn.value });
  };
  kindSel.addEventListener('change', apply);
  sizeIn.addEventListener('change', apply);
  sizeIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      apply();
      sizeIn.blur();
    }
  });
  bar.querySelector('#fastDone')!.addEventListener('click', () => scene.endFasten());
  scene.watchFasten((on) => {
    bar.hidden = !on;
  });
}
