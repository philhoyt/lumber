/**
 * The move gizmo: three axis arrows and three plane squares drawn at the selection's
 * centre, always on top and at a constant screen size. Dragging an arrow moves along
 * that axis only; dragging a square moves in that plane.
 */
import * as THREE from 'three';

export type AxisIndex = 0 | 1 | 2;
export type Handle =
  { kind: 'axis'; axis: AxisIndex } | { kind: 'plane'; axes: [AxisIndex, AxisIndex] };

export const AXIS_COLORS = [0xe0564a, 0x6fc24d, 0x4a8fe0] as const;
const AXIS_DIRS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
] as const;

/**
 * Parameter along a line (origin + s·dir) of the point nearest to a ray. This is how an
 * axis drag turns the mouse position into a distance along the axis.
 */
export function axisParam(origin: THREE.Vector3, dir: THREE.Vector3, ray: THREE.Ray): number {
  const w0 = origin.clone().sub(ray.origin);
  const b = dir.dot(ray.direction);
  const d = dir.dot(w0);
  const e = ray.direction.dot(w0);
  const denom = 1 - b * b; // dir and ray.direction are unit vectors
  if (denom < 1e-9) return 0; // looking straight down the axis
  return (b * e - d) / denom;
}

export class Gizmo {
  readonly group = new THREE.Group();
  private handles = new Map<THREE.Object3D, Handle>();
  private pickables: THREE.Object3D[] = [];
  private visuals = new Map<THREE.Object3D, THREE.MeshBasicMaterial>();
  private hovered: THREE.Object3D | null = null;

  constructor() {
    this.group.visible = false;
    for (let a = 0; a < 3; a++) this.buildAxis(a as AxisIndex);
    this.buildPlane([1, 2], 0);
    this.buildPlane([0, 2], 1);
    this.buildPlane([0, 1], 2);
  }

  private mat(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private buildAxis(axis: AxisIndex): void {
    const color = AXIS_COLORS[axis];
    const m = this.mat(color, 0.95);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), m);
    shaft.position.y = 0.4;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 12), m);
    tip.position.y = 0.91;
    // A fat invisible cylinder makes the arrow easy to grab.
    const pick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 1.05, 8),
      this.mat(color, 0),
    );
    pick.position.y = 0.525;
    const g = new THREE.Group();
    g.add(shaft, tip, pick);
    // The arrow is built along +Y; turn it to its axis.
    if (axis === 0) g.rotation.z = -Math.PI / 2;
    if (axis === 2) g.rotation.x = Math.PI / 2;
    for (const o of [shaft, tip, pick]) o.renderOrder = 1000;
    this.register(pick, { kind: 'axis', axis }, m);
    this.group.add(g);
  }

  private buildPlane(axes: [AxisIndex, AxisIndex], normal: AxisIndex): void {
    const color = AXIS_COLORS[normal];
    const m = this.mat(color, 0.35);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), m);
    const pos = new THREE.Vector3();
    pos.setComponent(axes[0], 0.33);
    pos.setComponent(axes[1], 0.33);
    quad.position.copy(pos);
    if (normal === 0) quad.rotation.y = Math.PI / 2;
    if (normal === 1) quad.rotation.x = -Math.PI / 2;
    quad.renderOrder = 1001;
    this.register(quad, { kind: 'plane', axes }, m);
    this.group.add(quad);
  }

  private register(o: THREE.Object3D, h: Handle, visual: THREE.MeshBasicMaterial): void {
    this.handles.set(o, h);
    this.pickables.push(o);
    this.visuals.set(o, visual);
  }

  static axisDir(axis: AxisIndex): THREE.Vector3 {
    return AXIS_DIRS[axis].clone();
  }

  /** Place the gizmo and size it to a constant fraction of the view. */
  update(origin: THREE.Vector3 | null, camera: THREE.PerspectiveCamera): void {
    if (!origin) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.copy(origin);
    const dist = camera.position.distanceTo(origin);
    const s = dist * 0.14;
    this.group.scale.set(s, s, s);
  }

  pick(ray: THREE.Raycaster): { object: THREE.Object3D; handle: Handle } | null {
    if (!this.group.visible) return null;
    const hit = ray.intersectObjects(this.pickables, false)[0];
    if (!hit) return null;
    return { object: hit.object, handle: this.handles.get(hit.object)! };
  }

  setHover(o: THREE.Object3D | null): void {
    if (o === this.hovered) return;
    if (this.hovered) {
      const h = this.handles.get(this.hovered)!;
      this.visuals.get(this.hovered)!.opacity = h.kind === 'axis' ? 0.95 : 0.35;
      this.visuals
        .get(this.hovered)!
        .color.set(
          AXIS_COLORS[h.kind === 'axis' ? h.axis : ((3 - h.axes[0] - h.axes[1]) as AxisIndex)],
        );
    }
    this.hovered = o;
    if (o) {
      const v = this.visuals.get(o)!;
      v.opacity = 1;
      v.color.set(0xffe08a);
    }
  }
}
