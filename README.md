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

The tool strip on the left holds the same actions as buttons, with the key in
each tooltip, and the view presets below them. T shows or hides the stock
palette, N the side panel with its Parts and Cut list tabs and the properties
sections. ? opens the full key reference; the sun/moon button switches the
theme.

| Keys                               | What                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Right-click                        | Menu with every action for the part, selection or scene                   |
| Click, Shift+click, drag on empty  | Select, extend the selection, box select                                  |
| A, Alt+A                           | Select all, select none                                                   |
| G                                  | Grab: the selection follows the mouse on the floor plane                  |
| X / Y / Z during a grab            | Move along that axis only; Shift+X / Y / Z: in the plane without it       |
| Type a length during a grab, Enter | Move exactly that far (`16`, `3/4`, `2'6`)                                |
| Enter / click, Esc / right-click   | Confirm or cancel a transform                                             |
| R then X / Y / Z                   | Quarter turn about that axis; Shift reverses                              |
| S then a length, Enter             | Set the cut length                                                        |
| Shift+A                            | Add stock at the pointer                                                  |
| Shift+D                            | Duplicate and grab the copy; Ctrl+D duplicates with an offset             |
| Array (Part panel)                 | A live array: count or fit-to-length, on center or by gap; Apply bakes it |
| Ctrl+G, Ctrl+Shift+G               | Group the selection into an assembly, ungroup                             |
| Double-click a part                | Select just that part inside its group                                    |
| Alt+G                              | Drop onto the floor or the parts beneath                                  |
| H, Alt+H                           | Hide the selection, show everything                                       |
| X or Delete                        | Delete                                                                    |
| Ctrl+Z, Ctrl+Shift+Z               | Undo, redo                                                                |
| Ctrl+S, Ctrl+O                     | Save, open                                                                |
| Middle-drag, Shift+middle, wheel   | Orbit, pan, zoom (right-drag also pans)                                   |
| Numpad 1 / 3 / 7, with Ctrl        | Front / right / top, back / left / bottom (top-row digits too)            |
| Numpad 5                           | Perspective or orthographic; axis views are ortho, orbiting returns       |
| Numpad 2 / 4 / 6 / 8               | Orbit in 15° steps                                                        |
| Numpad . , Home                    | Frame the selection, fit the model                                        |
| N, T, Tab                          | Toggle the side panel, the palette, both                                  |
| Up / Down in a length field        | Step by the grid; Shift 1", Ctrl 1/16"                                    |
| Arrows, PgUp / PgDn                | Nudge by the grid step                                                    |

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

Sheet parts can be told which way their length runs relative to the grain
(Either way, Along the length, Across the length). The sheet nesting only
turns a part the way you allow, the cut list marks the direction, and the
diagrams draw grain lines the long way of the sheet. MDF and OSB have no grain,
which the stock table's Grain tick controls.

Boards can carry joinery: Add cut in the Part section adds a dado (across the
width), groove (along the length), rabbet (along an end or edge) or notch
(through the thickness into an edge), each with its face or edge, position,
width and depth. The 3D view subtracts them and the cut list prints them under
the cut.

Boards can have a miter at each end: two angle fields in the Part section,
degrees from square, cut across the width, positive for a short point on the
back edge. The length stays long point to long point; the cut list prints the
angles and the short-point length, and the 3D view draws the angled ends.

The stock table is yours to edit: the gear button in the palette opens it. Change
sizes, purchase lengths, prices and colors, add custom boards or sheets, delete
unused ones, or reset to the defaults. Metric sizes can be typed as `38mm`. The
table is saved with the model.

Projects live in the browser: every change saves to the current project a
moment later (the status bar says Saved). The project name in the header
renames on click; Ctrl+O opens the Projects dialog to open, create, duplicate,
rename, delete or import a JSON file; Ctrl+S exports the current project as
JSON. In Chrome or Edge the Projects dialog can also link a folder on disk:
every project is then written there as its own .json file whenever it saves,
renames move the file, and JSON files already in the folder can be imported
as projects. Files from the earlier Y-up version are converted on open. The cut list exports to CSV and
prints.
