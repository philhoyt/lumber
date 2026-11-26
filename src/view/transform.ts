/**
 * The modal transforms: a grab (G, the gizmo or a part's body), a rotate (R), a size
 * (S or an end handle) and an array drag (Shift+R). One runs at a time. It takes the
 * store's snapshot when it starts, moves the parts directly while it runs (telling the
 * scene to redraw and the panels that a drag is in flight), and on Enter or a click
 * commits that snapshot as the undo point, or on Escape restores it. A change the
 * transform did not make, such as a project load, drops it instead.
 */
import * as THREE from 'three';
import {
  arrayCount,
  arrayFromDrag,
  arrayFromTyped,
  arrayText,
  dominantAxis,
  sameArray,
} from '../arrayDrag';
import { coframedBoxes, extentAlong, localAxisDir, unionInFrame } from '../frame';
import { axisParam, Gizmo, ringAngle } from '../gizmo';
import {
  aabbCenter,
  ARRAY_SPACING,
  AXIS_NAMES,
  isSquare,
  partAABB,
  pivotLabel,
  pivotPoint,
  PIVOTS,
  rotatePartsBy,
  translateAABB,
  unionAABB,
  UP,
  withMinKept,
  type AABB,
  type ArrayParams,
  type AxisIndex,
  type Part,
  type PivotMode,
  type Quat,
  type Vec3,
} from '../model';
import { pullEnd, scaleFactor, snapEnd, snapLength } from '../scale';
import { coplanarFaces, snapWithHits, type SnapHit } from '../snap';
import type { Store } from '../store';
import { fmt, parseLen } from '../units';
import type { CameraRig } from './camera';
import { toScreen } from './labels';
import type { SnapFeedback } from './snapFeedback';

type Constraint =
  | { kind: 'plane'; axes: AxisIndex[]; plane: THREE.Plane; ref: THREE.Vector3 }
  | { kind: 'axis'; axis: AxisIndex; dir: THREE.Vector3; ref: number };

export interface Transform {
  kind: 'grab' | 'rotate' | 'size' | 'array';
  /** Started from the keyboard: follows the pointer, confirmed by click or Enter. */
  modal: boolean;
  constraint: Constraint | null;
  /** '' for the floor plane, 'x' | 'y' | 'z' for an axis, 'X' | 'Y' | 'Z' for a plane. */
  constraintKey: string;
  /** The first selected part's orientation: what "local" axes mean for this transform. */
  frame: Quat;
  /** The constraint is in that frame (an axis key tapped twice, or a tilted gizmo). */
  local: boolean;
  /** Distance moved along a local axis so far, for the readout and a typed length. */
  along: number;
  /** For a local move: the other parts sharing the frame, as boxes in it, and the
   *  selection's own box there before the move. Built on first use. */
  frameSnap: { boxes: AABB[]; names: string[]; mine: AABB } | null;
  origin: THREE.Vector3;
  ids: Set<number>;
  startPos: Vec3[];
  aabb: AABB;
  others: AABB[];
  /** Names of the parts behind `others`, for the readout. */
  otherNames: string[];
  /** What the last grab update snapped to, per axis. */
  snaps: SnapHit[];
  before: string;
  moved: boolean;
  delta: Vec3;
  /** Digits typed during the transform, applied on Enter. */
  typed: string;
  /** A ring being dragged in rotate mode. */
  ring: RingDrag | null;
  /** Degrees turned so far in rotate mode, per axis, for the readout. */
  angles: Vec3;
  /** The axis the last X / Y / Z key or ring chose, which a typed angle applies to. */
  rotAxis: AxisIndex | null;
  /** What the rotation turns about: the centre, or a bottom corner of the box as it was. */
  pivot: PivotMode;
  /** A length change by the mouse, in size mode. */
  size: SizeDrag | null;
  /** Copies being pulled out of the selection, in array mode. */
  array: ArrayDrag | null;
}

interface ArrayDrag {
  /** Spacing and mode to array with; the axis and count come from the drag. */
  base: ArrayParams;
  /** The source cell's size on each axis. */
  extent: Vec3;
  /** What the store currently shows, so it only changes when the count does. */
  applied: ArrayParams | null;
  /** Signed drag distance along `axis`, snapped. */
  distance: number;
  axis: AxisIndex;
  /** The source cell's size along each of its own axes, for a local array. */
  extentLocal: Vec3;
}

interface SizeDrag {
  startLens: number[];
  /** S: the length scales with the pointer's distance from the pivot, both in client pixels. */
  pivot: [number, number];
  start: [number, number];
  /** An end handle: which end, the world direction of the part's length, where the end was. */
  end: 0 | 1 | -1;
  dir: THREE.Vector3;
  at: THREE.Vector3;
  ref: number;
  /** For a square part, the world axis the moving face lies across and where it started. */
  faceAxis: AxisIndex | null;
  faceAt: number;
}

interface RingDrag {
  axis: AxisIndex;
  /** Angle at the start of the drag and the last unwrapped angle, radians. */
  start: number;
  last: number;
  /** Degrees applied by this drag so far. */
  applied: number;
  moved: boolean;
}

const LABELS = ['X', 'Y', 'Z'] as const;
/** An angle as a signed turn in (-180, 180], so 270° reads as -90°. */
const signedDeg = (d: number): number => {
  const m = ((d % 360) + 360) % 360;
  return m > 180 ? m - 360 : m;
};

/** What a transform needs from the scene it runs in. */
export interface TransformHost {
  readonly store: Store;
  readonly rig: CameraRig;
  readonly container: HTMLElement;
  readonly snapFx: SnapFeedback;
  /** Look-only modes (exploded, stepping through assembly) start no transform. */
  lookOnly(): boolean;
  /** The last pointer position in client pixels, for S and the size readout. */
  lastPointer(): [number, number] | null;
  /** Ctrl is held: a ring drag turns by the degree instead of 15°. */
  fine(): boolean;
  currentRay(): THREE.Ray;
  syncMesh(p: Part): void;
  syncAll(): void;
  /** Un-highlight the gizmo when a transform starts. */
  clearHover(): void;
}

export class TransformController {
  private tf: Transform | null = null;
  /** The pivot the last rotation used; the next one starts from it. */
  private pivotMode: PivotMode = 'center';
  /** True while a transform is writing to the store, so its notifies are not mistaken
   * for someone else's change. */
  applying = false;

  constructor(private readonly host: TransformHost) {}

  // ---- what the scene needs to draw and to dispatch ----
  /** The transform in progress, for the scene's drawing and pointer dispatch. */
  get active(): Readonly<Transform> | null {
    return this.tf;
  }
  /** The drag label's text, or null when there is nothing to show. */
  readout(): string | null {
    const t = this.tf;
    return t && (t.moved || t.modal) ? this.transformText(t) : null;
  }
  /** Where the rotate rings sit: the pivot of a rotate in progress. */
  rotationPivot(): THREE.Vector3 | null {
    const t = this.tf;
    return t?.kind === 'rotate' ? this.pivotOf(t) : null;
  }
  /** The pointer moved with a transform live: a ring, a size or a grab follows it. */
  pointerMove(e: PointerEvent, downPos: [number, number] | null): void {
    const t = this.tf;
    if (!t) return;
    if (t.kind === 'rotate') {
      const r = t.ring;
      if (!r) return;
      if (!r.moved && downPos)
        r.moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 4;
      if (r.moved) this.updateRingDrag();
      return;
    }
    if (t.kind === 'size') {
      this.updateSize();
      return;
    }
    if (!t.moved && downPos)
      t.moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 2;
    this.updateGrab();
  }
  /** The pointer came up: ends a ring drag or a drag-started transform. True when one was live. */
  pointerUp(): boolean {
    const t = this.tf;
    if (!t) return false;
    if (t.ring) this.endRingDrag();
    else if (!t.modal) this.finish(true);
    return true;
  }

  start(kind: Transform['kind'], modal: boolean): Transform | null {
    if (this.host.lookOnly()) return null; // look-only while exploded or stepping
    const list = this.host.store.selectedParts();
    if (!list.length) return null;
    const ids = new Set(list.map((p) => p.id));
    const aabb = unionAABB(list);
    this.host.rig.enabled = false;
    this.host.clearHover();
    this.tf = {
      kind,
      modal,
      constraint: null,
      constraintKey: '',
      frame: list[0]!.q,
      local: false,
      along: 0,
      frameSnap: null,
      origin: new THREE.Vector3().fromArray(aabbCenter(aabb)),
      ids,
      startPos: list.map((p) => [...p.pos] as Vec3),
      aabb,
      others: this.host.store.parts.filter((p) => !ids.has(p.id) && !p.hidden).map(partAABB),
      otherNames: this.host.store.parts
        .filter((p) => !ids.has(p.id) && !p.hidden)
        .map((p) => p.name),
      snaps: [],
      before: this.host.store.snapshot(),
      moved: modal,
      delta: [0, 0, 0],
      typed: '',
      ring: null,
      angles: [0, 0, 0],
      rotAxis: null,
      pivot: this.pivotMode,
      size: null,
      array: null,
    };
    if (modal) this.host.container.style.cursor = kind === 'rotate' ? '' : 'move';
    return this.tf;
  }

  /** The point the current rotation turns about, in world space. */
  private pivotOf(t: Transform): THREE.Vector3 {
    return new THREE.Vector3().fromArray(pivotPoint(t.aabb, t.pivot));
  }

  /** P while rotating: the next (or, with Shift, previous) pivot; the rings move to it. */
  private cyclePivot(back: boolean): void {
    const t = this.tf;
    if (t?.kind !== 'rotate') return;
    const i = PIVOTS.indexOf(t.pivot);
    t.pivot = PIVOTS[(i + (back ? PIVOTS.length - 1 : 1)) % PIVOTS.length]!;
    this.pivotMode = t.pivot;
    t.origin = this.pivotOf(t);
  }

  /** Turn the selection by degrees about an axis during rotate mode, keeping the readout. */
  private turn(axis: AxisIndex, deg: number): void {
    const t = this.tf;
    if (t?.kind !== 'rotate' || !deg) return;
    const pivot = t.pivot === 'center' ? undefined : pivotPoint(t.aabb, t.pivot);
    rotatePartsBy(this.host.store.selectedParts(), AXIS_NAMES[axis]!, deg, pivot);
    t.angles[axis] = (((t.angles[axis] + deg) % 360) + 360) % 360;
    t.rotAxis = axis;
    t.moved = true;
    this.host.syncAll();
    this.host.store.notify('drag');
  }

  beginRingDrag(axis: AxisIndex): void {
    const t = this.tf;
    if (t?.kind !== 'rotate') return;
    const a = ringAngle(t.origin, axis, this.host.currentRay());
    if (a === null) return;
    t.ring = { axis, start: a, last: a, applied: 0, moved: false };
  }

  private updateRingDrag(): void {
    const t = this.tf;
    const r = t?.ring;
    if (!t || !r) return;
    const a = ringAngle(t.origin, r.axis, this.host.currentRay());
    if (a === null) return;
    // Unwrap so a drag past ±180° keeps counting in the same direction.
    let d = a - r.last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    r.last += d;
    // Snap the drag to 15° steps, or single degrees with Ctrl held.
    const step = this.host.fine() ? 1 : 15;
    const want = Math.round(((r.last - r.start) * 180) / Math.PI / step) * step;
    if (want !== r.applied) {
      this.turn(r.axis, want - r.applied);
      r.applied = want;
    }
  }

  private endRingDrag(): void {
    const t = this.tf;
    const r = t?.ring;
    if (!t || !r) return;
    // A click on a ring, with no drag to speak of, is one quarter turn.
    if (!r.moved && r.applied === 0) this.turn(r.axis, 90);
    t.ring = null;
  }

  /**
   * Shift+R: array the selection by dragging. Copies fill toward the pointer at the
   * given spacing (16" on centre unless told otherwise), X / Y / Z lock the axis, a typed
   * number is a count and a typed length a span; Enter or a click keeps it as a live
   * array. On an existing array, the drag re-fits it from its source cell.
   */
  beginArray(base: Partial<ArrayParams> = {}): void {
    if (this.tf) return;
    const g = this.host.store.selectedGroup();
    if (g?.array) this.host.store.select(this.host.store.arraySource(g).map((p) => p.id));
    const t = this.start('array', true);
    if (!t) return;
    const { axis, mode, spacing, reverse } = { ...g?.array, ...base };
    const params: ArrayParams = {
      axis: axis ?? 'x',
      mode: mode ?? 'center',
      spacing: spacing ?? ARRAY_SPACING,
    };
    if (reverse) params.reverse = true;
    const size = t.aabb.max.map((v, i) => v - t.aabb.min[i]!) as Vec3;
    const cell = this.host.store.selectedParts();
    const extentLocal = ([0, 1, 2] as AxisIndex[]).map((a) =>
      extentAlong(cell, localAxisDir(t.frame, a)),
    ) as Vec3;
    t.array = { base: params, extent: size, applied: null, distance: 0, axis: 0, extentLocal };
    this.host.store.beginCoalesce();
    this.setConstraint('');
  }

  /** G: grab the selection so it follows the pointer until confirmed. */
  beginGrab(): void {
    if (this.tf) return;
    const t = this.start('grab', true);
    if (t) this.setConstraint('');
  }
  /** R: wait for an axis key, then turn the selection a quarter turn about it. */
  beginRotate(): void {
    if (this.tf) return;
    this.start('rotate', true);
  }
  /** S: the length follows the mouse (Blender's scale) or a typed length; Enter confirms. */
  beginSize(): void {
    if (this.tf) return;
    const t = this.start('size', true);
    if (!t) return;
    const r = this.host.container.getBoundingClientRect();
    const [px, py] = toScreen(this.host.rig, t.origin);
    const pivot: [number, number] = [px + r.left, py + r.top];
    t.size = {
      startLens: this.host.store.selectedParts().map((p) => p.len),
      pivot,
      start: this.host.lastPointer() ?? pivot,
      end: 0,
      dir: new THREE.Vector3(1, 0, 0),
      at: t.origin.clone(),
      ref: 0,
      faceAxis: null,
      faceAt: 0,
    };
  }

  /** Drag on an end handle: pull that end of the one selected part, the other end fixed. */
  beginEndDrag(end: 1 | -1): Transform | null {
    const p = this.host.store.selectedParts()[0];
    if (!p) return null;
    const t = this.start('size', false);
    if (!t) return null;
    const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().fromArray(p.q));
    const at = new THREE.Vector3().fromArray(p.pos).addScaledVector(dir, (end * p.len) / 2);
    let faceAxis: AxisIndex | null = null;
    if (isSquare(p.q)) {
      faceAxis = 0;
      for (const a of [1, 2] as const)
        if (Math.abs(dir.getComponent(a)) > Math.abs(dir.getComponent(faceAxis))) faceAxis = a;
    }
    t.size = {
      startLens: [p.len],
      pivot: [0, 0],
      start: [0, 0],
      end,
      dir,
      at,
      ref: axisParam(at, dir, this.host.currentRay()),
      faceAxis,
      faceAt: faceAxis === null ? 0 : at.getComponent(faceAxis),
    };
    t.moved = true;
    return t;
  }

  /** Size mode with the mouse: scale from S, or pull an end from a handle. */
  private updateSize(): void {
    const t = this.tf;
    const sz = t?.size;
    if (t?.kind !== 'size' || !sz || t.typed) return;
    const list = this.host.store.selectedParts();
    const grid = this.host.store.settings.grid;
    t.snaps = [];
    if (sz.end === 0) {
      const f = scaleFactor(sz.pivot, sz.start, this.host.lastPointer() ?? sz.start);
      list.forEach((p, i) =>
        withMinKept(p, () => (p.len = snapLength(sz.startLens[i]! * f, grid))),
      );
      this.host.snapFx.hide();
    } else {
      const p = list[0];
      if (!p) return;
      const start = sz.startLens[0]!;
      let delta = axisParam(sz.at, sz.dir, this.host.currentRay()) - sz.ref;
      if (sz.faceAxis !== null) {
        // A square part: the moving end face snaps to other faces (or the grid) along its axis.
        const a = sz.faceAxis;
        const sign = sz.dir.getComponent(a) < 0 ? -1 : 1;
        const slab: AABB = { min: [...t.aabb.min], max: [...t.aabb.max] };
        slab.min[a] = slab.max[a] = sz.faceAt;
        const r = snapEnd(slab, a, delta * sign, t.others, this.host.store.settings);
        delta = r.delta * sign;
        t.snaps = r.hits;
        this.host.snapFx.show(r.hits, r.moved, t.others);
      } else delta = (snapLength(start + sz.end * delta, grid) - start) * sz.end;
      const { len, shift } = pullEnd(start, sz.end, delta);
      p.len = len;
      const sp = t.startPos[0]!;
      p.pos = [sp[0] + sz.dir.x * shift, sp[1] + sz.dir.y * shift, sp[2] + sz.dir.z * shift];
    }
    t.moved = true;
    for (const p of list) this.host.syncMesh(p);
    this.host.store.notify('drag');
  }
  /**
   * Choose what a grab may change: '' the floor plane, 'x' | 'y' | 'z' one axis, or
   * 'X' | 'Y' | 'Z' the plane without that axis. The reference is set so the parts stay
   * where they are at the moment of the change.
   */
  setConstraint(key: string, local = false): void {
    const t = this.tf;
    if (t?.kind !== 'grab' && t?.kind !== 'array') return;
    const ray = this.host.currentRay();
    const delta = new THREE.Vector3().fromArray(t.delta);
    const axisDir = (a: AxisIndex) => (local ? localAxisDir(t.frame, a) : Gizmo.axisDir(a));
    if (key !== '' && key === key.toLowerCase()) {
      const axis = AXIS_NAMES.indexOf(key as 'x' | 'y' | 'z') as AxisIndex;
      const dir = axisDir(axis);
      t.along = delta.dot(dir);
      t.constraint = { kind: 'axis', axis, dir, ref: axisParam(t.origin, dir, ray) - t.along };
    } else {
      const normal: AxisIndex = key
        ? (AXIS_NAMES.indexOf(key.toLowerCase() as 'x' | 'y' | 'z') as AxisIndex)
        : UP;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        axisDir(normal),
        t.origin.clone().add(delta),
      );
      const pt = new THREE.Vector3();
      if (!ray.intersectPlane(plane, pt)) return; // edge-on: keep the old constraint
      const axes = ([0, 1, 2] as AxisIndex[]).filter((a) => a !== normal);
      t.constraint = { kind: 'plane', axes, plane, ref: pt.sub(delta) };
    }
    t.constraintKey = key;
    t.local = local && key !== '';
  }

  private rawDelta(t: Transform): Vec3 | null {
    const c = t.constraint;
    if (!c) return null;
    const ray = this.host.currentRay();
    const raw: Vec3 = [0, 0, 0];
    if (c.kind === 'axis') {
      const s = axisParam(t.origin, c.dir, ray) - c.ref;
      if (t.local) {
        // Along the frame's axis: the move is that far along the axis's world direction.
        t.along = s;
        return c.dir.clone().multiplyScalar(s).toArray();
      }
      raw[c.axis] = s;
    } else {
      const pt = new THREE.Vector3();
      if (!ray.intersectPlane(c.plane, pt)) return null;
      if (t.local) return pt.clone().sub(c.ref).toArray();
      for (const a of c.axes) raw[a] = pt.getComponent(a) - c.ref.getComponent(a);
    }
    return raw;
  }

  private applyDelta(delta: Vec3): void {
    const t = this.tf;
    if (!t) return;
    t.delta = delta;
    const list = this.host.store.selectedParts();
    list.forEach((p, i) => {
      const s = t.startPos[i]!;
      p.pos = [s[0] + delta[0], s[1] + delta[1], s[2] + delta[2]];
      this.host.syncMesh(p);
    });
    this.host.store.notify('drag');
  }

  private updateGrab(): void {
    const t = this.tf;
    if ((t?.kind !== 'grab' && t?.kind !== 'array') || !t.moved || !t.constraint) return;
    const raw = this.rawDelta(t);
    if (!raw) return;
    const axes = t.constraint.kind === 'axis' ? [t.constraint.axis] : t.constraint.axes;
    if (t.kind === 'array') {
      this.updateArray(t, raw, axes);
      return;
    }
    if (t.local) {
      // Along the part's own axis: snap to the faces of parts that share its frame.
      if (t.constraint.kind === 'axis') {
        t.along = this.snapAlong(t, t.constraint.axis, t.along);
        this.applyDelta(t.constraint.dir.clone().multiplyScalar(t.along).toArray());
      } else {
        this.applyDelta(raw);
        t.snaps = [];
      }
      this.host.snapFx.hide();
      return;
    }
    t.snaps = snapWithHits(t.aabb, raw, axes, t.others, this.host.store.settings).hits;
    this.applyDelta(raw);
    this.host.snapFx.show(t.snaps, translateAABB(t.aabb, t.delta), t.others);
  }

  /**
   * Snap a move of `along` on local `axis` to the faces of co-framed parts, in the frame
   * of the first selected part. Sets `t.snaps` for the readout; returns the snapped move.
   */
  private snapAlong(t: Transform, axis: AxisIndex, along: number): number {
    if (!t.frameSnap) {
      const list = this.host.store.selectedParts();
      const start = list.map((p, i) => ({ ...p, pos: t.startPos[i]! }));
      const others = this.host.store.parts.filter((p) => !t.ids.has(p.id) && !p.hidden);
      t.frameSnap = { ...coframedBoxes(others, t.frame), mine: unionInFrame(start, t.frame) };
    }
    const d: Vec3 = [0, 0, 0];
    d[axis] = along;
    const { boxes } = t.frameSnap;
    t.snaps = snapWithHits(t.frameSnap.mine, d, [axis], boxes, {
      ...this.host.store.settings,
      grid: 0,
      floor: false,
    }).hits;
    return d[axis];
  }

  /** The copies follow the pointer along the axis it moves most on, or the locked one. */
  private updateArray(t: Transform, raw: Vec3, axes: readonly AxisIndex[]): void {
    const ad = t.array;
    if (!ad) return;
    if (t.local && t.constraint?.kind === 'axis') {
      // Along the cell's own axis: no face snapping, the distance is the drag along it.
      const axis = t.constraint.axis;
      t.along = this.snapAlong(t, axis, t.along);
      t.delta = t.constraint.dir.clone().multiplyScalar(t.along).toArray();
      this.host.snapFx.hide();
      ad.axis = axis;
      ad.distance = t.along;
      const base: ArrayParams = { ...ad.base, local: true };
      const params = arrayFromDrag(base, AXIS_NAMES[axis]!, ad.extentLocal[axis], t.along, false);
      if (!sameArray(params, ad.applied)) {
        ad.applied = params;
        this.applyArray(params);
      }
      return;
    }
    const axis = axes.length === 1 ? axes[0]! : dominantAxis(raw, axes);
    const d: Vec3 = [0, 0, 0];
    d[axis] = raw[axis];
    t.snaps = snapWithHits(t.aabb, d, [axis], t.others, this.host.store.settings).hits;
    t.delta = d;
    ad.axis = axis;
    ad.distance = d[axis];
    const params = arrayFromDrag(ad.base, AXIS_NAMES[axis]!, ad.extent[axis], d[axis], false);
    if (!sameArray(params, ad.applied)) {
      ad.applied = params;
      this.applyArray(params);
    }
    this.host.snapFx.show(t.snaps, translateAABB(t.aabb, d), t.others);
  }

  /** A live array edit during the drag, marked as ours so the notify does not end it. */
  private applyArray(params: ArrayParams): void {
    this.applying = true;
    try {
      this.host.store.setArray(params);
    } finally {
      this.applying = false;
    }
  }

  /** End an array drag: keep the array as the span dragged or the value typed, or undo it. */
  private finishArray(t: Transform, commit: boolean): void {
    const ad = t.array;
    if (!ad) return;
    const axis = AXIS_NAMES[ad.axis]!;
    const local = t.local && t.constraint?.kind === 'axis';
    const base: ArrayParams = local ? { ...ad.base, local: true } : ad.base;
    const extent = local ? ad.extentLocal[ad.axis] : ad.extent[ad.axis];
    let params: ArrayParams | null = null;
    if (commit && t.typed) params = arrayFromTyped(base, axis, t.typed, ad.distance < 0);
    else if (commit && ad.applied) params = arrayFromDrag(base, axis, extent, ad.distance, true);
    if (params && arrayCount(params, extent) > 1) {
      this.host.store.setArray(params);
      this.host.store.endCoalesce();
    } else {
      this.host.store.restore(t.before);
      this.host.store.cancelCoalesce();
    }
  }

  /** Put the view back the way it is between transforms. */
  private endTransformUi(): void {
    this.host.rig.enabled = true;
    this.host.container.style.cursor = '';
    this.host.snapFx.hide();
  }

  /**
   * Drop a transform whose starting point the model has moved away from, without
   * committing or restoring it. An array drag's coalesced changes become one undo step,
   * together with whatever else changed, rather than being lost.
   */
  abandon(): void {
    const t = this.tf;
    if (!t) return;
    this.tf = null;
    if (t.kind === 'array') this.host.store.endCoalesce();
    this.endTransformUi();
  }

  finish(commit: boolean): void {
    const t = this.tf;
    if (!t) return;
    if (t.kind !== 'array') commit = this.applyTyped(t, commit);
    // From here the transform is over: its own commit or restore must not read as an
    // outside change, and nothing below needs `this.tf`.
    this.tf = null;
    this.applying = true;
    try {
      if (t.kind === 'array') this.finishArray(t, commit);
      else if (t.moved && this.host.store.snapshot() !== t.before) {
        // Only a transform that changed something touches the history: a click that
        // merely selected, or R then Enter, leaves the model and the undo stack alone.
        if (commit) this.host.store.commit(t.before);
        else this.host.store.restore(t.before);
      }
    } finally {
      this.applying = false;
      this.endTransformUi();
    }
  }

  /**
   * Apply what was typed during a grab, rotate or size before it ends, and say whether
   * the result is to be kept: a size with nothing typed is kept only if it was dragged.
   */
  private applyTyped(t: Transform, commit: boolean): boolean {
    if (commit && t.kind === 'grab' && t.typed) {
      const v = parseLen(t.typed);
      if (v !== null) {
        const axis = this.typedAxis(t);
        const d: Vec3 = [0, 0, 0];
        if (t.local && t.constraint?.kind === 'axis') {
          const s = (t.along < 0 ? -1 : 1) * v;
          t.constraint.dir.clone().multiplyScalar(s).toArray(d);
        } else d[axis] = (t.delta[axis] < 0 ? -1 : 1) * v;
        t.moved = true;
        this.applyDelta(d);
      }
    }
    if (commit && t.kind === 'rotate' && t.typed) {
      // The typed angle is the whole turn about that axis for this rotate, whatever the
      // keys or rings did first: R X 15 Enter ends at 15°.
      const deg = parseFloat(t.typed);
      const axis = t.rotAxis ?? UP;
      if (Number.isFinite(deg)) this.turn(axis, deg - t.angles[axis]);
    }
    if (commit && t.kind === 'size') {
      if (t.typed) {
        const v = parseLen(t.typed);
        if (v !== null && v > 0) {
          for (const p of this.host.store.selectedParts()) withMinKept(p, () => (p.len = v));
          t.moved = true;
        } else commit = false;
      } else commit = t.moved && t.size !== null;
    }
    return commit;
  }

  /** The axis a typed distance applies to: the only one, or the one moved furthest so far. */
  private typedAxis(t: Transform): AxisIndex {
    const c = t.constraint;
    if (c?.kind === 'axis') return c.axis;
    const axes = c?.axes ?? [0, 1];
    let best = axes[0]!;
    for (const a of axes) if (Math.abs(t.delta[a]) > Math.abs(t.delta[best])) best = a;
    return best;
  }

  private transformText(t: Transform): string {
    if (t.kind === 'array') {
      const ad = t.array;
      if (!ad) return '';
      const axis = LABELS[ad.axis];
      if (t.typed) return `Array ${axis}: ${t.typed}▏  (a count, or a length to fill)`;
      if (!ad.applied)
        return "Array: drag along an axis (X / Y / Z locks it, twice for the part's own), or type a count or a length · Enter";
      const way = ad.distance < 0 ? '−' : '+';
      const local = t.local ? 'Local ' : '';
      const extent = t.local ? ad.extentLocal[ad.axis] : ad.extent[ad.axis];
      return `Array ${local}${way}${axis}: ${arrayText(ad.applied, extent)}` + this.snapTargets(t);
    }
    if (t.kind === 'rotate') {
      if (t.typed) return `Rotate ${LABELS[t.rotAxis ?? UP]} ${t.typed}▏°`;
      const done = ([0, 1, 2] as AxisIndex[])
        .filter((a) => signedDeg(t.angles[a]))
        .map((a) => `${LABELS[a]} ${signedDeg(t.angles[a])}°`)
        .join('  ');
      const pivot = t.pivot === 'center' ? '' : `  · about the ${pivotLabel(t.pivot)}`;
      return (
        (done ||
          'Rotate: X / Y / Z a quarter turn, type an angle, or drag a ring · P pivot · Enter') +
        pivot
      );
    }
    if (t.kind === 'size') {
      if (t.typed) return `Length: ${t.typed}▏`;
      const list = this.host.store.selectedParts();
      const len =
        list.length === 1
          ? `Length ${fmt(list[0]!.len)}`
          : `Scale ${list.map((p) => fmt(p.len)).join(', ')}`;
      return len + this.snapTargets(t);
    }
    const c = t.constraint;
    const plane = c?.kind === 'plane' && t.constraintKey ? `Shift+${t.constraintKey} ` : '';
    const local = t.local ? 'Local ' : '';
    if (t.typed) return `${plane}${local}${LABELS[this.typedAxis(t)]} ${t.typed}▏`;
    if (t.local && c?.kind === 'axis')
      return `${local}${LABELS[c.axis]} ${t.along >= 0 ? '+' : ''}${fmt(t.along)}${this.snapTargets(t)}`;
    const axes = c?.kind === 'axis' ? [c.axis] : (c?.axes ?? []);
    return (
      plane +
      axes.map((a) => `${LABELS[a]} ${t.delta[a] >= 0 ? '+' : ''}${fmt(t.delta[a])}`).join('  ') +
      this.snapTargets(t)
    );
  }

  /** " · against Leg LF, Leg RF · flush with Apron left" for the transform's snaps, or ''. */
  private snapTargets(t: Transform): string {
    const byRelation = new Map<string, string[]>();
    for (const h of t.snaps) {
      if (h.kind === 'grid') continue;
      const boxes = t.local && t.frameSnap ? t.frameSnap.boxes : t.others;
      const names = t.local && t.frameSnap ? t.frameSnap.names : t.otherNames;
      const pairs =
        h.kind === 'floor'
          ? [['on the floor', '']]
          : coplanarFaces(h, boxes).map((f) => [
              h.mine === f.side ? 'flush with' : 'against',
              names[f.other] ?? 'a part',
            ]);
      for (const [rel, name] of pairs as [string, string][]) {
        const list = byRelation.get(rel) ?? [];
        if (name && !list.includes(name)) list.push(name);
        byRelation.set(rel, list);
      }
    }
    const targets = [...byRelation]
      .map(([rel, names]) => (names.length ? `${rel} ${names.join(', ')}` : rel))
      .join(' · ');
    return targets ? `  · ${targets}` : '';
  }

  // ---- keys ----
  onKeyDown(e: KeyboardEvent): void {
    const t = this.tf;
    if (!t) return;
    const k = e.key;
    const lower = k.toLowerCase();
    if (k === 'Escape') this.finish(false);
    else if (k === 'Enter') this.finish(true);
    else if (
      (t.kind === 'grab' || t.kind === 'array') &&
      (lower === 'x' || lower === 'y' || lower === 'z')
    ) {
      // The same axis key again goes from the world axis to the part's own, then off.
      const key = e.shiftKey && t.kind === 'grab' ? lower.toUpperCase() : lower;
      if (key !== t.constraintKey) this.setConstraint(key);
      else if (key === lower && !t.local) this.setConstraint(key, true);
      else this.setConstraint('');
      this.updateGrab();
    } else if (t.kind === 'rotate' && lower === 'p') this.cyclePivot(e.shiftKey);
    else if (t.kind === 'rotate' && (lower === 'x' || lower === 'y' || lower === 'z')) {
      // An angle typed before the axis turns by it; otherwise a quarter turn.
      const axis = AXIS_NAMES.indexOf(lower) as AxisIndex;
      const typed = parseFloat(t.typed);
      const deg = t.typed && Number.isFinite(typed) ? typed : 90;
      t.typed = '';
      this.turn(axis, e.shiftKey ? -deg : deg);
    } else if (k === 'Backspace') t.typed = t.typed.slice(0, -1);
    else if (t.kind === 'rotate' && k.length === 1 && /[\d.-]/.test(k)) t.typed += k;
    else if (t.kind !== 'rotate' && k.length === 1 && /[\d./'" +*()-]/.test(k)) t.typed += k;
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
