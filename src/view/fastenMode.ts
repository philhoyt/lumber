/**
 * F: placing fastener markers. Click a face to add a marker there, click a marker to
 * take it away; a ghost shows where the next one would go.
 */
import * as THREE from 'three';
import { fastenerAt, fastenerLocal, type Fastener } from '../fastener';
import { markerMesh, placeMarker } from '../markers';
import { partDims } from '../model';
import type { Store } from '../store';

/** What the mode needs from the scene to find the part and marker under the pointer. */
export interface FastenPicker {
  /** Cast a ray at a screen position and return the first part hit, leaving `ray` set. */
  pick(clientX: number, clientY: number): THREE.Intersection | null;
  readonly ray: THREE.Raycaster;
  meshOf(id: number): THREE.Group | undefined;
}

export type FastenTarget =
  | { partId: number; remove: number }
  | { partId: number; add: Fastener; world: THREE.Vector3; normal: THREE.Vector3 };

export class FastenMode {
  private state: { ghost: THREE.Group | null; ghostKind: string } | null = null;
  private watchers: ((on: boolean) => void)[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly container: HTMLElement,
    private readonly store: Store,
    private readonly picker: FastenPicker,
  ) {}

  get active(): boolean {
    return this.state !== null;
  }
  start(): void {
    this.state = { ghost: null, ghostKind: '' };
    this.container.style.cursor = 'crosshair';
    for (const w of this.watchers) w(true);
  }
  end(): void {
    if (!this.state) return;
    if (this.state.ghost) this.scene.remove(this.state.ghost);
    this.state = null;
    this.container.style.cursor = '';
    for (const w of this.watchers) w(false);
  }
  /** Be told when placing starts and stops (toolbar, the bar over the view). */
  watch(fn: (on: boolean) => void): void {
    this.watchers.push(fn);
  }

  /** What a click would do: take a marker away, or add one on a face. */
  target(clientX: number, clientY: number): FastenTarget | null {
    const hit = this.picker.pick(clientX, clientY);
    if (!hit) return null;
    const partId = hit.object.userData.id as number;
    const p = this.store.partById(partId);
    const g = this.picker.meshOf(partId);
    if (!p || !g) return null;
    const markers = g.children[2];
    if (markers) {
      const heads = markers.children.map((m) => m.children[0]!);
      const mh = this.picker.ray.intersectObjects(heads, false)[0];
      if (mh && mh.distance <= hit.distance + 0.05)
        return { partId, remove: mh.object.userData.fastener as number };
    }
    const local = g.worldToLocal(hit.point.clone());
    const n = hit.face?.normal ?? new THREE.Vector3(0, 0, 1);
    const { kind, size } = this.store.settings.fastener;
    const dims = partDims(p);
    const add = fastenerAt(
      kind,
      local.toArray(),
      n.toArray(),
      dims,
      this.store.settings.grid,
      size,
    );
    const { point, normal } = fastenerLocal(add, dims);
    const world = g.localToWorld(new THREE.Vector3().fromArray(point));
    const wn = new THREE.Vector3().fromArray(normal).applyQuaternion(g.quaternion);
    return { partId, add, world, normal: wn };
  }

  /** A click while placing: apply the target to the store. */
  click(clientX: number, clientY: number): void {
    const t = this.target(clientX, clientY);
    if (!t) return;
    if ('remove' in t) this.store.removeFastener(t.partId, t.remove);
    else this.store.addFastener(t.partId, t.add);
    this.updateGhost(clientX, clientY);
  }

  updateGhost(clientX: number, clientY: number): void {
    const f = this.state;
    if (!f) return;
    const t = this.target(clientX, clientY);
    if (!t || 'remove' in t) {
      if (f.ghost) f.ghost.visible = false;
      this.container.style.cursor = t ? 'pointer' : 'crosshair';
      return;
    }
    this.container.style.cursor = 'crosshair';
    if (!f.ghost || f.ghostKind !== t.add.kind) {
      if (f.ghost) this.scene.remove(f.ghost);
      f.ghost = markerMesh(t.add.kind, [0, 0, 0], [0, 0, 1], true);
      f.ghostKind = t.add.kind;
      this.scene.add(f.ghost);
    }
    f.ghost.visible = true;
    placeMarker(f.ghost, t.world.toArray(), t.normal.toArray());
  }

  /** Keep the ghost the same on-screen size as the markers. */
  scaleGhost(minScale: (at: THREE.Vector3) => number): void {
    const ghost = this.state?.ghost;
    if (ghost?.visible) ghost.scale.setScalar(minScale(ghost.position));
  }
}
