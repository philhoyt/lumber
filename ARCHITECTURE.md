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
 overlap               parts that run into each other (separating-axis test on frame's corners)
    \     /
    store              state, selection, settings, undo/redo, autosave
    document           the saved file format and its parser/migrator
    /     \
 scene     ui/*        three.js view        DOM panels (palette, props, cutlist, header, status)
    \     /
     main              wires it together
```

Panel fields share one set of behaviours in `ui/fields.ts`: arrow keys step a value,
dragging a field's label scrubs it (the store folds the run into one undo step), and
Escape puts back what the field held. A field reads its text through `parseLenEdit`
in `units.ts`, so a leading operator changes the value in place and a Mixed field
can be edited for every selected part at once. The properties panel (`ui/props.ts`)
builds its numeric fields with `inlineField`, label inside the box, and keeps the
selection's actions in a sticky header above the sections.

The scene keeps the interaction (picking, the modal transforms, box select,
the pointer and key handlers) and delegates the rest to `view/`:

- `view/camera.ts` `CameraRig`: the perspective and orthographic cameras on
  one orbit, the named views, Blender's view keys and auto-perspective, and
  the Alt+drag and trackpad gestures. The scene exposes it as `rig`, which
  the header's view keys, the menus and the corner gizmo drive directly.
- `view/snapFeedback.ts`: the quads over the faces a grab snapped to.
- `view/dimLabels.ts`, `view/measureTool.ts`, `view/fastenMode.ts`: the D, M
  and F tools, each owning its own overlay objects and HTML labels.
- `view/partMesh.ts`: a part's geometry (box, or the solid between angled end and edge planes, cuts subtracted)
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
- Rotations are quaternions. Quarter turns about world axes (`makeQ(['x', 'z'])`,
  R then an axis) are the default and keep a part's axis-aligned bounding box
  exact. Any angle is allowed too (`rotatePartsBy`: R X 15, a ring drag, the
  angle fields), for braces, kickers and tilted panels; an angled part's box is
  then the bounds of its tilted box, and snapping, aligning, dropping and the
  overall size work on that. `squareUp` snaps back to the nearest quarter
  turns. Measuring snaps to the part's real corners either way.

## Transforms

`view/transform.ts` `TransformController` runs one `Transform` at a time: a grab
(from G, the gizmo or a part's body), a rotate (R), a size (S or an end handle) or
an array drag (Shift+R). The scene owns it, hands it the pointer and key events
while one is live, and asks it for the drag label's text and the rotate rings'
pivot. A grab has a constraint, either one axis or
a plane, and converts the mouse ray into a delta along it; changing the
constraint mid-drag re-anchors so the parts do not jump. Typed digits are kept
on the transform and applied on Enter. Confirm commits the pre-transform
snapshot to the store; cancel restores it; a transform that changed nothing (a
click that only selected, R then Enter) touches neither. A model or selection
change the transform did not make, such as a project load or a panel edit, drops
the transform outright, since its snapshot no longer describes the model.

## Reference boxes

Stock with `reference: true` (`ref`, the box, and `refcyl`, the cylinder, both always
present in a model's stock table) is a stand-in with a per-part height (`Part.t`). A
cylinder (`shape: 'cylinder'`) stands on end with `len` as its diameter, so its box is
`len × len × t` and every box-based tool (snapping, gaps, arrays) sees that box; only
the mesh is round. The cut rows, stock grouping, drawing rows and model views skip
reference parts, the status bar counts them apart, and the view draws them translucent.
Everything else, moving, snapping, grouping, treats them as parts.

## Local frames

`frame.ts` is the geometry of a part's own axes: the world direction of a local axis,
a part's box expressed in another part's frame, extents along a direction, whether two
parts share a frame (their axes line up, quarter turns aside), and the fit of a block
between two parallel parts. The scene uses it for moves and array drags along a local
axis (an axis key tapped twice, or the gizmo on a tilted part), snapping those moves
to co-framed parts in that frame, and the store for local arrays and `addBlockBetween`.

`overlap.ts` finds parts that share space: a bounding-box pass, then the separating-axis
test on the two solids' corners from `frame.ts`, so tilted boxes and angled ends are
judged exactly and touching faces (within 1/32") do not count. A part whose share of
another's box lies inside one of its pocket cuts is left alone, and so are reference
stand-ins. The store computes the
report once per model change or drag and hands it to the view (red parts), the status
bar (a count that selects them) and the Part section (what a part runs into).

## Groups and arrays

Shift+R arrays by dragging: `arrayDrag.ts` turns a drag distance along an axis into
array parameters (a count while dragging, the span filled once done, `reverse` when
the drag went the negative way), and the scene applies them through `Store.setArray`
inside a coalesced undo step, so the copies appear live and undo as one change.

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
