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
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { dragGesture, orbitDegrees, wheelGesture, wheelPixels, zoomScale } from './gestures';
import { axisParam, Gizmo, ringAngle, RotateGizmo } from './gizmo';
import {
  aabbCenter,
  aabbSize,
  cutBox,
  cutsKey,
  cutsOf,
  hasMiter,
  miterOf,
  miterOutline,
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
import { fastenerAt, fastenerLocal, fastenersKey, fastenersOf, type Fastener } from './fastener';
import { buildMarkers, markerMesh, placeMarker } from './markers';
import { measureBetween, measureText, nearestSnap, snapPoints } from './measure';
import { coplanarFaces, snapQuads, snapWithHits, type SnapHit } from './snap';
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

export type Projection = 'persp' | 'ortho';
/** Half the ortho frustum height at zoom 1, world inches. */
const ORTHO_HALF = 60;

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

const meshSignature = (p: Part, d: Vec3): string =>
  `${d.join(',')},${p.stock},${miterOf(p).join('/')},${cutsKey(cutsOf(p))},${fastenersKey(fastenersOf(p))}`;

const csg = new Evaluator();
csg.useGroups = false;

/** Take each cut's box out of the part's solid. */
function subtractCuts(base: THREE.BufferGeometry, p: Part, d: Vec3): THREE.BufferGeometry {
  let brush = new Brush(base);
  brush.updateMatrixWorld();
  for (const c of cutsOf(p)) {
    const box = cutBox(c, d);
    if (!box) continue;
    const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
    const tool = new Brush(new THREE.BoxGeometry(size[0], size[1], size[2]));
    tool.position.set(
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    );
    tool.updateMatrixWorld();
    const next = csg.evaluate(brush, tool, SUBTRACTION);
    brush.geometry.dispose();
    tool.geometry.dispose();
    brush = next;
    brush.updateMatrixWorld();
  }
  return brush.geometry;
}

/** A box, or for a mitered board the face outline extruded through the thickness. */
function partGeometry(p: Part, d: Vec3): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry;
  if (!hasMiter(p) || stockById(p.stock).sheet) geo = new THREE.BoxGeometry(d[0], d[1], d[2]);
  else {
    const shape = new THREE.Shape(
      miterOutline(d[0], d[1], miterOf(p)).map(([x, y]) => new THREE.Vector2(x, y)),
    );
    geo = new THREE.ExtrudeGeometry(shape, { depth: d[2], bevelEnabled: false });
    geo.translate(0, 0, -d[2] / 2);
  }
  return cutsOf(p).length && !stockById(p.stock).sheet ? subtractCuts(geo, p, d) : geo;
}

export class LumberScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** The ortho view came from an axis view; orbiting away returns to perspective. */
  private orthoFromAxis = false;
  private axisDir: THREE.Vector3 | null = null;
  private skipAutoPersp = false;
  /** Called when the projection changes, for the view strip. */
  onProjectionChange: ((mode: Projection) => void) | null = null;
  private cameraWatchers: (() => void)[] = [];
  private cameraKey = '';
  private controls: OrbitControls;
  /** Trackpad mode: two-finger scroll orbits, pinch zooms, Shift+scroll pans. Remembered per browser. */
  private trackpadOn = false;
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
  /** Dimension labels on every part and extents around the selection. */
  showDims = false;
  private dimLabels: HTMLElement[] = [];
  private extentLabels: HTMLElement[] = [];
  private extentLines: THREE.LineSegments;
  /** Translucent quads over the faces a drag snapped to; they flash when the target changes. */
  private snapQuads: { fill: THREE.Mesh; edge: THREE.LineLoop }[] = [];
  private snapKey = '';
  private snapFlash = 0;
  private measure: { a: Vec3 | null; b: Vec3 | null; live: Vec3 | null } | null = null;
  private measureLine: THREE.Line;
  private measureLabel: HTMLElement;
  private snapDot: THREE.Mesh;
  onMeasureChange: ((on: boolean) => void) | null = null;
  /** F: placing fastener markers. The ghost shows where the next one would go. */
  private fasten: { ghost: THREE.Group | null; ghostKind: string } | null = null;
  private fastenWatchers: ((on: boolean) => void)[] = [];
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
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'part-label';
    this.dragLabelEl = document.createElement('div');
    this.dragLabelEl.className = 'drag-label';
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'box-select';
    container.append(this.labelEl, this.dragLabelEl, this.boxEl);

    this.scene.background = new THREE.Color(0x202226);
    this.persp = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
    this.persp.up.copy(Z_UP);
    this.persp.position.set(90, -110, 70);
    this.ortho = new THREE.OrthographicCamera(
      -ORTHO_HALF,
      ORTHO_HALF,
      ORTHO_HALF,
      -ORTHO_HALF,
      -5000,
      5000,
    );
    this.ortho.up.copy(Z_UP);
    this.camera = this.persp;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minZoom = 0.05;
    this.controls.maxZoom = 60;
    this.controls.addEventListener('change', () => this.onCameraMoved());
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
    const overlayMat = new THREE.LineBasicMaterial({
      color: 0xffd27a,
      depthTest: false,
      transparent: true,
    });
    this.extentLines = new THREE.LineSegments(new THREE.BufferGeometry(), overlayMat);
    this.extentLines.renderOrder = 990;
    this.extentLines.visible = false;
    this.measureLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x5fb3ff, depthTest: false, transparent: true }),
    );
    this.measureLine.renderOrder = 991;
    this.measureLine.visible = false;
    this.snapDot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x5fb3ff, depthTest: false, transparent: true }),
    );
    this.snapDot.renderOrder = 992;
    this.snapDot.visible = false;
    this.scene.add(this.extentLines, this.measureLine, this.snapDot);
    this.measureLabel = document.createElement('div');
    this.measureLabel.className = 'measure-label';
    container.appendChild(this.measureLabel);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    el.addEventListener('pointerleave', () => this.setHover(null));
    el.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    // Alt+left-drag orbits (Shift+Alt pans, Ctrl+Alt zooms) for mice without a middle
    // button. The decision is made as the button goes down, ahead of the orbit controls,
    // which read the button map only then; it is cleared again when the button comes up.
    container.addEventListener(
      'pointerdown',
      (e) => {
        const g = dragGesture(e);
        this.controls.mouseButtons.LEFT =
          g === 'orbit'
            ? THREE.MOUSE.ROTATE
            : g === 'pan'
              ? THREE.MOUSE.PAN
              : g === 'zoom'
                ? THREE.MOUSE.DOLLY
                : null;
      },
      { capture: true },
    );
    window.addEventListener('pointerup', () => {
      this.controls.mouseButtons.LEFT = null;
    });
    // Trackpad mode takes the wheel before the orbit controls see it.
    container.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    try {
      this.trackpadOn = localStorage.getItem('lumber.trackpad') === '1';
    } catch {
      /* no storage */
    }
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
    return this.measure !== null;
  }

  get fastening(): boolean {
    return this.fasten !== null;
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

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.ortho.left = -ORTHO_HALF * (w / h);
    this.ortho.right = ORTHO_HALF * (w / h);
    this.ortho.updateProjectionMatrix();
  }

  /** The world height visible at a point: what a constant screen size must scale to. */
  private viewHeightAt(point: THREE.Vector3): number {
    if (this.camera instanceof THREE.OrthographicCamera) return (2 * ORTHO_HALF) / this.camera.zoom;
    const fov = (this.persp.fov * Math.PI) / 180;
    return 2 * this.camera.position.distanceTo(point) * Math.tan(fov / 2);
  }

  // ---- projection ----
  get projection(): Projection {
    return this.camera === this.ortho ? 'ortho' : 'persp';
  }
  /** Switch cameras in place: the view keeps its direction and apparent size. */
  setProjection(mode: Projection, fromAxis = false): void {
    if (mode === this.projection) {
      this.orthoFromAxis = mode === 'ortho' && fromAxis;
      return;
    }
    const target = this.controls.target;
    const tan = Math.tan((this.persp.fov * Math.PI) / 360);
    if (mode === 'ortho') {
      const dist = this.persp.position.distanceTo(target);
      this.ortho.position.copy(this.persp.position);
      this.ortho.quaternion.copy(this.persp.quaternion);
      this.ortho.zoom = ORTHO_HALF / (dist * tan);
      this.ortho.updateProjectionMatrix();
      this.camera = this.ortho;
    } else {
      const height = (2 * ORTHO_HALF) / this.ortho.zoom;
      const dir = this.ortho.position.clone().sub(target).normalize();
      this.persp.position.copy(target).add(dir.multiplyScalar(height / (2 * tan)));
      this.persp.quaternion.copy(this.ortho.quaternion);
      this.camera = this.persp;
    }
    this.orthoFromAxis = mode === 'ortho' && fromAxis;
    this.controls.object = this.camera;
    this.skipAutoPersp = true;
    this.controls.update();
    this.skipAutoPersp = false;
    this.onProjectionChange?.(mode);
  }
  toggleProjection(): void {
    this.setProjection(this.projection === 'ortho' ? 'persp' : 'ortho');
  }
  /** Blender's auto-perspective: orbiting away from an axis view drops back to perspective. */
  private onCameraMoved(): void {
    if (this.skipAutoPersp || !this.orthoFromAxis || !this.axisDir) return;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.angleTo(this.axisDir) > 0.02) this.setProjection('persp');
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.noteCamera();
    const center = this.selectionCenter();
    const rotating = this.tf?.kind === 'rotate';
    const vh = center ? this.viewHeightAt(center) : 0;
    this.gizmo.update(rotating || this.explode ? null : center, vh);
    this.rotateGizmo.update(rotating ? center : null, vh);
    this.scaleMarkers();
    if (this.snapFlash > 0.01) {
      this.snapFlash *= 0.9;
      for (const { fill } of this.snapQuads)
        (fill.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.45 * this.snapFlash;
    }
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.updateDims();
    this.updateMeasure();
  };

  /** Tell the camera watchers when the view has turned or changed projection. */
  private noteCamera(): void {
    const q = this.camera.quaternion;
    const key = `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)},${this.projection}`;
    if (key === this.cameraKey) return;
    this.cameraKey = key;
    for (const fn of this.cameraWatchers) fn();
  }
  /** Called whenever the camera turns or switches projection; for the corner gizmo. */
  watchCamera(fn: () => void): void {
    this.cameraWatchers.push(fn);
  }
  /** The world axes in camera space: x right, y up, z toward the viewer. */
  cameraAxes(): [Vec3, Vec3, Vec3] {
    const inv = this.camera.quaternion.clone().invert();
    const to = (x: number, y: number, z: number): Vec3 =>
      new THREE.Vector3(x, y, z).applyQuaternion(inv).toArray();
    return [to(1, 0, 0), to(0, 1, 0), to(0, 0, 1)];
  }
  /** The unit vector from the model to the camera. */
  viewDir(): Vec3 {
    return this.camera.position.clone().sub(this.controls.target).normalize().toArray();
  }

  private selectionCenter(): THREE.Vector3 | null {
    const list = this.store.selectedParts();
    if (!list.length) return null;
    return new THREE.Vector3().fromArray(aabbCenter(this.displayBounds(list)));
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
      const m = miterOf(p);
      const miter = hasMiter(p) ? ` · ${Math.abs(m[0])}°/${Math.abs(m[1])}°` : '';
      this.labelEl.textContent = `${p.name} · ${s.name} · ${s.sheet ? fmt(p.w ?? s.sheet[0]) + ' × ' : ''}${fmt(p.len)}${miter}`;
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

  // ---- dimensions ----
  toggleDims(): void {
    if (this.explode && !this.showDims) this.setExplode(0);
    this.showDims = !this.showDims;
    if (!this.showDims) {
      for (const el of this.dimLabels) el.style.display = 'none';
      for (const el of this.extentLabels) el.style.display = 'none';
      this.extentLines.visible = false;
    }
  }

  /** Put a label at a world point, or hide it when the point is behind the camera. */
  private placeLabel(el: HTMLElement, world: THREE.Vector3, text: string): void {
    const p = world.clone().project(this.camera);
    if (p.z > 1) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${((p.x + 1) / 2) * this.container.clientWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * this.container.clientHeight}px`;
    if (el.textContent !== text) el.textContent = text;
  }

  private label(pool: HTMLElement[], i: number, cls: string): HTMLElement {
    let el = pool[i];
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      this.container.appendChild(el);
      pool[i] = el;
    }
    return el;
  }

  private updateDims(): void {
    if (!this.showDims) return;
    const { store } = this;
    const selectedOne = store.selected.size === 1 ? [...store.selected][0] : null;
    let i = 0;
    for (const p of store.visibleParts()) {
      if (p.id === selectedOne) continue; // the part label already names it
      const b = partAABB(p);
      const s = stockById(p.stock);
      const text = s.sheet ? `${fmt(p.w ?? s.sheet[0])} × ${fmt(p.len)}` : fmt(p.len);
      this.placeLabel(
        this.label(this.dimLabels, i++, 'dim-label'),
        new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]),
        text,
      );
    }
    for (let k = i; k < this.dimLabels.length; k++) this.dimLabels[k]!.style.display = 'none';

    // Extents of the selection: three dimension lines just outside its box.
    const list = store.selectedParts();
    if (!list.length) {
      this.extentLines.visible = false;
      for (const el of this.extentLabels) el.style.display = 'none';
      return;
    }
    const u = unionAABB(list);
    const size = aabbSize(u);
    const c = new THREE.Vector3().fromArray(aabbCenter(u));
    const off = this.viewHeightAt(c) * 0.03;
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
    this.extentLines.geometry.dispose();
    this.extentLines.geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(pts, 3),
    );
    this.extentLines.visible = true;
    const mids: [THREE.Vector3, string][] = [
      [new THREE.Vector3((x0 + x1) / 2, y0 - off, z0), `W ${fmt(size[0])}`],
      [new THREE.Vector3(x1 + off, (y0 + y1) / 2, z0), `D ${fmt(size[1])}`],
      [new THREE.Vector3(x1 + off, y1 + off, (z0 + z1) / 2), `H ${fmt(size[2])}`],
    ];
    mids.forEach(([v, text], k) =>
      this.placeLabel(this.label(this.extentLabels, k, 'dim-label extent'), v, text),
    );
  }

  // ---- measuring ----
  /** M: measure between two clicked points, snapping to part corners, edges and faces. */
  toggleMeasure(): void {
    if (this.explode) this.setExplode(0);
    if (this.measure) this.endMeasure();
    else {
      this.measure = { a: null, b: null, live: null };
      this.container.style.cursor = 'crosshair';
      this.onMeasureChange?.(true);
    }
  }
  endMeasure(): void {
    this.measure = null;
    this.measureLine.visible = false;
    this.snapDot.visible = false;
    this.measureLabel.style.display = 'none';
    this.container.style.cursor = '';
    this.onMeasureChange?.(false);
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
      if (this.measure) this.endMeasure();
      if (this.fasten) this.endFasten();
      if (this.showDims) this.toggleDims();
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

  // ---- fastener markers ----
  /** Markers are real size, but never shrink below a few pixels on screen. */
  private scaleMarkers(): void {
    const minScale = (at: THREE.Vector3) => Math.max(1, (this.viewHeightAt(at) * 0.016) / 0.44);
    for (const g of this.meshes.values()) {
      const markers = g.children[2];
      if (!g.visible || !markers?.children.length) continue;
      const s = minScale(g.position);
      for (const m of markers.children) m.scale.setScalar(s);
    }
    const ghost = this.fasten?.ghost;
    if (ghost?.visible) ghost.scale.setScalar(minScale(ghost.position));
  }
  /** F: click a face to add a marker there, click a marker to take it away. */
  toggleFasten(): void {
    if (this.explode) this.setExplode(0);
    if (this.fasten) this.endFasten();
    else {
      if (this.measure) this.endMeasure();
      this.fasten = { ghost: null, ghostKind: '' };
      this.container.style.cursor = 'crosshair';
      for (const w of this.fastenWatchers) w(true);
    }
  }
  endFasten(): void {
    if (!this.fasten) return;
    if (this.fasten.ghost) this.scene.remove(this.fasten.ghost);
    this.fasten = null;
    this.container.style.cursor = '';
    for (const w of this.fastenWatchers) w(false);
  }
  /** Be told when fastener placing starts and stops (toolbar, the bar over the view). */
  watchFasten(fn: (on: boolean) => void): void {
    this.fastenWatchers.push(fn);
  }
  /** What a click would do while placing: take a marker away, or add one on a face. */
  private fastenTarget(
    clientX: number,
    clientY: number,
  ):
    | { partId: number; remove: number }
    | { partId: number; add: Fastener; world: THREE.Vector3; normal: THREE.Vector3 }
    | null {
    this.setRay(clientX, clientY);
    const hit = this.pickPart();
    if (!hit) return null;
    const partId = hit.object.userData.id as number;
    const p = this.store.partById(partId);
    const g = this.meshes.get(partId);
    if (!p || !g) return null;
    const markers = g.children[2];
    if (markers) {
      const heads = markers.children.map((m) => m.children[0]!);
      const mh = this.ray.intersectObjects(heads, false)[0];
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
  private updateFastenGhost(clientX: number, clientY: number): void {
    const f = this.fasten;
    if (!f) return;
    const t = this.fastenTarget(clientX, clientY);
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

  /** The point under the pointer: a snap point on the part it hits, else the hit, else the floor. */
  private snapUnderPointer(clientX: number, clientY: number): Vec3 | null {
    this.setRay(clientX, clientY);
    const hit = this.pickPart();
    if (hit) {
      const p = this.store.partById(hit.object.userData.id as number);
      const at: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
      if (!p) return at;
      const tol = this.viewHeightAt(hit.point) * 0.025;
      return nearestSnap(snapPoints(partAABB(p)), at, tol) ?? at;
    }
    const g = this.groundPoint(clientX, clientY);
    if (!g) return null;
    const grid = this.store.settings.grid;
    const snap = (v: number) => (grid ? Math.round(v / grid) * grid : v);
    return [snap(g[0]), snap(g[1]), 0];
  }

  private updateMeasure(): void {
    const m = this.measure;
    if (!m) return;
    const end = m.b ?? m.live;
    const dot = m.b ? null : m.live;
    if (dot) {
      this.snapDot.visible = true;
      this.snapDot.position.fromArray(dot);
      const s = this.viewHeightAt(this.snapDot.position) * 0.006;
      this.snapDot.scale.set(s, s, s);
    } else this.snapDot.visible = false;
    if (!m.a || !end) {
      this.measureLine.visible = false;
      this.measureLabel.style.display = 'none';
      return;
    }
    const pos = this.measureLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, m.a[0], m.a[1], m.a[2]);
    pos.setXYZ(1, end[0], end[1], end[2]);
    pos.needsUpdate = true;
    this.measureLine.visible = true;
    const mid = new THREE.Vector3(
      (m.a[0] + end[0]) / 2,
      (m.a[1] + end[1]) / 2,
      (m.a[2] + end[2]) / 2,
    );
    this.placeLabel(this.measureLabel, mid, measureText(measureBetween(m.a, end), fmt));
  }

  // ---- views ----
  private bounds(parts: readonly Part[]): AABB {
    return parts.length ? this.displayBounds(parts) : { min: [-24, -24, 0], max: [24, 24, 24] };
  }
  setView(name: ViewName): void {
    const parts =
      name === 'selected' && this.store.selected.size
        ? this.store.selectedParts()
        : this.store.visibleParts();
    const u = this.bounds(parts);
    const center = new THREE.Vector3().fromArray(aabbCenter(u));
    const radius = Math.max(12, new THREE.Vector3().fromArray(u.max).distanceTo(center));
    const dist = (radius / Math.sin((this.persp.fov * Math.PI) / 360)) * 1.1;
    const keepDir = name === 'fit' || name === 'selected';
    // Axis views are orthographic, as in Blender; iso is perspective.
    if (!keepDir) {
      if (name === 'iso') this.setProjection('persp');
      else this.setProjection('ortho', true);
      this.axisDir = name === 'iso' ? null : VIEW_DIRS[name].clone().normalize();
    }
    const dir = keepDir
      ? this.camera.position.clone().sub(this.controls.target)
      : VIEW_DIRS[name].clone();
    this.camera.position.copy(center).add(dir.normalize().multiplyScalar(dist));
    this.controls.target.copy(center);
    if (this.camera instanceof THREE.OrthographicCamera) {
      this.camera.zoom = ORTHO_HALF / (radius * 1.1);
      this.camera.updateProjectionMatrix();
    }
    this.skipAutoPersp = true;
    this.controls.update();
    this.skipAutoPersp = false;
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
    // A stepped orbit is a view snap, not a free orbit: it keeps the ortho view.
    if (this.orthoFromAxis) this.axisDir = offset.clone().normalize();
    this.skipAutoPersp = true;
    this.controls.update();
    this.skipAutoPersp = false;
  }

  /** Blender's Numpad 9: look from the opposite side, a half turn about the up axis. */
  flipView(): void {
    const dir = this.viewDir();
    if (Math.abs(dir[2]) > 0.999) this.setView(dir[2] > 0 ? 'bottom' : 'top');
    else this.orbitStep(180, 0);
  }
  /** Blender's Numpad + and -: a step closer or farther. */
  zoomStep(inward: boolean): void {
    this.dolly(inward ? 1 / 1.25 : 1.25);
  }
  /** Blender's Ctrl+Numpad 2/4/6/8: slide the view by an eighth of its height. */
  panStep(dx: number, dy: number): void {
    const step = (this.container.clientHeight || 400) / 8;
    this.panPixels(dx * step, dy * step);
  }

  // ---- trackpad gestures ----
  get trackpad(): boolean {
    return this.trackpadOn;
  }
  setTrackpad(on: boolean): void {
    this.trackpadOn = on;
    try {
      localStorage.setItem('lumber.trackpad', on ? '1' : '0');
    } catch {
      /* best effort */
    }
  }
  private onWheel(e: WheelEvent): void {
    if (!this.trackpadOn) return;
    e.preventDefault();
    e.stopPropagation();
    const [dx, dy] = wheelPixels(e.deltaX, e.deltaY, e.deltaMode);
    const g = wheelGesture(e);
    if (g === 'zoom') this.dolly(zoomScale(dy));
    else if (g === 'pan') this.panPixels(-dx, dy);
    else {
      const { az, el } = orbitDegrees(dx, dy);
      this.orbitFree(az, el);
    }
  }
  /** Orbit by degrees as a free orbit does: an axis ortho view drops back to perspective. */
  orbitFree(az: number, el: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (az) offset.applyAxisAngle(Z_UP, (az * Math.PI) / 180);
    if (el) {
      const side = new THREE.Vector3().crossVectors(Z_UP, offset);
      if (side.lengthSq() > 1e-9) {
        side.normalize();
        const polar = offset.angleTo(Z_UP);
        const target = Math.min(Math.PI - 0.01, Math.max(0.01, polar - (el * Math.PI) / 180));
        offset.applyAxisAngle(side, polar - target);
      }
    }
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  /** Slide the view by screen pixels: the camera moves right by `dx` and up by `dy`. */
  panPixels(dx: number, dy: number): void {
    const h = this.container.clientHeight || 1;
    const perPx = this.viewHeightAt(this.controls.target) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(dx * perPx).add(up.multiplyScalar(dy * perPx));
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.skipAutoPersp = true;
    this.controls.update();
    this.skipAutoPersp = false;
  }
  /** Move toward or away from the target by a factor; an ortho view changes its zoom instead. */
  dolly(scale: number): void {
    if (this.camera instanceof THREE.OrthographicCamera) {
      this.camera.zoom = Math.min(
        this.controls.maxZoom,
        Math.max(this.controls.minZoom, this.camera.zoom / scale),
      );
      this.camera.updateProjectionMatrix();
    } else {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const dist = Math.min(
        this.controls.maxDistance,
        Math.max(this.controls.minDistance, offset.length() * scale),
      );
      this.camera.position.copy(this.controls.target).add(offset.setLength(dist));
    }
    this.skipAutoPersp = true;
    this.controls.update();
    this.skipAutoPersp = false;
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
    this.showSnaps(t);
  }

  /** The i-th feedback quad, made on first use. */
  private snapQuadAt(i: number): { fill: THREE.Mesh; edge: THREE.LineLoop } {
    while (this.snapQuads.length <= i) {
      const pos = new THREE.BufferAttribute(new Float32Array(12), 3);
      const fillGeo = new THREE.BufferGeometry()
        .setAttribute('position', pos)
        .setIndex([0, 1, 2, 0, 2, 3]);
      const fill = new THREE.Mesh(
        fillGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffd27a,
          transparent: true,
          opacity: 0.3,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      const edge = new THREE.LineLoop(
        new THREE.BufferGeometry().setAttribute('position', pos),
        new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true }),
      );
      fill.renderOrder = 985;
      edge.renderOrder = 986;
      fill.visible = edge.visible = false;
      this.snapQuads.push({ fill, edge });
      this.scene.add(fill, edge);
    }
    return this.snapQuads[i]!;
  }

  /** Lay a quad over every face (or the floor footprint) the grab just snapped to. */
  private showSnaps(t: Transform): void {
    const moved: AABB = {
      min: [t.aabb.min[0] + t.delta[0], t.aabb.min[1] + t.delta[1], t.aabb.min[2] + t.delta[2]],
      max: [t.aabb.max[0] + t.delta[0], t.aabb.max[1] + t.delta[1], t.aabb.max[2] + t.delta[2]],
    };
    const quads = t.snaps.flatMap((h) => snapQuads(h, moved, t.others));
    const key = t.snaps
      .filter((h) => h.kind !== 'grid')
      .map((h) => `${h.axis}:${h.kind}:${h.at}`)
      .join('|');
    if (key !== this.snapKey) {
      this.snapKey = key;
      this.snapFlash = key ? 1 : 0;
    }
    for (let i = 0; i < Math.max(quads.length, this.snapQuads.length); i++) {
      const { fill, edge } = this.snapQuadAt(i);
      const q = quads[i];
      fill.visible = edge.visible = !!q;
      if (!q) continue;
      const pos = fill.geometry.getAttribute('position') as THREE.BufferAttribute;
      // The two axes across the quad, in order, so the loop goes around the rectangle.
      const [u, v] = ([0, 1, 2] as AxisIndex[]).filter((a) => a !== q.axis) as [
        AxisIndex,
        AxisIndex,
      ];
      const corner = (cu: number, cv: number): Vec3 => {
        const c: Vec3 = [...q.lo];
        c[u] = cu;
        c[v] = cv;
        return c;
      };
      const corners = [
        corner(q.lo[u], q.lo[v]),
        corner(q.hi[u], q.lo[v]),
        corner(q.hi[u], q.hi[v]),
        corner(q.lo[u], q.hi[v]),
      ];
      corners.forEach((c, k) => pos.setXYZ(k, c[0], c[1], c[2]));
      pos.needsUpdate = true;
      fill.geometry.computeBoundingSphere();
      edge.geometry.computeBoundingSphere();
    }
  }
  private hideSnaps(): void {
    for (const { fill, edge } of this.snapQuads) fill.visible = edge.visible = false;
    this.snapKey = '';
    this.snapFlash = 0;
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
    this.hideSnaps();
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
    if (this.fasten) {
      if (e.button === 2) {
        this.suppressMenu = true;
        this.endFasten();
        return;
      }
      if (e.button !== 0) return;
      const t = this.fastenTarget(e.clientX, e.clientY);
      if (!t) return;
      if ('remove' in t) this.store.removeFastener(t.partId, t.remove);
      else this.store.addFastener(t.partId, t.add);
      this.updateFastenGhost(e.clientX, e.clientY);
      return;
    }
    if (this.measure) {
      if (e.button === 2) {
        this.suppressMenu = true;
        this.endMeasure();
        return;
      }
      if (e.button !== 0) return;
      const pt = this.snapUnderPointer(e.clientX, e.clientY);
      if (!pt) return;
      if (!this.measure.a || this.measure.b) this.measure = { a: pt, b: null, live: pt };
      else this.measure.b = pt;
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
    if (this.fasten) {
      this.updateFastenGhost(e.clientX, e.clientY);
      const hit = this.pickPart();
      this.setHover(hit ? (hit.object.userData.id as number) : null);
      return;
    }
    if (this.measure) {
      this.measure.live = this.snapUnderPointer(e.clientX, e.clientY);
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
      const [x, y] = this.toScreen(new THREE.Vector3().fromArray(aabbCenter(this.displayAABB(p))));
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
