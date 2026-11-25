/**
 * M: measure between two clicked points. The scene finds the snapped point under the
 * pointer; this draws the line, the live dot and the readout.
 */
import * as THREE from 'three';
import { measureBetween, measureText } from '../measure';
import type { Vec3 } from '../model';
import { fmt } from '../units';
import type { ViewContext } from './camera';
import { placeLabel } from './labels';

export class MeasureTool {
  private state: { a: Vec3 | null; b: Vec3 | null; live: Vec3 | null } | null = null;
  private readonly line: THREE.Line;
  private readonly dot: THREE.Mesh;
  private readonly label: HTMLElement;
  onChange: ((on: boolean) => void) | null = null;

  constructor(
    private readonly view: ViewContext,
    scene: THREE.Scene,
  ) {
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x5fb3ff, depthTest: false, transparent: true }),
    );
    this.line.renderOrder = 991;
    this.line.visible = false;
    this.dot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x5fb3ff, depthTest: false, transparent: true }),
    );
    this.dot.renderOrder = 992;
    this.dot.visible = false;
    scene.add(this.line, this.dot);
    this.label = document.createElement('div');
    this.label.className = 'measure-label';
    view.container.appendChild(this.label);
  }

  get active(): boolean {
    return this.state !== null;
  }

  start(): void {
    this.state = { a: null, b: null, live: null };
    this.view.container.style.cursor = 'crosshair';
    this.onChange?.(true);
  }
  end(): void {
    this.state = null;
    this.line.visible = false;
    this.dot.visible = false;
    this.label.style.display = 'none';
    this.view.container.style.cursor = '';
    this.onChange?.(false);
  }

  /** A click: the first point, the second, or a fresh first after a finished pair. */
  click(pt: Vec3): void {
    const m = this.state;
    if (!m) return;
    if (!m.a || m.b) this.state = { a: pt, b: null, live: pt };
    else m.b = pt;
  }
  /** The pointer moved: where the next click would land. */
  hover(pt: Vec3 | null): void {
    if (this.state) this.state.live = pt;
  }

  /** Once a frame. */
  update(): void {
    const m = this.state;
    if (!m) return;
    const end = m.b ?? m.live;
    const dot = m.b ? null : m.live;
    if (dot) {
      this.dot.visible = true;
      this.dot.position.fromArray(dot);
      const s = this.view.viewHeightAt(this.dot.position) * 0.006;
      this.dot.scale.set(s, s, s);
    } else this.dot.visible = false;
    if (!m.a || !end) {
      this.line.visible = false;
      this.label.style.display = 'none';
      return;
    }
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, m.a[0], m.a[1], m.a[2]);
    pos.setXYZ(1, end[0], end[1], end[2]);
    pos.needsUpdate = true;
    this.line.visible = true;
    const mid = new THREE.Vector3(
      (m.a[0] + end[0]) / 2,
      (m.a[1] + end[1]) / 2,
      (m.a[2] + end[2]) / 2,
    );
    placeLabel(this.view, this.label, mid, measureText(measureBetween(m.a, end), fmt));
  }
}
