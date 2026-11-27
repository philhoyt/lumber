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
import { EndHandles, Gizmo, RotateGizmo } from './gizmo';
import {
  aabbCenter,
  bevelOf,
  edgeBevelOf,
  hasBevel,
  hasEdgeBevel,
  hasMiter,
  miterOf,
  partAABB,
  partDims,
  partSizeText,
  unionBoxes,
  partSnapPoints,
  isSquare,
  unionAABB,
  AXIS_NAMES,
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
import { groundOnGrid } from './snap';
import { stockById, type Stock } from './stock';
import type { Store } from './store';
import { fmt } from './units';
import type { ArrayParams, Quat } from './model';
import { CameraRig, Z_UP, type ViewName } from './view/camera';
import { DimLabels } from './view/dimLabels';
import { GapReadout } from './view/gapReadout';
import { FastenMode } from './view/fastenMode';
import { toScreen } from './view/labels';
import { MeasureTool } from './view/measureTool';
import { meshSignature, partEdges, partGeometry } from './view/partMesh';
import { SnapFeedback } from './view/snapFeedback';
import { TransformController } from './view/transform';

export type { Projection, ViewName } from './view/camera';

/** What the two-pick tool does with the selection: put it mid-gap, or spread it out. */
export type BetweenMode = 'center' | 'space';

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

/** `overlap` runs into another part; `pending` and `current` are for walking the assembly steps. */
type MeshState = 'normal' | 'hover' | 'selected' | 'overlap' | 'pending' | 'current';

const EDGE_COLORS: Record<MeshState, number> = {
  normal: 0x3a2a15,
  hover: 0xd9c08a,
  selected: 0x9fd3ff,
  overlap: 0xff6b5f,
  pending: 0x55585e,
  current: 0xe0a94b,
};
const EMISSIVE: Record<MeshState, number> = {
  normal: 0,
  hover: 0x2a2416,
  selected: 0x1e4b73,
  overlap: 0x6a1c14,
  pending: 0,
  current: 0x3a2e10,
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
    overlap: new THREE.LineBasicMaterial({ color: EDGE_COLORS.overlap }),
    pending: new THREE.LineBasicMaterial({
      color: EDGE_COLORS.pending,
      transparent: true,
      opacity: 0.4,
    }),
    current: new THREE.LineBasicMaterial({ color: EDGE_COLORS.current }),
  };
  private gizmo = new Gizmo();
  private rotateGizmo = new RotateGizmo();
  private readonly pivotDot: THREE.Mesh;
  /** The grab, rotate, size or array drag in progress, if any. */
  readonly transform: TransformController;
  private endHandles = new EndHandles();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
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
    this.transform = new TransformController({
      store,
      rig: this.rig,
      container,
      snapFx: this.snapFx,
      lookOnly: () => this.lookOnly,
      lastPointer: () => this.lastPointer,
      fine: () => this.fine,
      currentRay: () => this.currentRay(),
      syncMesh: (p) => {
        this.syncMesh(p);
      },
      syncAll: () => {
        this.syncAll();
      },
      clearHover: () => {
        this.gizmo.setHover(null);
      },
    });
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
      if (this.transform.active) return;
      this.setRay(e.clientX, e.clientY);
      const hit = this.pickPart();
      if (hit) this.store.select([hit.object.userData.id as number]);
    });
    // Keys during a transform take priority over the app's shortcuts.
    window.addEventListener('keydown', (e) => this.transform.onKeyDown(e), { capture: true });

    store.subscribe((kind) => {
      // A change the transform did not make (a project load, a panel edit, a toolbar
      // button) means its starting snapshot no longer describes the model: drop it.
      if (
        this.transform.active &&
        !this.transform.applying &&
        (kind === 'model' || kind === 'selection')
      )
        this.transform.abandon();
      // 'drag' is a coalesced edit in flight (a scrub, an array drag): the view follows
      // it at once while the panels wait for the 'model' at its end.
      if (kind === 'model' || kind === 'selection' || kind === 'drag') this.syncAll();
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
    if (this.transform.active || this.lookOnly || !this.store.selected.size) return;
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
    return this.transform.active !== null;
  }
  get showDims(): boolean {
    return this.dims.on;
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
      // Reference boxes are see-through stand-ins; pending assembly steps are ghosts.
      const ghost = pending || !!stock.reference;
      m = new THREE.MeshLambertMaterial({
        color: stock.color,
        emissive: EMISSIVE[state],
        transparent: ghost,
        opacity: pending ? 0.25 : stock.reference ? 0.5 : 1,
        depthWrite: !pending,
      });
      this.matCache.set(key, m);
    }
    return m;
  }
  private stateOf(id: number): MeshState {
    if (this.store.selected.has(id)) return 'selected';
    if (this.hoverId === id) return 'hover';
    if (this.store.overlaps().ids.has(id)) return 'overlap';
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
    const edges = new THREE.LineSegments(partEdges(p, geo), this.edgeMats.normal);
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
    if (
      !this.altHeld ||
      !p ||
      !sel.length ||
      this.store.selected.has(p.id) ||
      this.transform.active
    ) {
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
    const t = this.transform.active;
    const rotating = t?.kind === 'rotate';
    const vh = center ? this.rig.viewHeightAt(center) : 0;
    this.gizmo.update(rotating || this.lookOnly ? null : center, vh, this.gizmoFrame());
    const pivot = this.transform.rotationPivot();
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
        !t &&
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
      const e = edgeBevelOf(p);
      const miter =
        (hasMiter(p) ? ` · miter ${Math.abs(m[0])}°/${Math.abs(m[1])}°` : '') +
        (hasBevel(p) ? ` · bevel ${Math.abs(b[0])}°/${Math.abs(b[1])}°` : '') +
        (hasEdgeBevel(p) ? ` · edge ${Math.abs(e[0])}°/${Math.abs(e[1])}°` : '');
      this.labelEl.textContent = `${p.name} · ${s.name} · ${partSizeText(p, fmt)}${miter}`;
    } else this.labelEl.style.display = 'none';

    const readout = this.transform.readout();
    if (readout !== null && c) {
      const [x, y] = toScreen(this.rig, c);
      this.dragLabelEl.style.display = 'block';
      this.dragLabelEl.style.left = `${x}px`;
      this.dragLabelEl.style.top = `${y}px`;
      this.dragLabelEl.textContent = readout;
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
      this.transform.finish(false);
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
      this.transform.finish(false);
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
    return this.lookOnly ? unionBoxes(parts.map((p) => this.displayAABB(p))) : unionAABB(parts);
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
    return groundOnGrid(g, this.store.settings.grid);
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

  /** B from the menu: the app's block-between action, wired by main. */
  onBlockBetween: (() => void) | null = null;
  blockBetween(): void {
    this.onBlockBetween?.();
  }

  /** G: grab the selection so it follows the pointer until confirmed. */
  beginGrab(): void {
    this.transform.beginGrab();
  }
  /** R: wait for an axis key, then turn the selection a quarter turn about it. */
  beginRotate(): void {
    this.transform.beginRotate();
  }
  /** S: the length follows the mouse or a typed length; Enter confirms. */
  beginSize(): void {
    this.transform.beginSize();
  }
  /** Shift+R: array the selection by dragging; see the controller. */
  beginArray(base: Partial<ArrayParams> = {}): void {
    this.transform.beginArray(base);
  }
  /** Shift+D: copy in place and grab the copies. */
  duplicateAndGrab(): void {
    if (this.transform.active || !this.store.selected.size) return;
    this.store.duplicateSelected([0, 0, 0]);
    this.beginGrab();
  }

  // ---- pointer ----
  private onPointerDown(e: PointerEvent): void {
    this.lastPointer = [e.clientX, e.clientY];
    if (dragGesture(e)) return; // Alt+left-drag: the orbit controls have it
    const live = this.transform.active;
    if (e.button === 2) {
      this.rightDown = [e.clientX, e.clientY];
      if (live?.modal) this.suppressMenu = true; // this right click cancels, no menu
    }
    if (live?.modal) {
      if (e.button === 0 && live.kind === 'rotate') {
        this.setRay(e.clientX, e.clientY);
        const rh = this.rotateGizmo.pick(this.ray);
        if (rh) {
          this.downPos = [e.clientX, e.clientY];
          this.transform.beginRingDrag(rh.axis);
          this.capture(e);
          return;
        }
      }
      if (e.button === 0) this.transform.finish(true);
      else if (e.button === 2) this.transform.finish(false);
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
      if (this.transform.beginEndDrag(eh.end)) this.capture(e);
      return;
    }
    const gh = this.lookOnly ? null : this.gizmo.pick(this.ray);
    const center = this.selectionCenter();
    if (gh && center) {
      if (!this.transform.start('grab', false)) return;
      const local = this.gizmoFrame() !== undefined;
      if (gh.handle.kind === 'axis')
        this.transform.setConstraint(AXIS_NAMES[gh.handle.axis]!, local);
      else
        this.transform.setConstraint(
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
      const t = this.transform.start('grab', false);
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
    const t = this.transform.active;
    if (t) {
      if (t.kind === 'rotate' && !t.ring) {
        // Rotate mode without a ring in hand: highlight the ring under the pointer.
        this.setRay(e.clientX, e.clientY);
        const rh = this.rotateGizmo.pick(this.ray);
        this.rotateGizmo.setHover(rh?.object ?? null);
        this.container.style.cursor = rh ? 'grab' : '';
      } else this.transform.pointerMove(e, this.downPos);
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
    if (!this.transform.pointerUp() && this.box) {
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
}
