/** The bar across the top of the view while it is exploded: how far apart, and a way back. */
import type { LumberScene } from '../scene';

export function wireExplodeBar(viewport: HTMLElement, scene: LumberScene): void {
  const bar = document.createElement('div');
  bar.className = 'explode-bar';
  bar.hidden = true;
  bar.innerHTML = `<strong>Exploded view</strong>
    <input id="explodeAmt" type="range" min="1" max="100" value="50" title="How far apart">
    <span class="muted">Looking only: click selects, editing collapses the view</span>
    <button id="explodeDone" type="button" title="E">Collapse</button>`;
  viewport.appendChild(bar);
  const slider = bar.querySelector<HTMLInputElement>('#explodeAmt')!;
  slider.addEventListener('input', () => scene.setExplode(+slider.value / 100));
  slider.addEventListener('keydown', (e) => e.stopPropagation());
  bar.querySelector('#explodeDone')!.addEventListener('click', () => scene.setExplode(0));
  scene.watchExplode((v) => {
    bar.hidden = v === 0;
    if (v > 0) slider.value = String(Math.round(v * 100));
  });
}
