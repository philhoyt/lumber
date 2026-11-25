/**
 * The geometry of one part: a box, or for a mitered board its outline extruded through
 * the thickness, with each cut's box taken out of the solid.
 */
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { fastenersKey, fastenersOf } from '../fastener';
import {
  cutBox,
  cutsKey,
  cutsOf,
  hasMiter,
  miterOf,
  miterOutline,
  type Part,
  type Vec3,
} from '../model';
import { stockById } from '../stock';

/** Everything the mesh depends on; when it changes, the mesh is rebuilt. */
export const meshSignature = (p: Part, d: Vec3): string =>
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
export function partGeometry(p: Part, d: Vec3): THREE.BufferGeometry {
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
