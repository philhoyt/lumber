/**
 * The geometry of one part: a box, or for a mitered board its outline extruded through
 * the thickness, with each cut's box taken out of the solid.
 */
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { fastenersKey, fastenersOf } from '../fastener';
import {
  bevelOf,
  cutBox,
  cutsKey,
  cutsOf,
  endCutCorners,
  hasEndCut,
  isCylinderPart,
  miterOf,
  type Part,
  type Vec3,
} from '../model';
import { stockById } from '../stock';

/** Everything the mesh depends on; when it changes, the mesh is rebuilt. */
export const meshSignature = (p: Part, d: Vec3): string =>
  `${d.join(',')},${p.stock},${miterOf(p).join('/')},${bevelOf(p).join('/')},${cutsKey(cutsOf(p))},${fastenersKey(fastenersOf(p))}`;

/** A six-sided solid from the eight end-cut corners, with flat faces wound outward. */
function hexahedron(c: Vec3[]): THREE.BufferGeometry {
  // Each face as four corner indices going around it; the centre decides the winding.
  const faces: [number, number, number, number][] = [
    [0, 2, 6, 4], // -X end
    [1, 3, 7, 5], // +X end
    [0, 1, 5, 4], // -Y edge
    [2, 3, 7, 6], // +Y edge
    [0, 1, 3, 2], // -Z face
    [4, 5, 7, 6], // +Z face
  ];
  const centre = new THREE.Vector3();
  for (const v of c) centre.add(new THREE.Vector3().fromArray(v));
  centre.divideScalar(c.length);
  const pos: number[] = [];
  const push = (i: number) => pos.push(...c[i]!);
  for (const f of faces) {
    const a = new THREE.Vector3().fromArray(c[f[0]]!);
    const b = new THREE.Vector3().fromArray(c[f[1]]!);
    const d = new THREE.Vector3().fromArray(c[f[2]]!);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    const outward = n.dot(a.clone().sub(centre)) >= 0;
    const [i0, i1, i2, i3] = outward ? f : ([f[0], f[3], f[2], f[1]] as const);
    push(i0);
    push(i1);
    push(i2);
    push(i0);
    push(i2);
    push(i3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

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

/**
 * A box, or for a board with mitered or beveled ends the solid between its end planes. A
 * reference cylinder is round: its diameter across X and Y, standing on end along Z.
 */
export function partGeometry(p: Part, d: Vec3): THREE.BufferGeometry {
  if (isCylinderPart(p))
    return new THREE.CylinderGeometry(d[0] / 2, d[0] / 2, d[2], 48).rotateX(Math.PI / 2);
  const geo =
    !hasEndCut(p) || stockById(p.stock).sheet
      ? new THREE.BoxGeometry(d[0], d[1], d[2])
      : hexahedron(endCutCorners(d, miterOf(p), bevelOf(p)));
  return cutsOf(p).length && !stockById(p.stock).sheet ? subtractCuts(geo, p, d) : geo;
}

/** The outline drawn over a part: every edge of a box, only the rims of a cylinder. */
export function partEdges(p: Part, geo: THREE.BufferGeometry): THREE.EdgesGeometry {
  return new THREE.EdgesGeometry(geo, isCylinderPart(p) ? 30 : 1);
}
