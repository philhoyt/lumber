/**
 * Alt + hover: a line from the selection to the part under the pointer with the gap
 * between them, their spacing on centre, and the straight-line distance when it differs.
 */
import * as THREE from 'three';
import { boxGap, gapText } from '../gap';
import type { AABB } from '../model';
import { fmt } from '../units';
import type { ViewContext } from './camera';
import { placeLabel } from './labels';

export class GapReadout {
  private readonly line: THREE.Line;
  private readonly label: HTMLElement;
  private text = '';
  private mid = new THREE.Vector3();
  private shown = false;

  constructor(
    private readonly view: ViewContext,
    scene: THREE.Scene,
  ) {
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true }),
    );
    this.line.renderOrder = 991;
    this.line.visible = false;
    scene.add(this.line);
    this.label = document.createElement('div');
    this.label.className = 'dim-label extent gap-label';
    view.container.appendChild(this.label);
  }

  /** Show the distance from box `a` (the selection) to box `b` (the hovered part). */
  show(a: AABB, b: AABB): void {
    const g = boxGap(a, b);
    const from = new THREE.Vector3().fromArray(g.from);
    const to = new THREE.Vector3().fromArray(g.to);
    this.line.geometry.setFromPoints([from, to]);
    this.line.visible = g.distance > 1e-9;
    this.mid = from.clone().add(to).multiplyScalar(0.5);
    this.text = gapText(g, fmt);
    this.shown = true;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.line.visible = false;
    this.label.style.display = 'none';
  }

  /** Once a frame: keep the label on the line's middle as the camera moves. */
  update(): void {
    if (this.shown) placeLabel(this.view, this.label, this.mid, this.text);
  }
}
