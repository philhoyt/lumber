/**
 * Fastener markers in three.js: a small head drawn on the part's face, built in the
 * part's local frame so it rides along with the mesh. Sizes are real inches. Head
 * geometry is shared per kind and never disposed.
 */
import * as THREE from 'three';
import { fastenerLocal, type Fastener, type FastenerKind } from './fastener';
import type { Vec3 } from './model';

const FILL: Record<FastenerKind, number> = {
  screw: 0x545a66,
  pocket: 0x2f6fde,
  nail: 0x7b8290,
  bolt: 0x3d434d,
  dowel: 0xc9a05f,
};
const UP = new THREE.Vector3(0, 0, 1);

interface Head {
  fill: THREE.BufferGeometry;
  /** The rim (and for screws a cross) as line segment pairs. */
  lines: THREE.BufferGeometry;
}
const heads = new Map<FastenerKind, Head>();

/** The head's outline in the XY plane, facing +Z. */
function headGeometry(kind: FastenerKind): Head {
  let h = heads.get(kind);
  if (h) return h;
  let fill: THREE.BufferGeometry;
  if (kind === 'bolt') fill = new THREE.CircleGeometry(0.36, 6);
  else if (kind === 'pocket') fill = new THREE.CircleGeometry(0.3, 24).scale(1.9, 1, 1);
  else if (kind === 'nail') fill = new THREE.CircleGeometry(0.11, 12);
  else if (kind === 'dowel') fill = new THREE.CircleGeometry(0.19, 20);
  else fill = new THREE.CircleGeometry(0.22, 20);
  // CircleGeometry lists the centre first, then the rim.
  const pos = fill.getAttribute('position') as THREE.BufferAttribute;
  const rim: THREE.Vector3[] = [];
  for (let i = 1; i < pos.count; i++) rim.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  const pairs: THREE.Vector3[] = [];
  for (let i = 0; i < rim.length; i++) pairs.push(rim[i]!, rim[(i + 1) % rim.length]!);
  if (kind === 'screw') {
    // A Phillips cross so screws read as screws.
    const r = 0.15;
    pairs.push(
      new THREE.Vector3(-r, 0, 0),
      new THREE.Vector3(r, 0, 0),
      new THREE.Vector3(0, -r, 0),
      new THREE.Vector3(0, r, 0),
    );
  }
  h = { fill, lines: new THREE.BufferGeometry().setFromPoints(pairs) };
  heads.set(kind, h);
  return h;
}

const fillMats = new Map<string, THREE.MeshBasicMaterial>();
const lineMat = new THREE.LineBasicMaterial({ color: 0xf2efe8 });
const ghostLineMat = new THREE.LineBasicMaterial({ color: 0x5fb3ff, depthTest: false });

function fillMaterial(kind: FastenerKind, ghost: boolean): THREE.MeshBasicMaterial {
  const key = `${kind}:${ghost ? 1 : 0}`;
  let m = fillMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: FILL[kind],
      transparent: ghost,
      opacity: ghost ? 0.55 : 1,
      depthTest: !ghost,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    fillMats.set(key, m);
  }
  return m;
}

/** One marker head at a point with an outward normal, in whatever frame the caller uses. */
export function markerMesh(
  kind: FastenerKind,
  point: Vec3,
  normal: Vec3,
  ghost = false,
): THREE.Group {
  const { fill, lines } = headGeometry(kind);
  const g = new THREE.Group();
  const head = new THREE.Mesh(fill, fillMaterial(kind, ghost));
  const outline = new THREE.LineSegments(lines, ghost ? ghostLineMat : lineMat);
  if (ghost) {
    head.renderOrder = 993;
    outline.renderOrder = 994;
  }
  g.add(head, outline);
  placeMarker(g, point, normal);
  return g;
}

/** Sit a marker on a surface point, facing out along the normal, a hair off the surface. */
export function placeMarker(g: THREE.Object3D, point: Vec3, normal: Vec3): void {
  const nrm = new THREE.Vector3().fromArray(normal).normalize();
  g.quaternion.setFromUnitVectors(UP, nrm);
  g.position.fromArray(point).addScaledVector(nrm, 0.012);
}

/** All of a part's markers, in its local frame; each head carries its index. */
export function buildMarkers(list: readonly Fastener[], dims: Vec3): THREE.Group {
  const g = new THREE.Group();
  g.name = 'markers';
  list.forEach((f, i) => {
    const { point, normal } = fastenerLocal(f, dims);
    const m = markerMesh(f.kind, point, normal);
    m.userData.fastener = i;
    (m.children[0] as THREE.Mesh).userData.fastener = i;
    g.add(m);
  });
  return g;
}
