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
- World Y is up. A part's local frame is length along X, width along Y,
  thickness along Z; the default orientation (`DEFAULT_Q`) lays it flat with its
  width along world Z.
- Rotations are quaternions composed from quarter turns about world axes
  (`makeQ(['x', 'z'])`), so a part's axis-aligned bounding box is exact and is
  used for snapping, resizing (keep the min corner) and the overall size.

## File format

`Store.toDocument()` writes `{ version: 1, parts, stockLen, prices }`.
`parseDocument` validates the shape before loading. Bump `version` and add a
migration in `parseDocument` when the part shape changes.

## Tooling

Vite builds and serves; TypeScript strict mode with `noUncheckedIndexedAccess`;
Vitest for the pure modules; ESLint and Prettier with their recommended
defaults; `.githooks/pre-commit` runs all of it (`git config core.hooksPath
.githooks` once per clone). `npm run check` is the same set by hand.
