/** The bar across the top of the view while walking the assembly steps. */
import { ChevronLeft, ChevronRight } from 'lucide';
import type { LumberScene } from '../scene';
import type { Store } from '../store';
import { iconButton } from './icons';

export function wireAssemblyBar(viewport: HTMLElement, store: Store, scene: LumberScene): void {
  const bar = document.createElement('div');
  bar.className = 'explode-bar assembly-bar';
  bar.hidden = true;
  const title = document.createElement('strong');
  title.textContent = 'Assembly';
  const prev = iconButton(ChevronLeft, 'Previous step ([)', () => scene.stepAssembly(-1));
  const slider = document.createElement('input');
  slider.id = 'asmStep';
  slider.type = 'range';
  slider.min = '1';
  slider.max = '1';
  slider.value = '1';
  slider.title = 'Which step';
  const next = iconButton(ChevronRight, 'Next step (])', () => scene.stepAssembly(1));
  const text = document.createElement('span');
  text.id = 'asmTitle';
  text.className = 'muted';
  const done = document.createElement('button');
  done.id = 'asmDone';
  done.type = 'button';
  done.title = 'Shift+E';
  done.textContent = 'Done';
  bar.append(title, prev, slider, next, text, done);
  viewport.appendChild(bar);

  slider.addEventListener('input', () => scene.setAssemblyStep(+slider.value));
  slider.addEventListener('keydown', (e) => e.stopPropagation());
  done.addEventListener('click', () => scene.endAssembly());

  const refresh = (): void => {
    const k = scene.assemblyStep;
    bar.hidden = k === null;
    if (k === null) return;
    const n = scene.assemblyCount();
    slider.max = String(Math.max(1, n));
    slider.value = String(k);
    prev.disabled = k <= 1;
    next.disabled = k >= n;
    text.textContent = scene.assemblyTitle();
  };
  scene.watchAssembly(refresh);
  store.subscribe((kind) => {
    if (kind === 'model' && scene.assemblyStep !== null) refresh();
  });
}
