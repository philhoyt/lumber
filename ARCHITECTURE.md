# Architecture

## The one rule

**Every part is a piece of stock.** A part is a stock id, a cut length (and a cut
width for sheets), a position and a quarter-turn orientation. There is no free
geometry: no push/pull, no booleans, no arbitrary shapes. That is what keeps the
whole tool small, the bounding-box math exact, and the cut list trivially
derivable. Features that need a shape change (miters, dados, notches) should be
added as _attributes on a part_ that render visually and print on the cut list,
not as geometry operations. If that stops being enough, the right move is to use
a real modeler such as Sawhorse, not to grow one here.

## Layers

```
units      stock        pure data and conversions, no dependencies
   \        /
    model              Part, bounding boxes, quarter-turn rotation (uses three's math only)
    /     \
 snap      pack        dragging snaps; cut list and buy list packing
    \     /
    store              state, selection, settings, undo/redo, autosave, file format
    /     \
 scene     ui/*        three.js view        DOM panels (palette, props, cutlist, header, status)
    \     /
     main              wires it together
```

The scene keeps the interaction (picking, the modal transforms, box select,
the pointer and key handlers) and delegates the rest to `view/`:

- `view/camera.ts` `CameraRig`: the perspective and orthographic cameras on
  one orbit, the named views, Blender's view keys and auto-perspective, and
  the Alt+drag and trackpad gestures. The scene forwards its API so the
  panels have one handle.
- `view/snapFeedback.ts`: the quads over the faces a grab snapped to.
- `view/dimLabels.ts`, `view/measureTool.ts`, `view/fastenMode.ts`: the D, M
  and F tools, each owning its own overlay objects and HTML labels.
- `view/partMesh.ts`: a part's geometry (box, miter outline, cuts subtracted)
  and the signature that says when to rebuild it.
- `view/labels.ts`: pinning HTML labels to world points.

Rules of the layering:

- `units`, `stock`, `model`, `snap`, `pack` and `store` never touch the DOM or
  WebGL. They are tested with Vitest in plain Node.
- All changes to parts go through `Store.mutate` (or `commit` after a drag), so
  every change is undoable and autosaved, and every panel hears about it.
- The scene mutates part positions directly _during_ a drag for speed, then hands
  the store the pre-drag snapshot to commit. Nothing else bypasses the store.
- Panels re-render from store state on every notification. They are small
  enough that rebuilding their HTML is simpler than diffing it.

## Coordinates and units

- Inches everywhere internally. `units.ts` parses what people type and formats
  sixteenths for display.
- The world is Z-up, as in Blender: X left-right, −Y the front, Z up. `UP` in
  `model.ts` is the one place that knows which axis index is up.
- A part's local frame is length along X, width along Y, thickness along Z, so
  the identity orientation lies flat on the floor.
- Rotations are quaternions composed from quarter turns about world axes
  (`makeQ(['x', 'z'])`), so a part's axis-aligned bounding box is exact and is
  used for snapping, resizing (keep the min corner) and the overall size.

## Transforms

The scene owns one `Transform` at a time: a grab (from G, the gizmo or a part's
body), a rotate (R) or a size (S). A grab has a constraint, either one axis or
a plane, and converts the mouse ray into a delta along it; changing the
constraint mid-drag re-anchors so the parts do not jump. Typed digits are kept
on the transform and applied on Enter. Confirm commits the pre-transform
snapshot to the store; cancel restores it.

## Groups and arrays

A group is an assembly: parts carry a `group` id and groups may nest through
`parent`. A click in the view selects the whole assembly. An array modifier
is a group with `array` parameters: its source cell (members with
`arrayIndex` 0) is copied along an axis, and `Store.mutate` regenerates the
copies after every change, so the copies are ordinary parts (cut list,
picking, transforms all work) yet always follow the source. Apply drops the
parameters and keeps the parts.

## File format

`Store.toDocument()` writes `{ version: 2, parts, stockLen, prices }`.
`parseDocument` validates the shape before loading and migrates version 1
(Y-up) files with `migrateFromYUp`. Bump `version` and add a migration there
when the part shape changes.

## Tooling

Vite builds and serves; TypeScript strict mode with `noUncheckedIndexedAccess`;
Vitest for the pure modules (`npm run test:coverage` for the report); Playwright
in `e2e/` drives the real app in Chromium over the sample bench for what only
the scene, panels and keyboard together can show (modal transforms, box select,
share links, orbit gestures, the corner gizmo); ESLint with typescript-eslint's
type-checked strict and stylistic sets (`!` after a checked index and arrow
shorthand returning void are house style); Prettier. `.githooks/pre-commit`
runs typecheck, lint, format check, unit tests and the build (`git config
core.hooksPath .githooks` once per clone); `npm run check` adds the end-to-end
tests.
