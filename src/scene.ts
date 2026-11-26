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
 *   other way); type an angle after the axis for any other turn (R X 15 Enter), or drag
 *   a ring in 15° steps (Ctrl for 1°)
 * - S scales the cut length with the mouse (snapping to the grid) or takes a typed
 *   length; the handles on a part's ends pull one end to meet another part
 * - the gizmo and a part's body can also be dragged directly with the mouse
 */
import * as THREE from 'three';
import { dragGesture } from './gestures';
import { axisParam, EndHandles, Gizmo, ringAngle, RotateGizmo } from './gizmo';
import {
  aabbCenter,
  bevelOf,
  hasBevel,
  hasMiter,
  miterOf,
  partAABB,
  partDims,
  rotatePartsBy,
  partSnapPoints,
  isSquare,
  pivotLabel,
  pivotPoint,
  PIVOTS,
  type PivotMode,
  unionAABB,
  withMinKept,
  AXIS_NAMES,
  UP,
  type AABB,
  type AxisIndex,
  type Part,
  type Vec3,
} from './model';
import { assemblyOffsets, lastStep, stepCount, stepTitle } from './assembly';
import { explodeOffsets, offsetAABB } from './explode';
import { fastenersOf } from './fastener';
import { buildMarkers } from './markers';
import { nearestSnap } from './measure';
import { pullEnd, scaleFactor, snapEnd, snapLength } from './scale';
import { coplanarFaces, snapWithHits, type SnapHit } from './snap';
import { stockById, type Stock } from './stock';
import type { Store } from './store';
import { fmt, parseLen } from './units';
import {
  arrayCount,
  arrayFromDrag,
  arrayFromTyped,
  arrayText,
  dominantAxis,
  sameArray,
} from './arrayDrag';
import type { ArrayParams, Quat } from './model';
import { coframedBoxes, extentAlong, localAxisDir, unionInFrame } from './frame';
import { CameraRig, Z_UP, type Projection, type ViewName } from './view/camera';
import { DimLabels } from './view/dimLabels';
import { GapReadout } from './view/gapReadout';
import { FastenMode } from './view/fastenMode';
import { toScreen } from './view/labels';
import { MeasureTool } from './view/measureTool';
import { meshSignature, partGeometry } from './view/partMesh';
import { SnapFeedback } from './view/snapFeedback';

export type { Projection, ViewName } from './view/camera';

type Constraint =
  | { kind: 'plane'; axes: AxisIndex[]; plane: THREE.Plane; ref: THREE.Vector3 }
  | { kind: 'axis'; axis: AxisIndex; dir: THREE.Vector3; ref: number };

/** What the two-pick tool does with the selection: put it mid-gap, or spread it out. */
export type BetweenMode = 'center' | 'space';

interface Transform {
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

/** `pending` and `current` are for walking the assembly steps. */
type MeshState = 'normal' | 'hover' | 'selected' | 'pending' | 'current';

const EDGE_COLORS: Record<MeshState, number> = {
  normal: 0x3a2a15,
  hover: 0xd9c08a,
  selected: 0x9fd3ff,
  pending: 0x55585e,
  current: 0xe0a94b,
};
const EMISSIVE: Record<MeshState, number> = {
  normal: 0,
  hover: 0x2a2416,
  selected: 0x1e4b73,
  pending: 0,
  current: 0x3a2e10,
};
const LABELS = ['X', 'Y', 'Z'] as const;
/** An angle as a signed turn in (-180, 180], so 270° reads as -90°. */
const signedDeg = (d: number): number => {
  const m = ((d % 360) + 360) % 360;
  return m > 180 ? m - 360 : m;
};

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
    pending: new THREE.LineBasicMaterial({
      color: EDGE_COLORS.pending,
      transparent: true,
      opacity: 0.4,
    }),
    current: new THREE.LineBasicMaterial({ color: EDGE_COLORS.current }),
  };
  private gizmo = new Gizmo();
  private rotateGizmo = new RotateGizmo();
  /** The pivot the last rotation used; the next one starts from it. */
  private pivotMode: PivotMode = 'center';
  private readonly pivotDot: THREE.Mesh;
  private endHandles = new EndHandles();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tf: Transform | null = null;
  private box: BoxSelect | null = null;
  private lastPointer: [number, number] | null = null;
  private downPos: [number, number] | null = null;
  private hoverId: number | null = null;
  /** Ctrl held while the pointer moves: a ring drag turns by the degree instead of 15°. */
  private fine = false;
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
  private readonly gapReadout: GapReadout;
  /** Alt is held: hovering another part shows the distance from the selection to it. */
  private altHeld = false;
  /** C / Shift+C: the parts picked so far to centre or space the selection between. */
  private centerPicks: number[] | null = null;
  private centerMode: BetweenMode = 'center';
  /** Told when the centre-between tool starts, ends, or picks, for the toolbar and toasts. */
  onCenterBetween:
    | ((state: 'start' | 'picked' | 'done' | 'cancel', mode: BetweenMode, axis?: AxisIndex) => void)
    | null = null;
  private readonly fastenMode: FastenMode;
  /** E: how far the view is exploded, 0..1. Parts draw displaced; the model stays put. */
  explode = 0;
  private lastExplode = 0.5;
  private offsets = new Map<number, Vec3>();
  private explodeWatchers: ((amount: number) => void)[] = [];
  /** Shift+E: walking the assembly steps; the current step, or null when not. */
  private assembly: number | null = null;
  private assemblyLast = 0;
  private assemblyWatchers: ((step: number | null) => void)[] = [];

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
    this.scene.add(
      this.partsGroup,
      this.gizmo.group,
      this.rotateGizmo.group,
      this.endHandles.group,
    );
    this.dims = new DimLabels(this.rig, this.scene);
    this.snapFx = new SnapFeedback(this.scene);
    this.measureTool = new MeasureTool(this.rig, this.scene);
    this.gapReadout = new GapReadout(this.rig, this.scene);
    this.pivotDot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true }),
    );
    this.pivotDot.renderOrder = 993;
    this.pivotDot.visible = false;
    this.scene.add(this.pivotDot);
    const alt = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || e.altKey === this.altHeld) return;
      this.altHeld = e.altKey;
      this.updateGap();
    };
    window.addEventListener('keydown', alt);
    window.addEventListener('keyup', alt);
    window.addEventListener('blur', () => {
      this.altHeld = false;
      this.updateGap();
    });
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
      if (kind === 'selection') this.updateGap();
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
  get centering(): boolean {
    return this.centerPicks !== null;
  }

  /**
   * C: centre the selection between two parts; Shift+C: space it evenly between them.
   * Click (in the view or the Parts list) the first part, then the second; the selection
   * moves along the axis the two are apart on.
   */
  beginCenterBetween(mode: BetweenMode = 'center'): void {
    if (this.tf || this.lookOnly || !this.store.selected.size) return;
    if (this.measureTool.active) this.measureTool.end();
    if (this.fastenMode.active) this.fastenMode.end();
    this.centerPicks = [];
    this.centerMode = mode;
    this.container.style.cursor = 'crosshair';
    this.onCenterBetween?.('start', mode);
  }
  endCenterBetween(): void {
    if (!this.centerPicks) return;
    this.centerPicks = null;
    this.container.style.cursor = '';
    this.onCenterBetween?.('cancel', this.centerMode);
  }
  /** One of the two parts to centre between, from the view or the Parts list. */
  pickCenterBetween(id: number): void {
    const picks = this.centerPicks;
    if (!picks || picks.includes(id) || this.store.selected.has(id)) return;
    picks.push(id);
    if (picks.length < 2) {
      this.onCenterBetween?.('picked', this.centerMode);
      return;
    }
    const axis =
      this.centerMode === 'space'
        ? this.store.spaceSelectedBetween(picks[0]!, picks[1]!)
        : this.store.centerSelectedBetween(picks[0]!, picks[1]!);
    this.centerPicks = null;
    this.container.style.cursor = '';
    this.onCenterBetween?.('done', this.centerMode, axis ?? undefined);
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
      const pending = state === 'pending';
      m = new THREE.MeshLambertMaterial({
        color: stock.color,
        emissive: EMISSIVE[state],
        transparent: pending,
        opacity: pending ? 0.25 : 1,
        depthWrite: !pending,
      });
      this.matCache.set(key, m);
    }
    return m;
  }
  private stateOf(id: number): MeshState {
    if (this.store.selected.has(id)) return 'selected';
    if (this.hoverId === id) return 'hover';
    if (this.assembly !== null) {
      const step = this.store.partById(id)?.step ?? this.assemblyLast + 1;
      if (step > this.assembly) return 'pending';
      if (step === this.assembly) return 'current';
    }
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
    const visible = this.store.visibleParts();
    this.assemblyLast = lastStep(visible);
    if (this.assembly !== null) {
      // Steps may have come or gone: keep the current one in range, or stop.
      const n = stepCount(visible);
      const k = n === 0 ? null : Math.min(this.assembly, n);
      if (k !== this.assembly) {
        this.assembly = k;
        for (const w of this.assemblyWatchers) w(k);
      }
    }
    const rootOf = (p: Part) => this.store.rootGroupOf(p.id)?.id;
    this.offsets =
      this.assembly !== null
        ? assemblyOffsets(visible, rootOf, this.assembly)
        : this.explode
          ? explodeOffsets(visible, rootOf, this.explode)
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
    this.updateGap();
  }

  /** With Alt held, the distance from the selection to the hovered part. */
  private updateGap(): void {
    const p = this.hoverId === null ? undefined : this.store.partById(this.hoverId);
    const sel = this.store.selectedParts();
    if (!this.altHeld || !p || !sel.length || this.store.selected.has(p.id) || this.tf) {
      this.gapReadout.hide();
      return;
    }
    this.gapReadout.show(this.displayBounds(sel), this.displayAABB(p));
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
    this.gizmo.update(rotating || this.lookOnly ? null : center, vh, this.gizmoFrame());
    const t = this.tf;
    const pivot = rotating && t ? this.pivotOf(t) : null;
    this.rotateGizmo.update(pivot, vh);
    this.pivotDot.visible = !!pivot && t?.pivot !== 'center';
    if (pivot) {
      this.pivotDot.position.copy(pivot);
      const r = vh * 0.012;
      this.pivotDot.scale.set(r, r, r);
    }
    const one = this.store.selectedParts();
    this.endHandles.update(
      one.length === 1 &&
        !this.tf &&
        !this.lookOnly &&
        !this.measureTool.active &&
        !this.fastenMode.active
        ? one[0]!
        : null,
      vh,
    );
    this.scaleMarkers();
    this.snapFx.tick();
    this.renderer.render(this.scene, this.rig.camera);
    this.updateLabels();
    this.dims.update(this.store);
    this.measureTool.update();
    this.gapReadout.update();
  };

  /** The frame the gizmo draws in: a tilted first part's own; none for a square one. */
  private gizmoFrame(): Quat | undefined {
    const p = this.store.selectedParts()[0];
    return p && !isSquare(p.q) ? p.q : undefined;
  }

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
      const b = bevelOf(p);
      const miter =
        (hasMiter(p) ? ` · miter ${Math.abs(m[0])}°/${Math.abs(m[1])}°` : '') +
        (hasBevel(p) ? ` · bevel ${Math.abs(b[0])}°/${Math.abs(b[1])}°` : '');
      this.labelEl.textContent = `${p.name} · ${s.name} · ${s.sheet ? fmt(p.w ?? s.sheet[0]) + ' × ' : ''}${fmt(p.len)}${miter}`;
    } else this.labelEl.style.display = 'none';

    const t = this.tf;
    if (t && c && (t.moved || t.modal)) {
      const [x, y] = toScreen(this.rig, c);
      this.dragLabelEl.style.display = 'block';
      this.dragLabelEl.style.left = `${x}px`;
      this.dragLabelEl.style.top = `${y}px`;
      this.dragLabelEl.textContent = this.transformText(t);
    } else if (this.centerPicks && c) {
      const [x, y] = toScreen(this.rig, c);
      this.dragLabelEl.style.display = 'block';
      this.dragLabelEl.style.left = `${x}px`;
      this.dragLabelEl.style.top = `${y}px`;
      const what = this.centerMode === 'space' ? 'Space evenly between' : 'Center between';
      this.dragLabelEl.textContent = this.centerPicks.length
        ? `${what}: now click the second part · Esc`
        : `${what}: click the first part · Esc`;
    } else this.dragLabelEl.style.display = 'none';
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
      const list = this.store.selectedParts();
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

  // ---- dimensions, measuring, fasteners ----
  /** The view is look-only while exploded or walking the steps: clicks select, nothing edits. */
  private get lookOnly(): boolean {
    return this.explode > 0 || this.assembly !== null;
  }
  /** Back to the plain view: collapse the exploded view and stop stepping. */
  private collapseAll(): void {
    if (this.explode) this.setExplode(0);
    this.endAssembly();
  }
  /** D: dimension labels on every part and extents around the selection. */
  toggleDims(): void {
    if (!this.dims.on) this.collapseAll();
    this.dims.toggle();
  }
  /** M: measure between two clicked points, snapping to part corners, edges and faces. */
  toggleMeasure(): void {
    this.collapseAll();
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
    this.collapseAll();
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
      this.endAssembly();
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
  // ---- assembly steps ----
  /** The step being shown, or null when not walking the steps. */
  get assemblyStep(): number | null {
    return this.assembly;
  }
  /** Shift+E: walk the assembly steps from the first, or stop. */
  toggleAssembly(): void {
    if (this.assembly !== null) this.endAssembly();
    else this.setAssemblyStep(1);
  }
  /**
   * Show step `k`: parts up to it in place, the parts of the step lit, the rest pulled
   * away and faded. Look-only like the exploded view, and starting it ends the other
   * tools.
   */
  setAssemblyStep(k: number): void {
    const n = stepCount(this.store.visibleParts());
    if (n === 0) return;
    const step = Math.max(1, Math.min(n, Math.round(k)));
    if (this.assembly === null) {
      if (this.tf) this.finishTransform(false);
      if (this.measureTool.active) this.measureTool.end();
      if (this.fastenMode.active) this.fastenMode.end();
      if (this.dims.on) this.dims.toggle();
      if (this.explode) this.setExplode(0);
    } else if (step === this.assembly) return;
    this.assembly = step;
    this.syncAll();
    for (const w of this.assemblyWatchers) w(step);
  }
  /** [ and ]: the previous or next step. */
  stepAssembly(by: number): void {
    if (this.assembly !== null) this.setAssemblyStep(this.assembly + by);
  }
  endAssembly(): void {
    if (this.assembly === null) return;
    this.assembly = null;
    this.syncAll();
    for (const w of this.assemblyWatchers) w(null);
  }
  watchAssembly(fn: (step: number | null) => void): void {
    this.assemblyWatchers.push(fn);
  }
  assemblyCount(): number {
    return stepCount(this.store.visibleParts());
  }
  /** The bar's text for the step being shown. */
  assemblyTitle(): string {
    return this.assembly === null ? '' : stepTitle(this.store.visibleParts(), this.assembly);
  }

  private offsetOf(id: number): Vec3 {
    return this.offsets.get(id) ?? [0, 0, 0];
  }
  /** A part's bounds as drawn: shifted while the view is exploded. */
  private displayAABB(p: Part): AABB {
    return this.lookOnly ? offsetAABB(p, this.offsetOf(p.id)) : partAABB(p);
  }
  private displayBounds(parts: readonly Part[]): AABB {
    if (!this.lookOnly) return unionAABB(parts);
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
      return nearestSnap(partSnapPoints(p), at, tol) ?? at;
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
    if (this.lookOnly) return null; // look-only while exploded or stepping
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
      frame: list[0]!.q,
      local: false,
      along: 0,
      frameSnap: null,
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
      angles: [0, 0, 0],
      rotAxis: null,
      pivot: this.pivotMode,
      size: null,
      array: null,
    };
    if (modal) this.container.style.cursor = kind === 'rotate' ? '' : 'move';
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
    rotatePartsBy(this.store.selectedParts(), AXIS_NAMES[axis]!, deg, pivot);
    t.angles[axis] = (((t.angles[axis] + deg) % 360) + 360) % 360;
    t.rotAxis = axis;
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
    // Snap the drag to 15° steps, or single degrees with Ctrl held.
    const step = this.fine ? 1 : 15;
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

  /** B from the menu: the app's block-between action, wired by main. */
  onBlockBetween: (() => void) | null = null;
  blockBetween(): void {
    this.onBlockBetween?.();
  }

  /**
   * Shift+R: array the selection by dragging. Copies fill toward the pointer at the
   * given spacing (16" on centre unless told otherwise), X / Y / Z lock the axis, a typed
   * number is a count and a typed length a span; Enter or a click keeps it as a live
   * array. On an existing array, the drag re-fits it from its source cell.
   */
  beginArray(base: Partial<ArrayParams> = {}): void {
    if (this.tf) return;
    const g = this.store.selectedGroup();
    if (g?.array) this.store.select(this.store.arraySource(g).map((p) => p.id));
    const t = this.startTransform('array', true);
    if (!t) return;
    const { axis, mode, spacing, reverse } = { ...g?.array, ...base };
    const params: ArrayParams = {
      axis: axis ?? 'x',
      mode: mode ?? 'center',
      spacing: spacing ?? 16,
    };
    if (reverse) params.reverse = true;
    const size = t.aabb.max.map((v, i) => v - t.aabb.min[i]!) as Vec3;
    const cell = this.store.selectedParts();
    const extentLocal = ([0, 1, 2] as AxisIndex[]).map((a) =>
      extentAlong(cell, localAxisDir(t.frame, a)),
    ) as Vec3;
    t.array = { base: params, extent: size, applied: null, distance: 0, axis: 0, extentLocal };
    this.store.beginCoalesce();
    this.setConstraint('');
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
  /** S: the length follows the mouse (Blender's scale) or a typed length; Enter confirms. */
  beginSize(): void {
    if (this.tf) return;
    const t = this.startTransform('size', true);
    if (!t) return;
    const r = this.container.getBoundingClientRect();
    const [px, py] = toScreen(this.rig, t.origin);
    const pivot: [number, number] = [px + r.left, py + r.top];
    t.size = {
      startLens: this.store.selectedParts().map((p) => p.len),
      pivot,
      start: this.lastPointer ?? pivot,
      end: 0,
      dir: new THREE.Vector3(1, 0, 0),
      at: t.origin.clone(),
      ref: 0,
      faceAxis: null,
      faceAt: 0,
    };
  }

  /** Drag on an end handle: pull that end of the one selected part, the other end fixed. */
  private beginEndDrag(end: 1 | -1): Transform | null {
    const p = this.store.selectedParts()[0];
    if (!p) return null;
    const t = this.startTransform('size', false);
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
      ref: axisParam(at, dir, this.currentRay()),
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
    const list = this.store.selectedParts();
    const grid = this.store.settings.grid;
    t.snaps = [];
    if (sz.end === 0) {
      const f = scaleFactor(sz.pivot, sz.start, this.lastPointer ?? sz.start);
      list.forEach((p, i) =>
        withMinKept(p, () => (p.len = snapLength(sz.startLens[i]! * f, grid))),
      );
      this.snapFx.hide();
    } else {
      const p = list[0];
      if (!p) return;
      const start = sz.startLens[0]!;
      let delta = axisParam(sz.at, sz.dir, this.currentRay()) - sz.ref;
      if (sz.faceAxis !== null) {
        // A square part: the moving end face snaps to other faces (or the grid) along its axis.
        const a = sz.faceAxis;
        const sign = sz.dir.getComponent(a) < 0 ? -1 : 1;
        const slab: AABB = { min: [...t.aabb.min], max: [...t.aabb.max] };
        slab.min[a] = slab.max[a] = sz.faceAt;
        const r = snapEnd(slab, a, delta * sign, t.others, this.store.settings);
        delta = r.delta * sign;
        t.snaps = r.hits;
        this.snapFx.show(r.hits, r.moved, t.others);
      } else delta = (snapLength(start + sz.end * delta, grid) - start) * sz.end;
      const { len, shift } = pullEnd(start, sz.end, delta);
      p.len = len;
      const sp = t.startPos[0]!;
      p.pos = [sp[0] + sz.dir.x * shift, sp[1] + sz.dir.y * shift, sp[2] + sz.dir.z * shift];
    }
    t.moved = true;
    for (const p of list) this.syncMesh(p);
    this.store.notify('drag');
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
  private setConstraint(key: string, local = false): void {
    const t = this.tf;
    if (t?.kind !== 'grab' && t?.kind !== 'array') return;
    const ray = this.currentRay();
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
    const ray = this.currentRay();
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
      this.snapFx.hide();
      return;
    }
    t.snaps = snapWithHits(t.aabb, raw, axes, t.others, this.store.settings).hits;
    this.applyDelta(raw);
    const moved: AABB = {
      min: [t.aabb.min[0] + t.delta[0], t.aabb.min[1] + t.delta[1], t.aabb.min[2] + t.delta[2]],
      max: [t.aabb.max[0] + t.delta[0], t.aabb.max[1] + t.delta[1], t.aabb.max[2] + t.delta[2]],
    };
    this.snapFx.show(t.snaps, moved, t.others);
  }

  /**
   * Snap a move of `along` on local `axis` to the faces of co-framed parts, in the frame
   * of the first selected part. Sets `t.snaps` for the readout; returns the snapped move.
   */
  private snapAlong(t: Transform, axis: AxisIndex, along: number): number {
    if (!t.frameSnap) {
      const list = this.store.selectedParts();
      const start = list.map((p, i) => ({ ...p, pos: t.startPos[i]! }));
      const others = this.store.parts.filter((p) => !t.ids.has(p.id) && !p.hidden);
      t.frameSnap = { ...coframedBoxes(others, t.frame), mine: unionInFrame(start, t.frame) };
    }
    const d: Vec3 = [0, 0, 0];
    d[axis] = along;
    const { boxes } = t.frameSnap;
    t.snaps = snapWithHits(t.frameSnap.mine, d, [axis], boxes, {
      ...this.store.settings,
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
      this.snapFx.hide();
      ad.axis = axis;
      ad.distance = t.along;
      const base: ArrayParams = { ...ad.base, local: true };
      const params = arrayFromDrag(base, AXIS_NAMES[axis]!, ad.extentLocal[axis], t.along, false);
      if (!sameArray(params, ad.applied)) {
        ad.applied = params;
        this.store.setArray(params);
      }
      return;
    }
    const axis = axes.length === 1 ? axes[0]! : dominantAxis(raw, axes);
    const d: Vec3 = [0, 0, 0];
    d[axis] = raw[axis];
    t.snaps = snapWithHits(t.aabb, d, [axis], t.others, this.store.settings).hits;
    t.delta = d;
    ad.axis = axis;
    ad.distance = d[axis];
    const params = arrayFromDrag(ad.base, AXIS_NAMES[axis]!, ad.extent[axis], d[axis], false);
    if (!sameArray(params, ad.applied)) {
      ad.applied = params;
      this.store.setArray(params);
    }
    const moved: AABB = {
      min: [t.aabb.min[0] + d[0], t.aabb.min[1] + d[1], t.aabb.min[2] + d[2]],
      max: [t.aabb.max[0] + d[0], t.aabb.max[1] + d[1], t.aabb.max[2] + d[2]],
    };
    this.snapFx.show(t.snaps, moved, t.others);
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
      this.store.setArray(params);
      this.store.endCoalesce();
    } else {
      this.store.restore(t.before);
      this.store.cancelCoalesce();
    }
  }

  private finishTransform(commit: boolean): void {
    const t = this.tf;
    if (!t) return;
    if (t.kind === 'array') {
      this.finishArray(t, commit);
      this.rig.enabled = true;
      this.container.style.cursor = '';
      this.tf = null;
      this.snapFx.hide();
      return;
    }
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
          for (const p of this.store.selectedParts()) withMinKept(p, () => (p.len = v));
          t.moved = true;
        } else commit = false;
      } else commit = t.moved && t.size !== null;
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
    if (this.centerPicks) {
      if (e.button === 2) {
        this.suppressMenu = true;
        this.endCenterBetween();
        return;
      }
      if (e.button !== 0) return;
      this.setRay(e.clientX, e.clientY);
      const hit = this.pickPart();
      if (hit) this.pickCenterBetween(hit.object.userData.id as number);
      return;
    }
    if (e.button !== 0) return;
    this.downPos = [e.clientX, e.clientY];
    this.setRay(e.clientX, e.clientY);

    // End handles, then gizmo handles, win over parts.
    const eh = this.lookOnly ? null : this.endHandles.pick(this.ray);
    if (eh) {
      if (this.beginEndDrag(eh.end)) this.capture(e);
      return;
    }
    const gh = this.lookOnly ? null : this.gizmo.pick(this.ray);
    const center = this.selectionCenter();
    if (gh && center) {
      const t = this.startTransform('grab', false);
      if (!t) return;
      const local = this.gizmoFrame() !== undefined;
      if (gh.handle.kind === 'axis') this.setConstraint(AXIS_NAMES[gh.handle.axis]!, local);
      else
        this.setConstraint(
          AXIS_NAMES[3 - gh.handle.axes[0] - gh.handle.axes[1]]!.toUpperCase(),
          local,
        );
      this.capture(e);
      return;
    }

    const hit = this.pickPart();
    if (hit) {
      const id = hit.object.userData.id as number;
      // A click takes the whole assembly; a double-click (below) narrows to the one part.
      // Shift+click extends by the same rule; Ctrl+click toggles just the part under it.
      if (e.ctrlKey || e.metaKey) {
        this.store.toggleSelect(id);
        return;
      }
      if (e.shiftKey) {
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
    this.fine = e.ctrlKey || e.metaKey;
    if (e.altKey !== this.altHeld) {
      this.altHeld = e.altKey;
      this.updateGap();
    }
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
      if (t.kind === 'size') {
        this.updateSize();
        return;
      }
      if (t.kind !== 'grab' && t.kind !== 'array') return;
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
    const eh = this.lookOnly ? null : this.endHandles.pick(this.ray);
    this.endHandles.setHover(eh?.object ?? null);
    const gh = eh || this.lookOnly ? null : this.gizmo.pick(this.ray);
    this.gizmo.setHover(gh?.object ?? null);
    const hit = eh || gh ? null : this.pickPart();
    this.setHover(hit ? (hit.object.userData.id as number) : null);
    this.container.style.cursor = eh ? 'ew-resize' : gh ? 'move' : hit ? 'grab' : '';
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
