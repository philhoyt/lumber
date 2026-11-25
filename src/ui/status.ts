/** The footer: part count and the model's overall size. */
import { aabbSize, unionAABB } from '../model';
import type { Store } from '../store';
import { fmt } from '../units';

export function wireStatus(countEl: HTMLElement, overallEl: HTMLElement, store: Store): void {
  const render = () => {
    const n = store.parts.length;
    const sel = store.selected.size;
    countEl.textContent = `${n} part${n === 1 ? '' : 's'}${sel ? ` · ${sel} selected` : ''}`;
    if (!n) {
      overallEl.textContent = '—';
      return;
    }
    const s = aabbSize(unionAABB(store.parts));
    overallEl.textContent = `${fmt(s[0])} W × ${fmt(s[1])} D × ${fmt(s[2])} H`;
  };
  store.subscribe(render);
  render();
}
