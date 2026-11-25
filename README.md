# Lumber

Build it from the stock you buy. A single-page 3D planner for projects made of
construction lumber and sheet goods: drag a 2x4 or a sheet of plywood into the
scene, cut it to length, snap it against the other parts, and read the cut list,
board and sheet layouts, and a cost estimate off the side panel as you go.

Every part is a piece of stock, so there is no geometry kernel. The model is a
list of boxes.

## Run it

It is one file, `lumber.html`, loading three.js from a CDN. Open it through any
static server, for example:

    python -m http.server 8765

then visit http://localhost:8765/lumber.html.

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
