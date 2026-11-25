/**
 * Translucent quads over the faces a grab snapped to (or its footprint on the floor).
 * They flash when the target changes, so a new snap reads as an event.
 */
import * as THREE from 'three';
import type { AABB, AxisIndex, Vec3 } from '../model';
import { snapQuads, type SnapHit } from '../snap';

export class SnapFeedback {
  private quads: { fill: THREE.Mesh; edge: THREE.LineLoop }[] = [];
  private key = '';
  private flash = 0;

  constructor(private readonly scene: THREE.Scene) {}

  /** The i-th quad, made on first use. */
  private quadAt(i: number): { fill: THREE.Mesh; edge: THREE.LineLoop } {
    while (this.quads.length <= i) {
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
      this.quads.push({ fill, edge });
      this.scene.add(fill, edge);
    }
    return this.quads[i]!;
  }

  /** Lay a quad over every face (or the floor footprint) the hits snapped to. */
  show(hits: readonly SnapHit[], moved: AABB, others: readonly AABB[]): void {
    const quads = hits.flatMap((h) => snapQuads(h, moved, others));
    const key = hits
      .filter((h) => h.kind !== 'grid')
      .map((h) => `${h.axis}:${h.kind}:${h.at}`)
      .join('|');
    if (key !== this.key) {
      this.key = key;
      this.flash = key ? 1 : 0;
    }
    for (let i = 0; i < Math.max(quads.length, this.quads.length); i++) {
      const { fill, edge } = this.quadAt(i);
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

  hide(): void {
    for (const { fill, edge } of this.quads) fill.visible = edge.visible = false;
    this.key = '';
    this.flash = 0;
  }

  /** Once a frame: let the flash fade. */
  tick(): void {
    if (this.flash <= 0.01) return;
    this.flash *= 0.9;
    for (const { fill } of this.quads)
      (fill.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.45 * this.flash;
  }
}
