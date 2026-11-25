/**
 * The camera rig: a perspective and an orthographic camera sharing one orbit, Blender's
 * view keys and auto-perspective, and the gestures for people without a middle mouse
 * button. It knows nothing about parts; the scene hands it bounds to frame.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { dragGesture, orbitDegrees, wheelGesture, wheelPixels, zoomScale } from '../gestures';
import { aabbCenter, type AABB, type Vec3 } from '../model';

export type Projection = 'persp' | 'ortho';
export type ViewName =
  'iso' | 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left' | 'fit' | 'selected';

/** Half the ortho frustum height at zoom 1, world inches. */
const ORTHO_HALF = 60;
export const Z_UP = new THREE.Vector3(0, 0, 1);
const VIEW_DIRS: Record<Exclude<ViewName, 'fit' | 'selected'>, THREE.Vector3> = {
  iso: new THREE.Vector3(1, -1, 0.8),
  top: new THREE.Vector3(0, -0.0001, 1),
  bottom: new THREE.Vector3(0, -0.0001, -1),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
};

/** What the overlays need from the view to pin HTML to world points. */
export interface ViewContext {
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly container: HTMLElement;
  viewHeightAt(point: THREE.Vector3): number;
}

export class CameraRig implements ViewContext {
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  private cam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  /** The ortho view came from an axis view; orbiting away returns to perspective. */
  private orthoFromAxis = false;
  private axisDir: THREE.Vector3 | null = null;
  private skipAutoPersp = false;
  /** Called when the projection changes, for the view strip. */
  onProjectionChange: ((mode: Projection) => void) | null = null;
  private watchers: (() => void)[] = [];
  private key = '';
  /** Trackpad mode: two-finger scroll orbits, pinch zooms, Shift+scroll pans. Remembered per browser. */
  private trackpadOn = false;

  /**
   * @param container  the view's element, for sizes and the gesture listeners
   * @param domElement the canvas the orbit controls listen on
   * @param boundsFor  what a named view should frame
   */
  constructor(
    readonly container: HTMLElement,
    domElement: HTMLElement,
    private readonly boundsFor: (name: ViewName) => AABB,
  ) {
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
    this.cam = this.persp;
    this.controls = new OrbitControls(this.cam, domElement);
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
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.cam;
  }
  get target(): THREE.Vector3 {
    return this.controls.target;
  }
  /** Orbit controls off while a transform owns the pointer. */
  set enabled(on: boolean) {
    this.controls.enabled = on;
  }

  resize(w: number, h: number): void {
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.ortho.left = -ORTHO_HALF * (w / h);
    this.ortho.right = ORTHO_HALF * (w / h);
    this.ortho.updateProjectionMatrix();
  }

  /** The world height visible at a point: what a constant screen size must scale to. */
  viewHeightAt(point: THREE.Vector3): number {
    if (this.cam instanceof THREE.OrthographicCamera) return (2 * ORTHO_HALF) / this.cam.zoom;
    const fov = (this.persp.fov * Math.PI) / 180;
    return 2 * this.cam.position.distanceTo(point) * Math.tan(fov / 2);
  }

  /** Once a frame: damping, then the watchers if the view turned. */
  tick(): void {
    this.controls.update();
    const q = this.cam.quaternion;
    const key = `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)},${this.projection}`;
    if (key === this.key) return;
    this.key = key;
    for (const fn of this.watchers) fn();
  }
  /** Called whenever the camera turns or switches projection; for the corner gizmo. */
  watchCamera(fn: () => void): void {
    this.watchers.push(fn);
  }
  /** The world axes in camera space: x right, y up, z toward the viewer. */
  cameraAxes(): [Vec3, Vec3, Vec3] {
    const inv = this.cam.quaternion.clone().invert();
    const to = (x: number, y: number, z: number): Vec3 =>
      new THREE.Vector3(x, y, z).applyQuaternion(inv).toArray();
    return [to(1, 0, 0), to(0, 1, 0), to(0, 0, 1)];
  }
  /** The unit vector from the model to the camera. */
  viewDir(): Vec3 {
    return this.cam.position.clone().sub(this.controls.target).normalize().toArray();
  }

  // ---- projection ----
  get projection(): Projection {
    return this.cam === this.ortho ? 'ortho' : 'persp';
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
      this.cam = this.ortho;
    } else {
      const height = (2 * ORTHO_HALF) / this.ortho.zoom;
      const dir = this.ortho.position.clone().sub(target).normalize();
      this.persp.position.copy(target).add(dir.multiplyScalar(height / (2 * tan)));
      this.persp.quaternion.copy(this.ortho.quaternion);
      this.cam = this.persp;
    }
    this.orthoFromAxis = mode === 'ortho' && fromAxis;
    this.controls.object = this.cam;
    this.quietUpdate();
    this.onProjectionChange?.(mode);
  }
  toggleProjection(): void {
    this.setProjection(this.projection === 'ortho' ? 'persp' : 'ortho');
  }
  /** Blender's auto-perspective: orbiting away from an axis view drops back to perspective. */
  private onCameraMoved(): void {
    if (this.skipAutoPersp || !this.orthoFromAxis || !this.axisDir) return;
    const dir = this.cam.position.clone().sub(this.controls.target).normalize();
    if (dir.angleTo(this.axisDir) > 0.02) this.setProjection('persp');
  }
  /** Update the controls without the auto-perspective check: this move is a view snap. */
  private quietUpdate(): void {
    this.skipAutoPersp = true;
    this.controls.update();
    this.skipAutoPersp = false;
  }

  // ---- views ----
  setView(name: ViewName): void {
    const u = this.boundsFor(name);
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
      ? this.cam.position.clone().sub(this.controls.target)
      : VIEW_DIRS[name].clone();
    this.cam.position.copy(center).add(dir.normalize().multiplyScalar(dist));
    this.controls.target.copy(center);
    if (this.cam instanceof THREE.OrthographicCamera) {
      this.cam.zoom = ORTHO_HALF / (radius * 1.1);
      this.cam.updateProjectionMatrix();
    }
    this.quietUpdate();
  }
  /** The camera offset from its target after turning `az` about up and `el` up or down. */
  private turned(az: number, el: number): THREE.Vector3 {
    const offset = this.cam.position.clone().sub(this.controls.target);
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
    return offset;
  }
  /** Turn the camera about the model in a step: `az` degrees around the up axis, `el` up or down. */
  orbitStep(az: number, el: number): void {
    const offset = this.turned(az, el);
    this.cam.position.copy(this.controls.target).add(offset);
    // A stepped orbit is a view snap, not a free orbit: it keeps the ortho view.
    if (this.orthoFromAxis) this.axisDir = offset.clone().normalize();
    this.quietUpdate();
  }
  /** Orbit by degrees as a free orbit does: an axis ortho view drops back to perspective. */
  orbitFree(az: number, el: number): void {
    this.cam.position.copy(this.controls.target).add(this.turned(az, el));
    this.controls.update();
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
  /** Slide the view by screen pixels: the camera moves right by `dx` and up by `dy`. */
  panPixels(dx: number, dy: number): void {
    const h = this.container.clientHeight || 1;
    const perPx = this.viewHeightAt(this.controls.target) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1);
    const move = right.multiplyScalar(dx * perPx).add(up.multiplyScalar(dy * perPx));
    this.cam.position.add(move);
    this.controls.target.add(move);
    this.quietUpdate();
  }
  /** Move toward or away from the target by a factor; an ortho view changes its zoom instead. */
  dolly(scale: number): void {
    if (this.cam instanceof THREE.OrthographicCamera) {
      this.cam.zoom = Math.min(
        this.controls.maxZoom,
        Math.max(this.controls.minZoom, this.cam.zoom / scale),
      );
      this.cam.updateProjectionMatrix();
    } else {
      const offset = this.cam.position.clone().sub(this.controls.target);
      const dist = Math.min(
        this.controls.maxDistance,
        Math.max(this.controls.minDistance, offset.length() * scale),
      );
      this.cam.position.copy(this.controls.target).add(offset.setLength(dist));
    }
    this.quietUpdate();
  }

  // ---- trackpad ----
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
}
