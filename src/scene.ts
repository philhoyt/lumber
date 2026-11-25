/**
 * The 3D view: renders parts as boxes, handles picking and dragging, and keeps the
 * meshes in step with the store. All model changes still go through the store.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { partAABB, partDims, unionAABB, type AABB, type Part, type Vec3 } from './model';
import { snapDelta } from './snap';
import { stockById, type Stock } from './stock';
import type { Store } from './store';
import { fmt } from './units';

interface DragState {
  plane: THREE.Plane;
  start: THREE.Vector3;
  vertical: boolean;
  ids: Set<number>;
  startPos: Vec3[];
  aabb: AABB;
  others: AABB[];
  before: string;
  moved: boolean;
}

const EDGE_NORMAL = 0x3a2a15;
const EDGE_SELECTED = 0x9fd3ff;

export class LumberScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private partsGroup = new THREE.Group();
  private meshes = new Map<number, THREE.Group>();
  private matCache = new Map<string, THREE.MeshLambertMaterial>();
  private edgeNormal = new THREE.LineBasicMaterial({ color: EDGE_NORMAL });
  private edgeSelected = new THREE.LineBasicMaterial({ color: EDGE_SELECTED });
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private drag: DragState | null = null;
  private downPos: [number, number] | null = null;
  private downHit = false;
  private labelEl: HTMLElement;

  constructor(
    private container: HTMLElement,
    private store: Store,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'part-label';
    container.appendChild(this.labelEl);

    this.scene.background = new THREE.Color(0x202226);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
    this.camera.position.set(90, 70, 110);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 18, 0);
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03; // never look up from under the floor
    this.controls.minDistance = 10;
    this.controls.maxDistance = 1200;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(60, 120, 40);
    this.scene.add(sun);
    this.scene.add(new THREE.GridHelper(240, 240, 0x33363b, 0x2a2d31));
    const major = new THREE.GridHelper(240, 20, 0x4a4e55, 0x4a4e55);
    major.position.y = 0.01;
    this.scene.add(major);
    const axes = new THREE.AxesHelper(12);
    axes.position.y = 0.02;
    this.scene.add(axes);
    this.scene.add(this.partsGroup);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    store.subscribe((kind) => {
      if (kind === 'model' || kind === 'selection') this.syncAll();
    });
    this.syncAll();
    this.animate();
  }

  // ---- meshes ----
  private materialFor(stock: Stock, selected: boolean): THREE.MeshLambertMaterial {
    const key = stock.id + (selected ? ':s' : '');
    let m = this.matCache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: stock.color, emissive: selected ? 0x1e4b73 : 0 });
      this.matCache.set(key, m);
    }
    return m;
  }
  private buildMesh(p: Part): THREE.Group {
    const d = partDims(p);
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(d[0], d[1], d[2]);
    const mesh = new THREE.Mesh(geo, this.materialFor(stockById(p.stock), false));
    mesh.userData.id = p.id;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeNormal);
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
    const sel = this.store.selected.has(p.id);
    (g.children[0] as THREE.Mesh).material = this.materialFor(stockById(p.stock), sel);
    (g.children[1] as THREE.LineSegments).material = sel ? this.edgeSelected : this.edgeNormal;
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
    this.renderer.render(this.scene, this.camera);
    this.updateLabel();
  };

  private updateLabel(): void {
    const { selected } = this.store;
    const p = selected.size === 1 ? this.store.partById([...selected][0]!) : undefined;
    if (!p) {
      this.labelEl.style.display = 'none';
      return;
    }
    const b = partAABB(p);
    const v = new THREE.Vector3(
      (b.min[0] + b.max[0]) / 2,
      b.max[1],
      (b.min[2] + b.max[2]) / 2,
    ).project(this.camera);
    this.labelEl.style.display = 'block';
    this.labelEl.style.left = `${((v.x + 1) / 2) * this.container.clientWidth}px`;
    this.labelEl.style.top = `${((1 - v.y) / 2) * this.container.clientHeight}px`;
    const s = stockById(p.stock);
    this.labelEl.textContent = `${p.name} · ${s.name} · ${s.sheet ? fmt(p.w ?? s.sheet[0]) + ' × ' : ''}${fmt(p.len)}`;
  }

  // ---- picking ----
  private setRay(clientX: number, clientY: number): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }
  private pick(e: PointerEvent): THREE.Intersection | null {
    this.setRay(e.clientX, e.clientY);
    const meshes = this.partsGroup.children.map((g) => g.children[0]!);
    return this.ray.intersectObjects(meshes, false)[0] ?? null;
  }
  /** Where a screen position lands on the floor, or null when it misses. */
  groundPoint(clientX: number, clientY: number): Vec3 | null {
    this.setRay(clientX, clientY);
    const out = new THREE.Vector3();
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), out);
    return hit ? [out.x, out.y, out.z] : null;
  }

  // ---- dragging ----
  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.downPos = [e.clientX, e.clientY];
    const hit = this.pick(e);
    this.downHit = !!hit;
    if (!hit) return;
    const id = hit.object.userData.id as number;
    if (e.ctrlKey || e.metaKey) {
      this.store.toggleSelect(id);
      return;
    }
    if (!this.store.selected.has(id)) this.store.select([id]);
    this.controls.enabled = false;
    let plane: THREE.Plane;
    if (e.shiftKey) {
      const n = new THREE.Vector3();
      this.camera.getWorldDirection(n);
      n.y = 0;
      n.normalize();
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point);
    } else plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
    const list = this.store.selectedParts();
    const ids = new Set(list.map((p) => p.id));
    this.drag = {
      plane,
      start: hit.point.clone(),
      vertical: e.shiftKey,
      ids,
      startPos: list.map((p) => [...p.pos] as Vec3),
      aabb: unionAABB(list),
      others: this.store.parts.filter((p) => !ids.has(p.id)).map(partAABB),
      before: this.store.snapshot(),
      moved: false,
    };
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
  }
  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.setRay(e.clientX, e.clientY);
    const pt = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(d.plane, pt)) return;
    const delta: Vec3 = d.vertical
      ? [0, pt.y - d.start.y, 0]
      : [pt.x - d.start.x, 0, pt.z - d.start.z];
    snapDelta(d.aabb, delta, d.vertical ? [1] : [0, 2], d.others, this.store.settings);
    const list = this.store.selectedParts();
    list.forEach((p, i) => {
      const s = d.startPos[i]!;
      p.pos = [s[0] + delta[0], s[1] + delta[1], s[2] + delta[2]];
      this.syncMesh(p);
    });
    if (!d.moved && this.downPos) {
      d.moved = Math.hypot(e.clientX - this.downPos[0], e.clientY - this.downPos[1]) > 2;
    }
    this.store.notify('drag');
  }
  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (d) {
      if (d.moved) this.store.commit(d.before);
      else this.store.restore(d.before);
      this.controls.enabled = true;
      this.drag = null;
    } else if (
      this.downPos &&
      !this.downHit &&
      Math.hypot(e.clientX - this.downPos[0], e.clientY - this.downPos[1]) < 3
    ) {
      this.store.select([]);
    }
    this.downPos = null;
  }
}
