import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { axisParam } from './gizmo';

describe('axisParam', () => {
  const origin = new Vector3(0, 0, 0);
  const x = new Vector3(1, 0, 0);

  it('finds the point on the axis nearest a ray that crosses it', () => {
    // A ray from above, pointing straight down through x = 7.
    const ray = new Ray(new Vector3(7, 10, 0), new Vector3(0, -1, 0));
    expect(axisParam(origin, x, ray)).toBeCloseTo(7);
  });

  it('works for a ray that misses the axis', () => {
    // Ray passes 3 units in front of the axis at x = 4.
    const ray = new Ray(new Vector3(4, 10, 3), new Vector3(0, -1, 0));
    expect(axisParam(origin, x, ray)).toBeCloseTo(4);
  });

  it('handles an oblique ray', () => {
    const dir = new Vector3(-1, -1, 0).normalize();
    const ray = new Ray(new Vector3(10, 5, 0), dir);
    // The ray hits y = 0 at x = 5.
    expect(axisParam(origin, x, ray)).toBeCloseTo(5);
  });

  it('is measured from the given origin', () => {
    const ray = new Ray(new Vector3(7, 10, 0), new Vector3(0, -1, 0));
    expect(axisParam(new Vector3(2, 0, 0), x, ray)).toBeCloseTo(5);
  });

  it('returns 0 when the ray runs along the axis', () => {
    const ray = new Ray(new Vector3(-10, 0, 0), new Vector3(1, 0, 0));
    expect(axisParam(origin, x, ray)).toBe(0);
  });
});
