/**
 * The 3D view: renders parts as boxes, handles picking, dragging and the Blender-style
 * modal transforms, and keeps the meshes in step with the store. All model changes
 * still go through the store.
 *
 * Moving parts (Blender keys):
 * - G grabs the selection: it follows the mouse on the floor plane; X / Y / Z constrain
 *   to one axis, Shift+X / Y / Z to the plane without that axis; type a distance;
 *   Enter or left-click confirms, Escape or right-click cancels
 * - R then X / Y / Z turns the selection a quarter turn about that axis (Shift for the
 *   other way); S then a length sets the cut length
 * - the gizmo and a part's body can also be dragged directly with the mouse
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { axisParam, Gizmo, ringAngle, RotateGizmo } from './gizmo';
import {
  aabbCenter,
  partAABB,
  partDims,
  rotateParts,
  unionAABB,
  withMinKept,
  AXIS_NAMES,
  UP,
  type AABB,
  type AxisIndex,
  type Part,
  type Vec3,
} from './model';
import { snapDelta } from './snap';
import { stockById, type Stock } from './stock';
import type { Store } from './store';
import { fmt, parseLen } from './units';

type Constraint =
  | { kind: 'plane'; axes: AxisIndex[]; plane: THREE.Plane; ref: THREE.Vector3 }
  | { kind: 'axis'; axis: AxisIndex; dir: THREE.Vector3; ref: number };

interface Transform {
  kind: 'grab' | 'rotate' | 'size';
  /** Started from the keyboard: follows the pointer, confirmed by click or Enter. */
  modal: boolean;
  constraint: Constraint | null;
  /** '' for the floor plane, 'x' | 'y' | 'z' for an axis, 'X' | 'Y' | 'Z' for a plane. */
  constraintKey: string;
  origin: THREE.Vector3;
  ids: Set<number>;
  startPos: Vec3[];
  aabb: AABB;
  others: AABB[];
  before: string;
  moved: boolean;
  delta: Vec3;
  /** Digits typed during the transform, applied on Enter. */
  typed: string;
  /** A ring being dragged in rotate mode. */
  ring: RingDrag | null;
  /** Quarter turns applied so far in rotate mode, per axis, for the readout. */
  turns: Vec3;
}

interface RingDrag {
  axis: AxisIndex;
  /** Angle at the start of the drag and the last unwrapped angle, radians. */
  start: number;
  last: number;
  /** Quarter turns applied by this drag so far. */
  applied: number;
  moved: boolean;
}

interface BoxSelect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
  active: boolean;
}

export type ViewName =
  'iso' | 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left' | 'fit' | 'selected';
type MeshState = 'normal' | 'hover' | 'selected';

const EDGE_COLORS: Record<MeshState, number> = {
  normal: 0x3a2a15,
  hover: 0xd9c08a,
  selected: 0x9fd3ff,
};
const EMISSIVE: Record<MeshState, number> = { normal: 0, hover: 0x2a2416, selected: 0x1e4b73 };
const LABELS = ['X', 'Y', 'Z'] as const;
/** Quarter turns as a signed count in -1..2, so three turns read as -90°. */
const signedTurns = (n: number): number => ((((n + 1) % 4) + 4) % 4) - 1;
const Z_UP = new THREE.Vector3(0, 0, 1);
const VIEW_DIRS: Record<Exclude<ViewName, 'fit' | 'selected'>, THREE.Vector3> = {
  iso: new THREE.Vector3(1, -1, 0.8),
  top: new THREE.Vector3(0, -0.0001, 1),
  bottom: new THREE.Vector3(0, -0.0001, -1),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
};

export class LumberScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private partsGroup = new THREE.Group();
  private meshes = new Map<number, THREE.Group>();
  private matCache = new Map<string, THREE.MeshLambertMaterial>();
  private edgeMats: Record<MeshState, THREE.LineBasicMaterial> = {
    normal: new THREE.LineBasicMaterial({ color: EDGE_COLORS.normal }),
    hover: new THREE.LineBasicMaterial({ color: EDGE_COLORS.hover }),
    selected: new THREE.LineBasicMaterial({ color: EDGE_COLORS.selected }),
  };
  private gizmo = new Gizmo();
  private rotateGizmo = new RotateGizmo();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tf: Transform | null = null;
  private box: BoxSelect | null = null;
  private lastPointer: [number, number] | null = null;
  private downPos: [number, number] | null = null;
  private hoverId: number | null = null;
  private labelEl: HTMLElement;
  private dragLabelEl: HTMLElement;
  private boxEl: HTMLElement;

  constructor(
    private container: HTMLElement,
    private store: Store,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'part-label';
    this.dragLabelEl = document.createElement('div');
    this.dragLabelEl.className = 'drag-label';
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'box-select';
    container.append(this.labelEl, this.dragLabelEl, this.boxEl);

    this.scene.background = new THREE.Color(0x202226);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
    this.camera.up.copy(Z_UP);
    this.camera.position.set(90, -110, 70);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 18);
    // Blender: middle button orbits, Shift+middle pans, wheel zooms. Right-drag also pans.
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.minDistance = 10;
    this.controls.maxDistance = 1200;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a74, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(60, -40, 120);
    this.scene.add(sun);
    // The floor grid is translucent so the model still reads when viewed from below.
    const minor = new THREE.GridHelper(240, 240, 0x33363b, 0x2a2d31);
    const major = new THREE.GridHelper(240, 20, 0x4a4e55, 0x4a4e55);
    major.position.z = 0.01;
    for (const g of [minor, major]) {
      g.rotation.x = Math.PI / 2; // GridHelper is built in XZ; lay it in XY
      const m = g.material as THREE.Material;
      m.transparent = true;
      m.opacity = 0.55;
      m.depthWrite = false;
    }
    this.scene.add(minor, major);
    const axes = new THREE.AxesHelper(12);
    axes.position.z = 0.02;
    this.scene.add(axes);
    this.scene.add(this.partsGroup, this.gizmo.group, this.rotateGizmo.group);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    el.addEventListener('pointerleave', () => this.setHover(null));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keys during a transform take priority over the app's shortcuts.
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { capture: true });

    store.subscribe((kind) => {
      if (kind === 'model' || kind === 'selection') this.syncAll();
    });
    this.syncAll();
    this.animate();
  }

  get transforming(): boolean {
    return this.tf !== null;
  }

  // ---- meshes ----
  private materialFor(stock: Stock, state: MeshState): THREE.MeshLambertMaterial {
    const key = `${stock.id}:${state}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: stock.color, emissive: EMISSIVE[state] });
      this.matCache.set(key, m);
    }
    return m;
  }
  private stateOf(id: number): MeshState {
    if (this.store.selected.has(id)) return 'selected';
    if (this.hoverId === id) return 'hover';
    return 'normal';
  }
  private buildMesh(p: Part): THREE.Group {
    const d = partDims(p);
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(d[0], d[1], d[2]);
    const mesh = new THREE.Mesh(geo, this.materialFor(stockById(p.stock), 'normal'));
    mesh.userData.id = p.id;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeMats.normal);
    g.add(mesh, edges);
    g.userData.id = p.id;
    g.userData.sig = `${d.join(',')},${p.stock}`;
    return g;
  }
  private disposeGroup(g: THREE.Group): void {
    this.partsGroup.remove(g);
    for (const c of g.children) (c as THREE.Mesh).geometry.dispose();
  }
  private syncMesh(p: Part): void {
    let g = this.meshes.get(p.id);
    const d = partDims(p);
    const sig = `${d.join(',')},${p.stock}`;
    if (!g || g.userData.sig !== sig) {
      if (g) this.disposeGroup(g);
      g = this.buildMesh(p);
      this.partsGroup.add(g);
      this.meshes.set(p.id, g);
    }
    g.position.fromArray(p.pos);
    g.quaternion.fromArray(p.q);
    g.visible = !p.hidden;
    this.applyState(g, p);
  }
  private applyState(g: THREE.Group, p: Part): void {
    const state = this.stateOf(p.id);
    (g.children[0] as THREE.Mesh).material = this.materialFor(stockById(p.stock), state);
    (g.children[1] as THREE.LineSegments).material = this.edgeMats[state];
  }
  syncAll(): void {
    const live = new Set(this.store.parts.map((p) => p.id));
    for (const [id, g] of this.meshes)
      if (!live.has(id)) {
        this.disposeGroup(g);
        this.meshes.delete(id);
      }
    for (const p of this.store.parts) this.syncMesh(p);
  }
  private setHover(id: number | null): void {
    if (id === this.hoverId) return;
    const prev = this.hoverId;
    this.hoverId = id;
    for (const pid of [prev, id]) {
      const p = pid === null ? undefined : this.store.partById(pid);
      const g = pid === null ? undefined : this.meshes.get(pid);
      if (p && g) this.applyState(g, p);
    }
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    const center = this.selectionCenter();
    const rotating = this.tf?.kind === 'rotate';
    this.gizmo.update(rotating ? null : center, this.camera);
    this.rotateGizmo.update(rotating ? center : null, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  };

  private selectionCenter(): THREE.Vector3 | null {
    const list = this.store.selectedParts();
    if (!list.length) return null;
    return new THREE.Vector3().fromArray(aabbCenter(unionAABB(list)));
  }

  private toScreen(v: THREE.Vector3): [number, number] {
    const p = v.clone().project(this.camera);
    return [
      ((p.x + 1) / 2) * this.container.clientWidth,
      ((1 - p.y) / 2) * this.container.clientHeight,
    ];
  }

  private updateLabels(): void {
    const { selected } = this.store;
    const p = selected.size === 1 ? this.store.partById([...selected][0]!) : undefined;
    const c = this.selectionCenter();
    if (p && c) {
      // Sit the label above the gizmo's up arrow so the two never overlap.
      const [x, y] = this.toScreen(c.clone().setZ(c.z + this.gizmo.group.scale.z * 1.15));
      this.labelEl.style.display = 'block';
      this.labelEl.style.left = `${x}px`;
      this.labelEl.style.top = `${y}px`;
      const s = stockById(p.stock);
      this.labelEl.textContent = `${p.name} · ${s.name} · ${s.sheet ? fmt(p.w ?? s.sheet[0]) + ' × ' : ''}${fmt(p.len)}`;
    } else this.labelEl.style.display = 'none';

    const t = this.tf;
    if (t && c && (t.moved || t.modal)) {
      const [x, y] = this.toScreen(c);
      this.dragLabelEl.style.display = 'block';
      this.dragLabelEl.style.left = `${x}px`;
      this.dragLabelEl.style.top = `${y}px`;
      this.dragLabelEl.textContent = this.transformText(t);
    } else this.dragLabelEl.style.display = 'none';
  }

  private transformText(t: Transform): string {
    if (t.kind === 'rotate') {
      const done = ([0, 1, 2] as AxisIndex[])
        .filter((a) => t.turns[a])
        .map((a) => `${LABELS[a]} ${signedTurns(t.turns[a]) * 90}°`)
        .join('  ');
      return done || 'Rotate: drag a ring, or X / Y / Z (Shift reverses) · Enter';
    }
    if (t.kind === 'size') return `Length: ${t.typed}▏`;
    const c = t.constraint;
    const plane = c?.kind === 'plane' && t.constraintKey ? `Shift+${t.constraintKey} ` : '';
    if (t.typed) return `${plane}${LABELS[this.typedAxis(t)]} ${t.typed}▏`;
    const axes = c?.kind === 'axis' ? [c.axis] : (c?.axes ?? []);
    return (
      plane +
      axes.map((a) => `${LABELS[a]} ${t.delta[a] >= 0 ? '+' : ''}${fmt(t.delta[a])}`).join('  ')
    );
  }

  // ---- views ----
  private bounds(parts: readonly Part[]): AABB {
    return parts.length ? unionAABB(parts) : { min: [-24, -24, 0], max: [24, 24, 24] };
  }
  setView(name: ViewName): void {
    const parts =
      name === 'selected' && this.store.selected.size
        ? this.store.selectedParts()
        : this.store.visibleParts();
    const u = this.bounds(parts);
    const center = new THREE.Vector3().fromArray(aabbCenter(u));
    const radius = Math.max(12, new THREE.Vector3().fromArray(u.max).distanceTo(center));
    const dist = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.1;
    const dir =
      name === 'fit' || name === 'selected'
        ? this.camera.position.clone().sub(this.controls.target)
        : VIEW_DIRS[name].clone();
    this.camera.position.copy(center).add(dir.normalize().multiplyScalar(dist));
    this.controls.target.copy(center);
    this.controls.update();
  }
  /** Turn the camera about the model: `az` degrees around the up axis, `el` degrees up or down. */
  orbitStep(az: number, el: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (az) offset.applyAxisAngle(Z_UP, (az * Math.PI) / 180);
    if (el) {
      const side = new THREE.Vector3().crossVectors(Z_UP, offset);
      if (side.lengthSq() > 1e-9) {
        side.normalize();
        const polar = offset.angleTo(Z_UP);
        const step = (el * Math.PI) / 180;
        const target = Math.min(Math.PI - 0.01, Math.max(0.01, polar - step));
        offset.applyAxisAngle(side, polar - target);
      }
    }
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  // ---- picking ----
  private setRay(clientX: number, clientY: number): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }
  private pickPart(): THREE.Intersection | null {
    const meshes = this.partsGroup.children.filter((g) => g.visible).map((g) => g.children[0]!);
    return this.ray.intersectObjects(meshes, false)[0] ?? null;
  }
  /** Where a screen position lands on the floor, or null when it misses. */
  groundPoint(clientX: number, clientY: number): Vec3 | null {
    this.setRay(clientX, clientY);
    const out = new THREE.Vector3();
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(Z_UP, 0), out);
    return hit ? [out.x, out.y, out.z] : null;
  }
  private currentRay(): THREE.Ray {
    const [x, y] = this.lastPointer ?? [0, 0];
    this.setRay(x, y);
    return this.ray.ray;
  }

  // ---- transforms ----
  private startTransform(kind: Transform['kind'], modal: boolean): Transform | null {
    const list = this.store.selectedParts();
    if (!list.length) return null;
    const ids = new Set(list.map((p) => p.id));
    const aabb = unionAABB(list);
    this.controls.enabled = false;
    this.gizmo.setHover(null);
    this.tf = {
      kind,
      modal,
      constraint: null,
      constraintKey: '',
      origin: new THREE.Vector3().fromArray(aabbCenter(aabb)),
      ids,
      startPos: list.map((p) => [...p.pos] as Vec3),
      aabb,
      others: this.store.parts.filter((p) => !ids.has(p.id) && !p.hidden).map(partAABB),
      before: this.store.snapshot(),
      moved: modal,
      delta: [0, 0, 0],
      typed: '',
      ring: null,
      turns: [0, 0, 0],
    };
    if (modal) this.container.style.cursor = kind === 'rotate' ? '' : 'move';
    return this.tf;
  }

  /** Turn the selection quarter turns about an axis during rotate mode, keeping the readout. */
  private turn(axis: AxisIndex, turns: number): void {
    const t = this.tf;
    if (!t || t.kind !== 'rotate' || !turns) return;
    rotateParts(this.store.selectedParts(), AXIS_NAMES[axis]!, turns);
    t.turns[axis] = ((((t.turns[axis] + turns) % 4) + 4) % 4) as number;
    t.moved = true;
    this.syncAll();
    this.store.notify('drag');
  }

  private beginRingDrag(axis: AxisIndex): void {
    const t = this.tf;
    if (!t || t.kind !== 'rotate') return;
    const a = ringAngle(t.origin, axis, this.currentRay());
    if (a === null) return;
    t.ring = { axis, start: a, last: a, applied: 0, moved: false };
  }

  private updateRingDrag(): void {
    const t = this.tf;
    const r = t?.ring;
    if (!t || !r) return;
    const a = ringAngle(t.origin, r.axis, this.currentRay());
    if (a === null) return;
    // Unwrap so a drag past ±180° keeps counting in the same direction.
    let d = a - r.last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    r.last += d;
    const want = Math.round((r.last - r.start) / (Math.PI / 2));
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
    if (!r.moved && r.applied === 0) this.turn(r.axis, 1);
    t.ring = null;
  }

  /** G: grab the selection so it follows the pointer until confirmed. */
  beginGrab(): void {
    if (this.tf) return;
    const t = this.startTransform('grab', true);
    if (t) this.setConstraint('');
  }
  /** R: wait for an axis key, then turn the selection a quarter turn about it. */
  beginRotate(): void {
    if (this.tf) return;
    this.startTransform('rotate', true);
  }
  /** S: type a length and press Enter to set the cut length of the selection. */
  beginSize(): void {
    if (this.tf) return;
    this.startTransform('size', true);
  }
  /** Shift+D: copy in place and grab the copies. */
  duplicateAndGrab(): void {
    if (this.tf || !this.store.selected.size) return;
    this.store.duplicateSelected([0, 0, 0]);
    this.beginGrab();
  }

  /**
   * Choose what a grab may change: '' the floor plane, 'x' | 'y' | 'z' one axis, or
   * 'X' | 'Y' | 'Z' the plane without that axis. The reference is set so the parts stay
   * where they are at the moment of the change.
   */
  private setConstraint(key: string): void {
    const t = this.tf;
    if (!t || t.kind !== 'grab') return;
    const ray = this.currentRay();
    const delta = new THREE.Vector3().fromArray(t.delta);
    if (key && key === key.toLowerCase()) {
      const axis = AXIS_NAMES.indexOf(key as 'x' | 'y' | 'z') as AxisIndex;
      const dir = Gizmo.axisDir(axis);
      t.constraint = {
        kind: 'axis',
        axis,
        dir,
        ref: axisParam(t.origin, dir, ray) - t.delta[axis],
      };
    } else {
      const normal: AxisIndex = key
        ? (AXIS_NAMES.indexOf(key.toLowerCase() as 'x' | 'y' | 'z') as AxisIndex)
        : UP;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        Gizmo.axisDir(normal),
        t.origin.clone().add(delta),
      );
      const pt = new THREE.Vector3();
      if (!ray.intersectPlane(plane, pt)) return; // edge-on: keep the old constraint
      const axes = ([0, 1, 2] as AxisIndex[]).filter((a) => a !== normal);
      t.constraint = { kind: 'plane', axes, plane, ref: pt.sub(delta) };
    }
    t.constraintKey = key;
  }

  private rawDelta(t: Transform): Vec3 | null {
    const c = t.constraint;
    if (!c) return null;
    const ray = this.currentRay();
    const raw: Vec3 = [0, 0, 0];
    if (c.kind === 'axis') raw[c.axis] = axisParam(t.origin, c.dir, ray) - c.ref;
    else {
      const pt = new THREE.Vector3();
      if (!ray.intersectPlane(c.plane, pt)) return null;
      for (const a of c.axes) raw[a] = pt.getComponent(a) - c.ref.getComponent(a);
    }
    return raw;
  }

  private applyDelta(delta: Vec3): void {
    const t = this.tf;
    if (!t) return;
    t.delta = delta;
    const list = this.store.selectedParts();
    list.forEach((p, i) => {
      const s = t.startPos[i]!;
      p.pos = [s[0] + delta[0], s[1] + delta[1], s[2] + delta[2]];
      this.syncMesh(p);
    });
    this.store.notify('drag');
  }

  private updateGrab(): void {
    const t = this.tf;
    if (!t || t.kind !== 'grab' || !t.moved || !t.constraint) return;
    const raw = this.rawDelta(t);
    if (!raw) return;
    const axes = t.constraint.kind === 'axis' ? [t.constraint.axis] : t.constraint.axes;
    snapDelta(t.aabb, raw, axes, t.others, this.store.settings);
    this.applyDelta(raw);
  }

  private finishTransform(commit: boolean): void {
    const t = this.tf;
    if (!t) return;
    if (commit && t.kind === 'grab' && t.typed) {
      const v = parseLen(t.typed);
      if (v !== null) {
        const axis = this.typedAxis(t);
        const d: Vec3 = [0, 0, 0];
        d[axis] = (t.delta[axis] < 0 ? -1 : 1) * v;
        t.moved = true;
        this.applyDelta(d);
      }
    }
    if (commit && t.kind === 'size') {
      const v = parseLen(t.typed);
      if (v !== null && v > 0) {
        for (const p of this.store.selectedParts()) withMinKept(p, () => (p.len = v));
        t.moved = true;
      } else commit = false;
    }
    if (commit && t.moved) this.store.commit(t.before);
    else this.store.restore(t.before);
    this.controls.enabled = true;
    this.container.style.cursor = '';
    this.tf = null;
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

  // ---- pointer ----
  private onPointerDown(e: PointerEvent): void {
    this.lastPointer = [e.clientX, e.clientY];
    if (this.tf?.modal) {
      if (e.button === 0 && this.tf.kind === 'rotate') {
        this.setRay(e.clientX, e.clientY);
        const rh = this.rotateGizmo.pick(this.ray);
        if (rh) {
          this.downPos = [e.clientX, e.clientY];
          this.beginRingDrag(rh.axis);
          this.capture(e);
          return;
        }
      }
      if (e.button === 0) this.finishTransform(true);
      else if (e.button === 2) this.finishTransform(false);
      return;
    }
    if (e.button !== 0) return;
    this.downPos = [e.clientX, e.clientY];
    this.setRay(e.clientX, e.clientY);

    // Gizmo handles win over parts.
    const gh = this.gizmo.pick(this.ray);
    const center = this.selectionCenter();
    if (gh && center) {
      const t = this.startTransform('grab', false);
      if (!t) return;
      if (gh.handle.kind === 'axis') this.setConstraint(AXIS_NAMES[gh.handle.axis]!);
      else this.setConstraint(AXIS_NAMES[3 - gh.handle.axes[0] - gh.handle.axes[1]]!.toUpperCase());
      this.capture(e);
      return;
    }

    const hit = this.pickPart();
    if (hit) {
      const id = hit.object.userData.id as number;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        this.store.toggleSelect(id);
        return;
      }
      if (!this.store.selected.has(id)) this.store.select([id]);
      const t = this.startTransform('grab', false);
      if (!t) return;
      // Slide on a floor-parallel plane through the grabbed point.
      const plane = new THREE.Plane(Z_UP, -hit.point.z);
      t.constraint = { kind: 'plane', axes: [0, 1], plane, ref: hit.point.clone() };
      this.capture(e);
      return;
    }

    // Empty space: box select (Shift adds to the selection).
    this.box = {
      x0: e.clientX,
      y0: e.clientY,
      x1: e.clientX,
      y1: e.clientY,
      additive: e.shiftKey,
      active: false,
    };
    this.capture(e);
  }

  private capture(e: PointerEvent): void {
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
  }

  private onPointerMove(e: PointerEvent): void {
    this.lastPointer = [e.clientX, e.clientY];
    const t = this.tf;
    if (t) {
      if (t.kind === 'rotate') {
        if (t.ring) {
          if (!t.ring.moved && this.downPos)
            t.ring.moved = Math.hypot(e.clientX - this.downPos[0], e.clientY - this.downPos[1]) > 4;
          if (t.ring.moved) this.updateRingDrag();
        } else {
          this.setRay(e.clientX, e.clientY);
          const rh = this.rotateGizmo.pick(this.ray);
          this.rotateGizmo.setHover(rh?.object ?? null);
          this.container.style.cursor = rh ? 'grab' : '';
        }
        return;
      }
      if (t.kind !== 'grab') return;
      if (!t.moved && this.downPos)
        t.moved = Math.hypot(e.clientX - this.downPos[0], e.clientY - this.downPos[1]) > 2;
      this.updateGrab();
      return;
    }
    if (this.box) {
      this.box.x1 = e.clientX;
      this.box.y1 = e.clientY;
      if (!this.box.active && Math.hypot(e.clientX - this.box.x0, e.clientY - this.box.y0) > 3)
        this.box.active = true;
      if (this.box.active) this.drawBox();
      return;
    }
    this.setRay(e.clientX, e.clientY);
    const gh = this.gizmo.pick(this.ray);
    this.gizmo.setHover(gh?.object ?? null);
    const hit = gh ? null : this.pickPart();
    this.setHover(hit ? (hit.object.userData.id as number) : null);
    this.container.style.cursor = gh ? 'move' : hit ? 'grab' : '';
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.tf?.ring) this.endRingDrag();
    else if (this.tf && !this.tf.modal) this.finishTransform(true);
    else if (this.box) {
      const b = this.box;
      this.box = null;
      this.boxEl.style.display = 'none';
      if (b.active) this.selectInBox(b);
      else if (Math.hypot(e.clientX - b.x0, e.clientY - b.y0) < 3 && !b.additive)
        this.store.select([]);
    }
    this.downPos = null;
  }

  private drawBox(): void {
    const b = this.box!;
    const r = this.container.getBoundingClientRect();
    const x = Math.min(b.x0, b.x1) - r.left;
    const y = Math.min(b.y0, b.y1) - r.top;
    this.boxEl.style.display = 'block';
    this.boxEl.style.left = `${x}px`;
    this.boxEl.style.top = `${y}px`;
    this.boxEl.style.width = `${Math.abs(b.x1 - b.x0)}px`;
    this.boxEl.style.height = `${Math.abs(b.y1 - b.y0)}px`;
  }

  private selectInBox(b: BoxSelect): void {
    const r = this.container.getBoundingClientRect();
    const x0 = Math.min(b.x0, b.x1) - r.left;
    const x1 = Math.max(b.x0, b.x1) - r.left;
    const y0 = Math.min(b.y0, b.y1) - r.top;
    const y1 = Math.max(b.y0, b.y1) - r.top;
    const ids = b.additive ? new Set(this.store.selected) : new Set<number>();
    for (const p of this.store.visibleParts()) {
      const [x, y] = this.toScreen(new THREE.Vector3().fromArray(aabbCenter(partAABB(p))));
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) ids.add(p.id);
    }
    this.store.select(ids);
  }

  // ---- keys during a transform ----
  private onKeyDown(e: KeyboardEvent): void {
    const t = this.tf;
    if (!t) return;
    const k = e.key;
    const lower = k.toLowerCase();
    if (k === 'Escape') this.finishTransform(false);
    else if (k === 'Enter') this.finishTransform(true);
    else if (t.kind === 'grab' && (lower === 'x' || lower === 'y' || lower === 'z')) {
      const key = e.shiftKey ? lower.toUpperCase() : lower;
      this.setConstraint(key === t.constraintKey ? '' : key);
      this.updateGrab();
    } else if (t.kind === 'rotate' && (lower === 'x' || lower === 'y' || lower === 'z')) {
      this.turn(AXIS_NAMES.indexOf(lower) as AxisIndex, e.shiftKey ? -1 : 1);
    } else if (t.kind !== 'rotate' && k === 'Backspace') t.typed = t.typed.slice(0, -1);
    else if (t.kind !== 'rotate' && k.length === 1 && /[\d./'" -]/.test(k)) t.typed += k;
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
