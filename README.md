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

The keys follow Blender, and the world is Z-up like Blender: X runs left to
right, −Y is the front, Z is up.

| Keys                               | What                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| Right-click                        | Menu with every action for the part, selection or scene             |
| Click, Shift+click, drag on empty  | Select, extend the selection, box select                            |
| A, Alt+A                           | Select all, select none                                             |
| G                                  | Grab: the selection follows the mouse on the floor plane            |
| X / Y / Z during a grab            | Move along that axis only; Shift+X / Y / Z: in the plane without it |
| Type a length during a grab, Enter | Move exactly that far (`16`, `3/4`, `2'6`)                          |
| Enter / click, Esc / right-click   | Confirm or cancel a transform                                       |
| R then X / Y / Z                   | Quarter turn about that axis; Shift reverses                        |
| S then a length, Enter             | Set the cut length                                                  |
| Shift+A                            | Add stock at the pointer                                            |
| Shift+D                            | Duplicate and grab the copy; Ctrl+D duplicates with an offset       |
| Array (Part panel)                 | Stamp N copies along an axis, spaced on center or by a clear gap    |
| Ctrl+G, Ctrl+Shift+G               | Group the selection into an assembly, ungroup                       |
| Double-click a part                | Select just that part inside its group                              |
| Alt+G                              | Drop onto the floor or the parts beneath                            |
| H, Alt+H                           | Hide the selection, show everything                                 |
| X or Delete                        | Delete                                                              |
| Ctrl+Z, Ctrl+Shift+Z               | Undo, redo                                                          |
| Ctrl+S, Ctrl+O                     | Save, open                                                          |
| Middle-drag, Shift+middle, wheel   | Orbit, pan, zoom (right-drag also pans)                             |
| Numpad 1 / 3 / 7, with Ctrl        | Front / right / top, back / left / bottom (top-row digits too)      |
| Numpad 5                           | Perspective or orthographic; axis views are ortho, orbiting returns |
| Numpad 2 / 4 / 6 / 8               | Orbit in 15° steps                                                  |
| Numpad . , Home                    | Frame the selection, fit the model                                  |
| N, T, Tab                          | Toggle the side panel, the palette, both                            |
| Up / Down in a length field        | Step by the grid; Shift 1", Ctrl 1/16"                              |
| Arrows, PgUp / PgDn                | Nudge by the grid step                                              |

Groups are assemblies: clicking any part in the view selects the whole
group, double-click picks the single part, groups nest, and duplicating a
whole group makes a new group. The Parts list shows groups as expandable
nodes, then loose parts grouped by
stock: click to select, Shift+click to extend, double-click (or F2) to rename,
and the eye to hide or show. Hovering a row highlights the part.

You can also drag a part's body to slide it on the floor, or drag the gizmo's
arrows and squares. Drag stock in from the left, or click it to add at the
center. With several parts selected, the Align buttons make them flush or
centred on any axis. Sizes accept fractions and feet.

Models autosave in the browser and can be saved and opened as JSON; files from
the earlier Y-up version are converted on open. The cut list exports to CSV and
prints.
