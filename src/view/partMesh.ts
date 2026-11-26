/**
 * The geometry of one part: a box, or for a board with angled ends or edges the solid
 * between its cut planes, with each cut's box (a chamfer's wedge) taken out of the solid.
 */
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { fastenersKey, fastenersOf } from '../fastener';
import {
  bevelOf,
  cutBox,
  cutsKey,
  cutsOf,
  edgeBevelOf,
  isCylinderPart,
  localCorners,
  miterOf,
  type Cut,
  type Part,
  type Vec3,
} from '../model';
import { stockById } from '../stock';

/** Everything the mesh depends on; when it changes, the mesh is rebuilt. */
export const meshSignature = (p: Part, d: Vec3): string =>
  `${d.join(',')},${p.stock},${miterOf(p).join('/')},${bevelOf(p).join('/')},${edgeBevelOf(p).join('/')},${cutsKey(cutsOf(p))},${fastenersKey(fastenersOf(p))}`;

/**
 * A convex solid from its corners and its flat faces, each face as corner indices going
 * around it; the centre decides the winding, so every face ends up facing outward.
 */
function convexSolid(c: Vec3[], faces: number[][]): THREE.BufferGeometry {
  const centre = new THREE.Vector3();
  for (const v of c) centre.add(new THREE.Vector3().fromArray(v));
  centre.divideScalar(c.length);
  const pos: number[] = [];
  const push = (i: number) => pos.push(...c[i]!);
  for (const f of faces) {
    const a = new THREE.Vector3().fromArray(c[f[0]!]!);
    const b = new THREE.Vector3().fromArray(c[f[1]!]!);
    const d = new THREE.Vector3().fromArray(c[f[2]!]!);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    const ring = n.dot(a.clone().sub(centre)) >= 0 ? f : [f[0]!, ...f.slice(1).reverse()];
    // Fan from the first corner: a triangle per further edge.
    for (let k = 1; k + 1 < ring.length; k++) {
      push(ring[0]!);
      push(ring[k]!);
      push(ring[k + 1]!);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A six-sided solid from the eight cut corners. */
const hexahedron = (c: Vec3[]): THREE.BufferGeometry =>
  convexSolid(c, [
    [0, 2, 6, 4], // -X end
    [1, 3, 7, 5], // +X end
    [0, 1, 5, 4], // -Y edge
    [2, 3, 7, 6], // +Y edge
    [0, 1, 3, 2], // -Z face
    [4, 5, 7, 6], // +Z face
  ]);

/**
 * The wedge a chamfer takes off: a triangular prism along its edge whose sloped face is
 * the chamfer plane, with the other two faces a hair outside the part so the subtraction
 * leaves no skin. In the local frame of the part.
 */
export function chamferWedge(c: Extract<Cut, { kind: 'chamfer' }>, d: Vec3): THREE.BufferGeometry {
  const e = 0.02;
  const along = c.edge === 'front' || c.edge === 'back' ? 0 : 1; // the axis the edge runs on
  const across = along ? 0 : 1; // from the edge in, across the face
  const inU = c.edge === 'front' || c.edge === 'endA' ? 1 : -1; // inward sign across
  const inV = c.face === 'top' ? -1 : 1; // inward sign through the thickness
  const u0 = (-inU * d[across]) / 2; // the edge's coordinate across
  const v0 = (-inV * d[2]) / 2; // the face's coordinate
  // The profile: the outer corner pushed out, and the chamfer line extended past both faces.
  const profile: [number, number][] = [
    [u0 - inU * e, v0 - inV * e],
    [u0 + inU * (c.width + (e * c.width) / c.depth), v0 - inV * e],
    [u0 - inU * e, v0 + inV * (c.depth + (e * c.depth) / c.width)],
  ];
  const corners: Vec3[] = [];
  for (const a of [-d[along] / 2 - e, d[along] / 2 + e])
    for (const [u, v] of profile) {
      const p: Vec3 = [0, 0, v];
      p[along] = a;
      p[across] = u;
      corners.push(p);
    }
  return convexSolid(corners, [
    [0, 1, 2],
    [3, 4, 5],
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [2, 0, 3, 5],
  ]);
}

const csg = new Evaluator();
csg.useGroups = false;
// Parts carry no textures, and the solids built here have no uv attribute to carry.
csg.attributes = ['position', 'normal'];

/** The solid a cut removes, in the part's local frame: its box, or a chamfer's wedge. */
function cutTool(c: Cut, d: Vec3): THREE.BufferGeometry | null {
  const box = cutBox(c, d);
  if (!box) return null;
  if (c.kind === 'chamfer') return chamferWedge(c, d);
  return new THREE.BoxGeometry(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ).translate(
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  );
}

/** Take each cut out of the part's solid. */
function subtractCuts(base: THREE.BufferGeometry, p: Part, d: Vec3): THREE.BufferGeometry {
  let brush = new Brush(base);
  brush.updateMatrixWorld();
  for (const c of cutsOf(p)) {
    const geo = cutTool(c, d);
    if (!geo) continue;
    const tool = new Brush(geo);
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
 * A box, or for a board with angled ends or edges the solid between its cut planes. A
 * reference cylinder is round: its diameter across X and Y, standing on end along Z.
 */
export function partGeometry(p: Part, d: Vec3): THREE.BufferGeometry {
  if (isCylinderPart(p))
    return new THREE.CylinderGeometry(d[0] / 2, d[0] / 2, d[2], 48).rotateX(Math.PI / 2);
  const corners = localCorners(p, d);
  const geo = corners ? hexahedron(corners) : new THREE.BoxGeometry(d[0], d[1], d[2]);
  return cutsOf(p).length && !stockById(p.stock).sheet ? subtractCuts(geo, p, d) : geo;
}

/** The outline drawn over a part: every edge of a box, only the rims of a cylinder. */
export function partEdges(p: Part, geo: THREE.BufferGeometry): THREE.EdgesGeometry {
  return new THREE.EdgesGeometry(geo, isCylinderPart(p) ? 30 : 1);
}
