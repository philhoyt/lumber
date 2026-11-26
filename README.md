# Lumber

Build it from the stock you buy. A 3D planner for projects made of construction
lumber and sheet goods: drag a 2x4 or a sheet of plywood into the scene, cut it
to length and snap it against the other parts. The side panel keeps the cut
list, the sheet layouts and the cost current as you work.

Every part is a piece of stock, so there is no geometry kernel. The model is a
list of boxes. [ARCHITECTURE.md](ARCHITECTURE.md) explains how the pieces fit.

## Run it

The app runs at <https://philhoyt.github.io/lumber/>. GitHub Actions publishes
each push to `main` that passes the checks. To run it yourself, with Node 20 or
later:

    npm install
    npm run dev          # http://localhost:5173

`npm run build` writes a static site to `dist/` that runs from any file host.
It bundles three.js, so it works offline.

## Develop

    npm run check        # typecheck, lint, format check, unit tests, build, e2e
    npm run test:watch   # unit tests on save
    npm run test:e2e     # Playwright over the sample bench (starts the dev server)
    npm run test:coverage
    npm run format       # apply Prettier

Enable the pre-commit hook once per clone. It runs everything in `check` except
the end-to-end tests before each commit:

    git config core.hooksPath .githooks

## Shop drawings

The drawings button in the header opens printable shop drawings: front, right and top
views of the whole model with its overall dimensions, then a sheet per unique part with
its face and edge views, length, width, thickness, miter angles, joinery and fastener
marks, and a hardware list. The drawings use the model's exact sizes, so what is on the
page is what you cut. Print sends the drawings alone to the printer.

## Controls

The keys follow Blender, and the world is Z-up like Blender: X runs left to
right, −Y is the front, Z is up.

The tool strip on the left holds the same actions as buttons, with the key in
each tooltip, and the view presets below them. T shows or hides the stock
palette, N the side panel with its Parts and Cut list tabs and the properties
sections. ? opens the full key reference. The sun/moon button switches the
theme.

| Keys                               | What                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Right-click                        | Menu with the actions for the part, selection or scene                    |
| Click, Shift+click, drag on empty  | Select, extend the selection, box select                                  |
| A, Alt+A                           | Select all, select none                                                   |
| G                                  | Grab: the selection follows the mouse on the floor plane                  |
| X / Y / Z during a grab            | Move along that axis only; Shift+X / Y / Z: in the plane without it       |
| Type a length during a grab, Enter | Move that far (`16`, `3/4`, `2'6`)                                        |
| Enter / click, Esc / right-click   | Confirm or cancel a transform                                             |
| R then X / Y / Z                   | Quarter turn; Shift reverses; type an angle after the axis (R X 15 Enter) |
| Drag a ring while rotating         | Turn in 15° steps, Ctrl for 1°; the Part panel shows and sets angles      |
| S, move the mouse or type, Enter   | Scale the cut length with the mouse (grid steps) or set it by number      |
| Drag a handle at a part's end      | Pull that end to meet another part; the end snaps to faces                |
| Fit end A / B (Part panel)         | Cut the end to meet what it points at: miter, bevel and length            |
| Shift+A                            | Add stock at the pointer                                                  |
| Shift+D                            | Duplicate and grab the copy; Ctrl+D duplicates with an offset             |
| Array (Part panel)                 | A live array: count or fit-to-length, on center or by gap; Apply bakes it |
| Ctrl+G, Ctrl+Shift+G               | Group the selection into an assembly, ungroup                             |
| Double-click a part                | Select that one part inside its group                                     |
| Alt+G                              | Drop onto the floor or the parts beneath                                  |
| Ctrl+M then X / Y / Z              | Mirror across that axis through the selection's centre                    |
| F                                  | Fastener markers: click a face to place one, a marker to remove it        |
| H, Alt+H                           | Hide the selection, show everything                                       |
| X or Delete                        | Delete                                                                    |
| Ctrl+Z, Ctrl+Shift+Z               | Undo, redo                                                                |
| Ctrl+S, Ctrl+O                     | Save, open                                                                |
| Middle-drag, Shift+middle, wheel   | Orbit, pan, zoom (right-drag pans too)                                    |
| Alt+drag                           | Orbit without a middle button; Shift+Alt pans, Ctrl+Alt zooms             |
| Trackpad switch (header)           | Two-finger drag orbits, pinch zooms, Shift+two-finger pans                |
| Corner gizmo                       | Click an axis to look along it, again for the other side; drag orbits     |
| Numpad 1 / 3 / 7, with Ctrl        | Front / right / top, back / left / bottom (top-row digits too)            |
| Numpad 9                           | Look from the opposite side                                               |
| Numpad 5                           | Perspective or orthographic; axis views are ortho, orbiting returns       |
| E                                  | Exploded view: pull the parts apart to look; slider sets how far          |
| Shift+E, [ / ]                     | Assembly steps: walk the build; the Part panel sets each part's step      |
| Numpad 2 / 4 / 6 / 8, with Ctrl    | Orbit in 15° steps, pan                                                   |
| Numpad + / -                       | Zoom in, out                                                              |
| Numpad . , Home                    | Frame the selection, fit the model                                        |
| D                                  | Dimension labels on each part and the selection's W × D × H               |
| M                                  | Measure: click two points (snaps to corners, edges, faces); Esc           |
| N, T, Tab                          | Toggle the side panel, the palette, both                                  |
| Drag the view's edges              | Resize the palette and side panel; double-click resets; remembered        |
| Up / Down in a length field        | Step by the grid; Shift 1", Ctrl 1/16"                                    |
| Drag a field's label               | Scrub the value with the same steps; Alt-drag the field itself            |
| Esc in a field                     | Put back the value it had and leave the field                             |
| Arithmetic in a length field       | 48 - 3/4, (96 - 2 * 1.5) / 3, 2 ft + 3 1/2; a spaced slash divides        |
| Arrows, PgUp / PgDn                | Nudge by the grid step                                                    |

Groups are assemblies: clicking any part in the view selects the whole
group, double-click picks the single part, groups nest, and duplicating a
whole group makes a new group. The Parts list shows groups as expandable
nodes, then loose parts grouped by
stock: click to select, Shift+click to extend, double-click (or F2) to rename,
and the eye to hide or show. Hovering a row highlights the part.

You can drag a part's body to slide it on the floor, or drag the gizmo's
arrows and squares. Drag stock in from the left, or click it to add at the
center. With several parts selected, the Align buttons make them flush or
centred on any axis. Length fields take fractions, feet and inches, millimetres
and arithmetic: `48 - 3/4`, `(96 - 2 * 1.5) / 3`, `2 ft + 3 1/2`. A slash with no spaces
is a fraction (`3/4`, `1-1/2`); with spaces around it, it divides (`48 / 3`).

The buy list shows board feet: each board stock lists the board feet in its parts
and in what you buy, using the nominal size (2x4 is 2 × 4; the stock table has
a Nominal column for anything the name does not say), and the total sums lumber
in board feet and sheet goods in square feet. You can price a stock per board
foot instead of per piece, for hardwood. The purchase length defaults to Auto,
which buys the least total length.

Sheet nesting is guillotine: each cut runs edge to edge across the piece it
splits, as on a table saw, and each sheet diagram numbers the cuts in order.
The nester tries three part orders and keeps the one that uses the fewest sheets.

You can tell a sheet part which way its length runs relative to the grain
(Either way, Along the length, Across the length). The nester turns a part
the ways you allow and no other, the cut list marks the direction, and the
diagrams draw grain lines the long way of the sheet. MDF and OSB have no grain,
which the stock table's Grain tick controls.

Boards can carry joinery: Add cut in the Part section adds a dado (across the
width), groove (along the length), rabbet (along an end or edge) or notch
(through the thickness into an edge), each with its face or edge, position,
width and depth. The 3D view subtracts them and the cut list prints them under
the cut.

Boards can have a miter at each end: two angle fields in the Part section,
degrees from square, cut across the width, positive for a short point on the
back edge. Bevels are the same across the thickness, positive for a short point
on the top face, and an end with both is a compound cut. The length stays long
point to long point; the cut list prints the angles, the short-point length and
the saw's compound settings, and the 3D view and drawings show the angled ends.
Fit end A or B cuts that end to lie flat on the part or the floor it points at,
an angled kicker meeting the slab say, and brings its long point to touch.

The stock table is yours to edit: the gear button in the palette opens it. Change
sizes, purchase lengths, prices and colors, add custom boards or sheets, delete
unused ones, or reset to the defaults. Type metric sizes as `38mm`. The model
file carries the table.

Projects live in the browser: each change saves to the current project a
moment later, and the status bar says Saved. Click the project name in the
header to rename it. Ctrl+O opens the Projects dialog to open, create, duplicate,
rename, delete or import a JSON file; Ctrl+S exports the current project as
JSON. The link button in the header copies a share link: the whole project
compressed into the address, and nothing leaves your browser. Whoever opens it
gets a copy as a new project. In Chrome or Edge the Projects dialog can link a
folder on disk: the app then writes each project there as its own .json file
whenever it saves, moves the file when you rename, and imports JSON files it
finds in the folder as projects. Opening a file from the earlier Y-up version
converts it. The cut list exports to CSV and prints.
