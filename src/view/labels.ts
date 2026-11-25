/** HTML labels pinned to world points over the 3D view. */
import type * as THREE from 'three';
import type { ViewContext } from './camera';

/** Screen position of a world point, in pixels from the view's top-left corner. */
export function toScreen(view: ViewContext, v: THREE.Vector3): [number, number] {
  const p = v.clone().project(view.camera);
  return [
    ((p.x + 1) / 2) * view.container.clientWidth,
    ((1 - p.y) / 2) * view.container.clientHeight,
  ];
}

/** Put a label at a world point, or hide it when the point is behind the camera. */
export function placeLabel(
  view: ViewContext,
  el: HTMLElement,
  world: THREE.Vector3,
  text: string,
): void {
  const p = world.clone().project(view.camera);
  if (p.z > 1) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.left = `${((p.x + 1) / 2) * view.container.clientWidth}px`;
  el.style.top = `${((1 - p.y) / 2) * view.container.clientHeight}px`;
  if (el.textContent !== text) el.textContent = text;
}

/** The i-th label of a pool, made and added to the container on first use. */
export function poolLabel(
  container: HTMLElement,
  pool: HTMLElement[],
  i: number,
  cls: string,
): HTMLElement {
  let el = pool[i];
  if (!el) {
    el = document.createElement('div');
    el.className = cls;
    container.appendChild(el);
    pool[i] = el;
  }
  return el;
}

/** Hide every label in a pool from index `from` on. */
export function hideLabels(pool: HTMLElement[], from = 0): void {
  for (let k = from; k < pool.length; k++) pool[k]!.style.display = 'none';
}
