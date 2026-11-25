/**
 * D: a dimension label on every part and three dimension lines around the selection's
 * box, showing its width, depth and height.
 */
import * as THREE from 'three';
import { aabbCenter, aabbSize, partAABB, unionAABB, type Vec3 } from '../model';
import { stockById } from '../stock';
import type { Store } from '../store';
import { fmt } from '../units';
import type { ViewContext } from './camera';
import { hideLabels, placeLabel, poolLabel } from './labels';

export class DimLabels {
  on = false;
  private labels: HTMLElement[] = [];
  private extentLabels: HTMLElement[] = [];
  private readonly lines: THREE.LineSegments;

  constructor(
    private readonly view: ViewContext,
    scene: THREE.Scene,
  ) {
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true }),
    );
    this.lines.renderOrder = 990;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  toggle(): void {
    this.on = !this.on;
    if (!this.on) {
      hideLabels(this.labels);
      hideLabels(this.extentLabels);
      this.lines.visible = false;
    }
  }

  /** Once a frame while on. */
  update(store: Store): void {
    if (!this.on) return;
    const { container } = this.view;
    const selectedOne = store.selected.size === 1 ? [...store.selected][0] : null;
    let i = 0;
    for (const p of store.visibleParts()) {
      if (p.id === selectedOne) continue; // the part label already names it
      const b = partAABB(p);
      const s = stockById(p.stock);
      const text = s.sheet ? `${fmt(p.w ?? s.sheet[0])} × ${fmt(p.len)}` : fmt(p.len);
      placeLabel(
        this.view,
        poolLabel(container, this.labels, i++, 'dim-label'),
        new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]),
        text,
      );
    }
    hideLabels(this.labels, i);

    // Extents of the selection: three dimension lines just outside its box.
    const list = store.selectedParts();
    if (!list.length) {
      this.lines.visible = false;
      hideLabels(this.extentLabels);
      return;
    }
    const u = unionAABB(list);
    const size = aabbSize(u);
    const c = new THREE.Vector3().fromArray(aabbCenter(u));
    const off = this.view.viewHeightAt(c) * 0.03;
    const t = off * 0.4; // tick length
    const [x0, y0, z0] = u.min;
    const [x1, y1, z1] = u.max;
    const pts: number[] = [];
    const seg = (a: Vec3, b: Vec3) => pts.push(...a, ...b);
    // width along X, in front of the box at floor level
    seg([x0, y0 - off, z0], [x1, y0 - off, z0]);
    seg([x0, y0 - off - t, z0], [x0, y0 - off + t, z0]);
    seg([x1, y0 - off - t, z0], [x1, y0 - off + t, z0]);
    // depth along Y, to the right of the box
    seg([x1 + off, y0, z0], [x1 + off, y1, z0]);
    seg([x1 + off - t, y0, z0], [x1 + off + t, y0, z0]);
    seg([x1 + off - t, y1, z0], [x1 + off + t, y1, z0]);
    // height along Z, at the back-right corner
    seg([x1 + off, y1 + off, z0], [x1 + off, y1 + off, z1]);
    seg([x1 + off - t, y1 + off, z0], [x1 + off + t, y1 + off, z0]);
    seg([x1 + off - t, y1 + off, z1], [x1 + off + t, y1 + off, z1]);
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(pts, 3),
    );
    this.lines.visible = true;
    const mids: [THREE.Vector3, string][] = [
      [new THREE.Vector3((x0 + x1) / 2, y0 - off, z0), `W ${fmt(size[0])}`],
      [new THREE.Vector3(x1 + off, (y0 + y1) / 2, z0), `D ${fmt(size[1])}`],
      [new THREE.Vector3(x1 + off, y1 + off, (z0 + z1) / 2), `H ${fmt(size[2])}`],
    ];
    mids.forEach(([v, text], k) =>
      placeLabel(
        this.view,
        poolLabel(container, this.extentLabels, k, 'dim-label extent'),
        v,
        text,
      ),
    );
  }
}
