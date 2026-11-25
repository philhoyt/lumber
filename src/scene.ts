/**
 * The 3D view: renders parts as boxes, handles picking, dragging and the Blender-style
 * modal transforms, and keeps the meshes in step with the store. All model changes
 * still go through the store.
 *
 * The scene owns the interaction; the pieces around it live in `view/`: the camera rig
 * (projections, views, orbit gestures), snap feedback, dimension labels, the measure
 * tool, fastener placing and part geometry. The scene forwards the camera rig's API so
 * the panels have one handle.
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
import { dragGesture } from './gestures';
import { axisParam, Gizmo, ringAngle, RotateGizmo } from './gizmo';
import {
  aabbCenter,
  hasMiter,
  miterOf,
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
import { explodeOffsets, offsetAABB } from './explode';
import { fastenersOf } from './fastener';
import { buildMarkers } from './markers';
import { nearestSnap, snapPoints } from './measure';
import { coplanarFaces, snapWithHits, type SnapHit } from './snap';
import { stockById, type Stock } from './stock';
import type { Store } from './store';
import { fmt, parseLen } from './units';
import { CameraRig, Z_UP, type Projection, type ViewName } from './view/camera';
import { DimLabels } from './view/dimLabels';
import { FastenMode } from './view/fastenMode';
import { toScreen } from './view/labels';
import { MeasureTool } from './view/measureTool';
import { meshSignature, partGeometry } from './view/partMesh';
import { SnapFeedback } from './view/snapFeedback';

export type { Projection, ViewName } from './view/camera';

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

/** What a right click landed on. */
export interface MenuContext {
  x: number;
  y: number;
  partId: number | null;
  ground: Vec3 | null;
}

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

export class LumberScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  /** Cameras, orbit controls, views and gestures. */
  readonly rig: CameraRig;
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
  private grids: THREE.GridHelper[] = [];
  private rightDown: [number, number] | null = null;
  private suppressMenu = false;
  /** Set by the app to open the right-click menu. */
  onContextMenuRequest: ((ctx: MenuContext) => void) | null = null;
  private labelEl: HTMLElement;
  private dragLabelEl: HTMLElement;
  private boxEl: HTMLElement;
  private readonly dims: DimLabels;
  private readonly snapFx: SnapFeedback;
  private readonly measureTool: MeasureTool;
  private readonly fastenMode: FastenMode;
  /** E: how far the view is exploded, 0..1. Parts draw displaced; the model stays put. */
  explode = 0;
  private lastExplode = 0.5;
  private offsets = new Map<number, Vec3>();
  private explodeWatchers: ((amount: number) => void)[] = [];

  constructor(
    private container: HTMLElement,
    private store: Store,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(container, this.renderer.domElement, (name) => this.boundsFor(name));
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'part-label';
    this.dragLabelEl = document.createElement('div');
    this.dragLabelEl.className = 'drag-label';
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'box-select';
    container.append(this.labelEl, this.dragLabelEl, this.boxEl);

    this.scene.background = new THREE.Color(0x202226);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a74, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(60, -40, 120);
    this.scene.add(sun);
    // The floor grid is translucent so the model still reads when viewed from below.
    const minor = new THREE.GridHelper(240, 240, 0x33363b, 0x2a2d31);
    const major = new THREE.GridHelper(240, 20, 0x4a4e55, 0x4a4e55);
    this.grids = [minor, major];
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
    this.dims = new DimLabels(this.rig, this.scene);
    this.snapFx = new SnapFeedback(this.scene);
    this.measureTool = new MeasureTool(this.rig, this.scene);
    this.fastenMode = new FastenMode(this.scene, container, store, {
      pick: (x, y) => {
        this.setRay(x, y);
        return this.pickPart();
      },
      ray: this.ray,
      meshOf: (id) => this.meshes.get(id),
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    el.addEventListener('pointerleave', () => this.setHover(null));
    el.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    el.addEventListener('dblclick', (e) => {
      if (this.tf) return;
      this.setRay(e.clientX, e.clientY);
      const hit = this.pickPart();
      if (hit) this.store.select([hit.object.userData.id as number]);
    });
    // Keys during a transform take priority over the app's shortcuts.
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { capture: true });

    store.subscribe((kind) => {
      if (kind === 'model' || kind === 'selection') this.syncAll();
    });
    this.syncAll();
    this.animate();
  }

  /** Match the page theme: background and grid colors. */
  setTheme(theme: 'dark' | 'light'): void {
    const dark = theme === 'dark';
    this.scene.background = new THREE.Color(dark ? 0x202226 : 0xe4e2dc);
    const [minor, major] = this.grids;
    const set = (g: THREE.GridHelper | undefined, c1: number, c2: number) => {
      if (!g) return;
      const colors = g.geometry.getAttribute('color') as THREE.BufferAttribute;
      const a = new THREE.Color(c1);
      const b = new THREE.Color(c2);
      // GridHelper colors its centre lines with c1 and the rest with c2, two vertices per line.
      const n = colors.count;
      for (let i = 0; i < n; i++) {
        const centre = i < 4 || (i >= n / 2 && i < n / 2 + 4);
        const c = centre ? a : b;
        colors.setXYZ(i, c.r, c.g, c.b);
      }
      colors.needsUpdate = true;
    };
    set(minor, dark ? 0x33363b : 0xc9c6bd, dark ? 0x2a2d31 : 0xd3d0c8);
    set(major, dark ? 0x4a4e55 : 0xb5b1a7, dark ? 0x4a4e55 : 0xb5b1a7);
  }

  get measuring(): boolean {
    return this.measureTool.active;
  }
  get fastening(): boolean {
    return this.fastenMode.active;
  }
  get transforming(): boolean {
    return this.tf !== null;
  }
  get showDims(): boolean {
    return this.dims.on;
  }

  // ---- the camera rig's API, forwarded ----
  get projection(): Projection {
    return this.rig.projection;
  }
  get onProjectionChange(): ((mode: Projection) => void) | null {
    return this.rig.onProjectionChange;
  }
  set onProjectionChange(fn: ((mode: Projection) => void) | null) {
    this.rig.onProjectionChange = fn;
  }
  setProjection(mode: Projection, fromAxis = false): void {
    this.rig.setProjection(mode, fromAxis);
  }
  toggleProjection(): void {
    this.rig.toggleProjection();
  }
  watchCamera(fn: () => void): void {
    this.rig.watchCamera(fn);
  }
  cameraAxes(): [Vec3, Vec3, Vec3] {
    return this.rig.cameraAxes();
  }
  viewDir(): Vec3 {
    return this.rig.viewDir();
  }
  setView(name: ViewName): void {
    this.rig.setView(name);
  }
  orbitStep(az: number, el: number): void {
    this.rig.orbitStep(az, el);
  }
  orbitFree(az: number, el: number): void {
    this.rig.orbitFree(az, el);
  }
  flipView(): void {
    this.rig.flipView();
  }
  zoomStep(inward: boolean): void {
    this.rig.zoomStep(inward);
  }
  panStep(dx: number, dy: number): void {
    this.rig.panStep(dx, dy);
  }
  panPixels(dx: number, dy: number): void {
    this.rig.panPixels(dx, dy);
  }
  dolly(scale: number): void {
    this.rig.dolly(scale);
  }
  get trackpad(): boolean {
    return this.rig.trackpad;
  }
  setTrackpad(on: boolean): void {
    this.rig.setTrackpad(on);
  }
  /** What a named view should frame: the selection for `selected`, else everything visible. */
  private boundsFor(name: ViewName): AABB {
    const parts =
      name === 'selected' && this.store.selected.size
        ? this.store.selectedParts()
        : this.store.visibleParts();
    return parts.length ? this.displayBounds(parts) : { min: [-24, -24, 0], max: [24, 24, 24] };
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
    const geo = partGeometry(p, d);
    const mesh = new THREE.Mesh(geo, this.materialFor(stockById(p.stock), 'normal'));
    mesh.userData.id = p.id;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeMats.normal);
    g.add(mesh, edges, buildMarkers(fastenersOf(p), d));
    g.userData.id = p.id;
    g.userData.sig = meshSignature(p, d);
    return g;
  }
  private disposeGroup(g: THREE.Group): void {
    this.partsGroup.remove(g);
    for (const c of g.children) (c as Partial<THREE.Mesh>).geometry?.dispose(); // markers share theirs
  }
  private syncMesh(p: Part): void {
    let g = this.meshes.get(p.id);
    const d = partDims(p);
    const sig = meshSignature(p, d);
    if (g?.userData.sig !== sig) {
      if (g) this.disposeGroup(g);
      g = this.buildMesh(p);
      this.partsGroup.add(g);
      this.meshes.set(p.id, g);
    }
    const o = this.offsetOf(p.id);
    g.position.set(p.pos[0] + o[0], p.pos[1] + o[1], p.pos[2] + o[2]);
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
    this.offsets = this.explode
      ? explodeOffsets(
          this.store.visibleParts(),
          (p) => this.store.rootGroupOf(p.id)?.id,
          this.explode,
        )
      : new Map<number, Vec3>();
    const live = new Set(this.store.parts.map((p) => p.id));
    for (const [id, g] of this.meshes)
      if (!live.has(id)) {
        this.disposeGroup(g);
        this.meshes.delete(id);
      }
    for (const p of this.store.parts) this.syncMesh(p);
  }
  /** Highlight a part from outside the view, for example from the outliner. */
  hover(id: number | null): void {
    this.setHover(id);
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
  /** Markers are real size, but never shrink below a few pixels on screen. */
  private scaleMarkers(): void {
    const minScale = (at: THREE.Vector3) => Math.max(1, (this.rig.viewHeightAt(at) * 0.016) / 0.44);
    for (const g of this.meshes.values()) {
      const markers = g.children[2];
      if (!g.visible || !markers?.children.length) continue;
      const s = minScale(g.position);
      for (const m of markers.children) m.scale.setScalar(s);
    }
    this.fastenMode.scaleGhost(minScale);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.rig.tick();
    const center = this.selectionCenter();
    const rotating = this.tf?.kind === 'rotate';
    const vh = center ? this.rig.viewHeightAt(center) : 0;
    this.gizmo.update(rotating || this.explode ? null : center, vh);
    this.rotateGizmo.update(rotating ? center : null, vh);
    this.scaleMarkers();
    this.snapFx.tick();
    this.renderer.render(this.scene, this.rig.camera);
    this.updateLabels();
    this.dims.update(this.store);
    this.measureTool.update();
  };

  private selectionCenter(): THREE.Vector3 | null {
    const list = this.store.selectedParts();
    if (!list.length) return null;
    return new THREE.Vector3().fromArray(aabbCenter(this.displayBounds(list)));
  }

  private updateLabels(): void {
    const { selected } = this.store;
    const p = selected.size === 1 ? this.store.partById([...selected][0]!) : undefined;
    const c = this.selectionCenter();
    if (p && c) {
      // Sit the label above the gizmo's up arrow so the two never overlap.
      const [x, y] = toScreen(this.rig, c.clone().setZ(c.z + this.gizmo.group.scale.z * 1.15));
      this.labelEl.style.display = 'block';
      this.labelEl.style.left = `${x}px`;
      this.labelEl.style.top = `${y}px`;
      const s = stockById(p.stock);
      const m = miterOf(p);
      const miter = hasMiter(p) ? ` · ${Math.abs(m[0])}°/${Math.abs(m[1])}°` : '';
      this.labelEl.textContent = `${p.name} · ${s.name} · ${s.sheet ? fmt(p.w ?? s.sheet[0]) + ' × ' : ''}${fmt(p.len)}${miter}`;
    } else this.labelEl.style.display = 'none';

    const t = this.tf;
    if (t && c && (t.moved || t.modal)) {
      const [x, y] = toScreen(this.rig, c);
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
    // Group the targets by relation: "against Leg LF, Leg RF · flush with Apron left".
    const byRelation = new Map<string, string[]>();
    for (const h of t.snaps) {
      if (h.kind === 'grid') continue;
      const pairs =
        h.kind === 'floor'
          ? [['on the floor', '']]
          : coplanarFaces(h, t.others).map((f) => [
              h.mine === f.side ? 'flush with' : 'against',
              t.otherNames[f.other] ?? 'a part',
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
    return (
      plane +
      axes.map((a) => `${LABELS[a]} ${t.delta[a] >= 0 ? '+' : ''}${fmt(t.delta[a])}`).join('  ') +
      (targets ? `  · ${targets}` : '')
    );
  }

  // ---- dimensions, measuring, fasteners ----
  /** D: dimension labels on every part and extents around the selection. */
  toggleDims(): void {
    if (this.explode && !this.dims.on) this.setExplode(0);
    this.dims.toggle();
  }
  /** M: measure between two clicked points, snapping to part corners, edges and faces. */
  toggleMeasure(): void {
    if (this.explode) this.setExplode(0);
    if (this.measureTool.active) this.measureTool.end();
    else this.measureTool.start();
  }
  endMeasure(): void {
    this.measureTool.end();
  }
  get onMeasureChange(): ((on: boolean) => void) | null {
    return this.measureTool.onChange;
  }
  set onMeasureChange(fn: ((on: boolean) => void) | null) {
    this.measureTool.onChange = fn;
  }
  /** F: click a face to add a marker there, click a marker to take it away. */
  toggleFasten(): void {
    if (this.explode) this.setExplode(0);
    if (this.fastenMode.active) this.fastenMode.end();
    else {
      if (this.measureTool.active) this.measureTool.end();
      this.fastenMode.start();
    }
  }
  endFasten(): void {
    this.fastenMode.end();
  }
  /** Be told when fastener placing starts and stops (toolbar, the bar over the view). */
  watchFasten(fn: (on: boolean) => void): void {
    this.fastenMode.watch(fn);
  }

  // ---- exploded view ----
  get exploded(): boolean {
    return this.explode > 0;
  }
  /**
   * Pull the parts apart (0..1) to see how they go together. The view is look-only while
   * exploded: clicks select, but transforms, measuring, marking and dimensions wait until
   * it collapses, and starting any of them collapses it.
   */
  setExplode(amount: number): void {
    const v = Math.max(0, Math.min(1, amount)) || 0;
    if (v === this.explode) return;
    if (v > 0) {
      if (this.tf) this.finishTransform(false);
      if (this.measureTool.active) this.measureTool.end();
      if (this.fastenMode.active) this.fastenMode.end();
      if (this.dims.on) this.dims.toggle();
      this.lastExplode = v;
    }
    this.explode = v;
    this.syncAll();
    for (const w of this.explodeWatchers) w(v);
  }
  /** E: explode to the last amount, or collapse. */
  toggleExplode(): void {
    this.setExplode(this.explode > 0 ? 0 : this.lastExplode);
  }
  watchExplode(fn: (amount: number) => void): void {
    this.explodeWatchers.push(fn);
  }
  private offsetOf(id: number): Vec3 {
    return this.offsets.get(id) ?? [0, 0, 0];
  }
  /** A part's bounds as drawn: shifted while the view is exploded. */
  private displayAABB(p: Part): AABB {
    return this.explode ? offsetAABB(p, this.offsetOf(p.id)) : partAABB(p);
  }
  private displayBounds(parts: readonly Part[]): AABB {
    if (!this.explode) return unionAABB(parts);
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) {
      const b = this.displayAABB(p);
      for (const a of [0, 1, 2] as const) {
        min[a] = Math.min(min[a], b.min[a]);
        max[a] = Math.max(max[a], b.max[a]);
      }
    }
    return { min, max };
  }

  // ---- picking ----
  private setRay(clientX: number, clientY: number): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.rig.camera);
  }
  private pickPart(): THREE.Intersection | null {
    const meshes = this.partsGroup.children.filter((g) => g.visible).map((g) => g.children[0]!);
    return this.ray.intersectObjects(meshes, false)[0] ?? null;
  }
  /** The point under the pointer: a snap point on the part it hits, else the hit, else the floor. */
  private snapUnderPointer(clientX: number, clientY: number): Vec3 | null {
    this.setRay(clientX, clientY);
    const hit = this.pickPart();
    if (hit) {
      const p = this.store.partById(hit.object.userData.id as number);
      const at: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
      if (!p) return at;
      const tol = this.rig.viewHeightAt(hit.point) * 0.025;
      return nearestSnap(snapPoints(partAABB(p)), at, tol) ?? at;
    }
    const g = this.groundPoint(clientX, clientY);
    if (!g) return null;
    const grid = this.store.settings.grid;
    const snap = (v: number) => (grid ? Math.round(v / grid) * grid : v);
    return [snap(g[0]), snap(g[1]), 0];
  }
  /**
   * A right click that did not pan and did not cancel a transform: select what is under
   * the pointer and hand the context to whoever draws the menu.
   */
  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.suppressMenu) {
      this.suppressMenu = false;
      return;
    }
    const d = this.rightDown;
    this.rightDown = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 3) return;
    this.setRay(e.clientX, e.clientY);
    const hit = this.pickPart();
    const partId = hit ? (hit.object.userData.id as number) : null;
    if (partId !== null && !this.store.selected.has(partId)) this.store.select([partId]);
    this.onContextMenuRequest?.({
      x: e.clientX,
      y: e.clientY,
      partId,
      ground: this.groundPoint(e.clientX, e.clientY),
    });
  }
  /** Where the pointer was last seen, for menus opened from the keyboard. */
  pointerPosition(): [number, number] {
    if (this.lastPointer) return this.lastPointer;
    const r = this.container.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
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
    if (this.explode) return null; // look-only while exploded
    const list = this.store.selectedParts();
    if (!list.length) return null;
    const ids = new Set(list.map((p) => p.id));
    const aabb = unionAABB(list);
    this.rig.enabled = false;
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
      otherNames: this.store.parts.filter((p) => !ids.has(p.id) && !p.hidden).map((p) => p.name),
      snaps: [],
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
    if (t?.kind !== 'rotate' || !turns) return;
    rotateParts(this.store.selectedParts(), AXIS_NAMES[axis]!, turns);
    t.turns[axis] = (((t.turns[axis] + turns) % 4) + 4) % 4;
    t.moved = true;
    this.syncAll();
    this.store.notify('drag');
  }

  private beginRingDrag(axis: AxisIndex): void {
    const t = this.tf;
    if (t?.kind !== 'rotate') return;
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
    if (t?.kind !== 'grab') return;
    const ray = this.currentRay();
    const delta = new THREE.Vector3().fromArray(t.delta);
    if (key !== '' && key === key.toLowerCase()) {
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
    if (t?.kind !== 'grab' || !t.moved || !t.constraint) return;
    const raw = this.rawDelta(t);
    if (!raw) return;
    const axes = t.constraint.kind === 'axis' ? [t.constraint.axis] : t.constraint.axes;
    t.snaps = snapWithHits(t.aabb, raw, axes, t.others, this.store.settings).hits;
    this.applyDelta(raw);
    const moved: AABB = {
      min: [t.aabb.min[0] + t.delta[0], t.aabb.min[1] + t.delta[1], t.aabb.min[2] + t.delta[2]],
      max: [t.aabb.max[0] + t.delta[0], t.aabb.max[1] + t.delta[1], t.aabb.max[2] + t.delta[2]],
    };
    this.snapFx.show(t.snaps, moved, t.others);
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
    this.rig.enabled = true;
    this.container.style.cursor = '';
    this.tf = null;
    this.snapFx.hide();
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
    if (dragGesture(e)) return; // Alt+left-drag: the orbit controls have it
    if (e.button === 2) {
      this.rightDown = [e.clientX, e.clientY];
      if (this.tf?.modal) this.suppressMenu = true; // this right click cancels, no menu
    }
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
    if (this.fastenMode.active) {
      if (e.button === 2) {
        this.suppressMenu = true;
        this.fastenMode.end();
        return;
      }
      if (e.button === 0) this.fastenMode.click(e.clientX, e.clientY);
      return;
    }
    if (this.measureTool.active) {
      if (e.button === 2) {
        this.suppressMenu = true;
        this.measureTool.end();
        return;
      }
      if (e.button !== 0) return;
      const pt = this.snapUnderPointer(e.clientX, e.clientY);
      if (pt) this.measureTool.click(pt);
      return;
    }
    if (e.button !== 0) return;
    this.downPos = [e.clientX, e.clientY];
    this.setRay(e.clientX, e.clientY);

    // Gizmo handles win over parts.
    const gh = this.explode ? null : this.gizmo.pick(this.ray);
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
      // A click takes the whole assembly; a double-click (below) narrows to the one part.
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        this.store.toggleSelectMany(this.store.selectionForClick(id));
        return;
      }
      if (!this.store.selected.has(id)) this.store.select(this.store.selectionForClick(id));
      const t = this.startTransform('grab', false);
      if (!t) return; // nothing selected, or the view is exploded
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
    if (this.fastenMode.active) {
      this.fastenMode.updateGhost(e.clientX, e.clientY);
      const hit = this.pickPart();
      this.setHover(hit ? (hit.object.userData.id as number) : null);
      return;
    }
    if (this.measureTool.active) {
      this.measureTool.hover(this.snapUnderPointer(e.clientX, e.clientY));
      return;
    }
    this.setRay(e.clientX, e.clientY);
    const gh = this.explode ? null : this.gizmo.pick(this.ray);
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
      const [x, y] = toScreen(
        this.rig,
        new THREE.Vector3().fromArray(aabbCenter(this.displayAABB(p))),
      );
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
    else if (t.kind !== 'rotate' && k.length === 1 && /[\d./'" +*()-]/.test(k)) t.typed += k;
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
