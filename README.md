# Lumber

Build it from the stock you buy. A 3D planner for projects made of construction
lumber and sheet goods: drag a 2x4 or a sheet of plywood into the scene, cut it
to length, snap it against the other parts, and read the cut list, board and
sheet layouts, and a cost estimate off the side panel as you go.

Every part is a piece of stock, so there is no geometry kernel. The model is a
list of boxes. See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.

## Run it

Needs Node 20 or later.

    npm install
    npm run dev          # http://localhost:5173

`npm run build` writes a static site to `dist/` that runs from any file host,
with three.js bundled in so it works offline.

## Develop

    npm run check        # typecheck, lint, format check, tests
    npm run test:watch   # tests on save
    npm run format       # apply Prettier

Enable the pre-commit hook once per clone so `check` runs before every commit:

    git config core.hooksPath .githooks

## Controls

- Drag stock in from the left, or click it to add at the center.
- Left-drag a part to move it on the floor. Shift+drag moves it up and down.
- R / T / F rotate 90 degrees about the up, side and front axes.
- Arrows and PgUp/PgDn nudge by the grid step. Ctrl+click multi-selects.
- Ctrl+D duplicates. Array stamps copies at a spacing. Del deletes.
- Ctrl+Z / Ctrl+Y undo and redo. Tab hides the side panels.
- Sizes accept fractions and feet: `33 1/4`, `2'6 1/2`, `3/4`, `38mm`.

Models autosave in the browser and can be saved and opened as JSON. The cut
list exports to CSV and prints.
