/** The key reference, shown as an overlay with ? or the toolbar's help button. */
import { X } from 'lucide';
import { icon } from './icons';

const SECTIONS: [string, [string, string][]][] = [
  [
    'Select',
    [
      ['Click', 'Select a part, or its whole assembly'],
      ['Double-click', 'Select just that part inside a group'],
      ['Shift+click', 'Add or remove from the selection (a group as one)'],
      ['Ctrl+click', 'Toggle the one part, even inside a group; in the list, Shift selects a run'],
      ['Drag on empty space', 'Box select (Shift adds)'],
      ['A / Alt+A', 'Select all / none'],
      ['Right-click', 'Menu for the selection or the scene'],
      ['Right-click a Parts-list row', 'Rename, frame, hide others, group, and the rest'],
      [
        'Drag a Parts-list row',
        'Onto a group to join it, onto a loose part to group, off to leave',
      ],
    ],
  ],
  [
    'Transform',
    [
      ['G', 'Grab: follows the mouse on the floor'],
      ['X / Y / Z while grabbing', "Move along one axis; again for the part's own axis"],
      ['Shift+X / Y / Z', 'Move in the plane without that axis'],
      ['Type a length, Enter', "Move exactly that far (16, 3/4, 2'6, 48 - 3/4)"],
      [
        'R then X / Y / Z',
        'Quarter turn; Shift reverses; type an angle after the axis (R X 15 Enter)',
      ],
      [
        'Drag a ring while rotating',
        '15° steps; Ctrl for 1°; the Part panel shows and sets angles',
      ],
      ['P while rotating', 'Cycle the pivot: the centre, then each bottom corner; Shift+P back'],
      ['S', 'Scale the length with the mouse (grid steps), or type a length; Enter'],
      [
        'Shift+R, then drag',
        'Array: copies fill toward the pointer at the Part panel spacing (16" o.c.); Enter',
      ],
      [
        'X / Y / Z while arraying',
        "Lock the axis (twice: the part's own); type a count or a length",
      ],
      ["Drag a handle at a part's end", 'Pull that end to meet another part; it snaps to faces'],
      [
        'Fit end A / B (Part panel)',
        'Cut the end to meet the part or floor it points at: miter, bevel, length',
      ],
      ['Enter / click · Esc / right-click', 'Confirm · cancel'],
      ['Arrows, PgUp / PgDn', 'Nudge by the grid step'],
      ['Alt + hover another part', 'Distance from the selection to it: gap, on centre, straight'],
      ['Alt+G', 'Drop onto the floor or the parts below'],
      ['C, then click two parts', 'Center the selection in the gap between them; Esc'],
      ['Shift+C, then click two parts', 'Space the selected pieces evenly between them'],
      ['B, two parallel parts selected', 'A block between them: cut to the gap, flush, at the end'],
      ['Ctrl+M then X / Y / Z', 'Mirror across that axis through the centre'],
    ],
  ],
  [
    'Edit',
    [
      ['Shift+A', 'Add stock at the pointer: recent first, then 1x, 2x, 4x and sheets'],
      ['Shift+D', 'Duplicate and grab the copy'],
      ['Ctrl+D', 'Duplicate with an offset'],
      ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
      ['F', 'Fastener markers: click a face to place one, a marker to remove it'],
      ['H / Alt+H', 'Hide / show all'],
      ['X or Delete', 'Delete'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Ctrl+S / Ctrl+O', 'Save / open'],
      ['Up / Down in a length field', 'Step by the grid; Shift 1", Ctrl 1/16"'],
      ["Drag a field's label", 'Scrub the value with the same steps; Alt-drag the field itself'],
      ['Esc in a field', 'Put back the value it had and leave the field'],
      ["Drag the view's edges", 'Resize the palette and side panel; double-click resets'],
      ['Arithmetic in a length field', '48 - 3/4, (96 - 2 * 1.5) / 3, 2 ft + 3 1/2'],
      ['+1/2, -1/2, *2 in a field', 'Change what is there; with several parts selected, each one'],
    ],
  ],
  [
    'View',
    [
      ['Middle-drag', 'Orbit'],
      ['Shift+middle-drag, right-drag', 'Pan'],
      ['Wheel', 'Zoom'],
      ['Alt+drag', 'Orbit without a middle button; Shift+Alt pans, Ctrl+Alt zooms'],
      ['Trackpad switch', 'Two-finger drag orbits, pinch zooms, Shift+two-finger pans'],
      ['Corner gizmo', 'Click an axis to look along it, again for the other side; drag to orbit'],
      ['1 / 3 / 7', 'Front / right / top; Ctrl for the opposite'],
      ['9', 'Look from the opposite side'],
      ['2 / 4 / 6 / 8', 'Orbit in 15° steps; Ctrl pans'],
      ['+ / -', 'Zoom in / out'],
      ['5', 'Perspective / orthographic'],
      ['. / Home', 'Frame the selection / fit the model'],
      ['E', 'Exploded view: pull the parts apart; drag the slider; E collapses'],
      [
        'Shift+E, [ / ]',
        'Assembly steps: walk the build one step at a time (set steps in the Part panel)',
      ],
      ['D', 'Dimension labels and selection extents'],
      ['M', 'Measure: click two points; Esc ends'],
      ['N / T / Tab', 'Side panel / palette / both'],
      ['?', 'This list'],
    ],
  ],
];

export class HelpOverlay {
  constructor(private el: HTMLElement) {
    const box = document.createElement('div');
    box.className = 'help';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Keyboard reference');
    const h = document.createElement('h2');
    h.append('Keys');
    const sp = document.createElement('span');
    sp.className = 'spacer';
    const close = document.createElement('button');
    close.className = 'icon ghost';
    close.title = 'Close (Esc)';
    close.appendChild(icon(X));
    close.addEventListener('click', () => this.hide());
    h.append(sp, close);
    const cols = document.createElement('div');
    cols.className = 'cols';
    for (const [title, keys] of SECTIONS) {
      const col = document.createElement('div');
      const t = document.createElement('h3');
      t.textContent = title;
      col.appendChild(t);
      for (const [k, what] of keys) {
        const row = document.createElement('div');
        row.className = 'k';
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        const d = document.createElement('span');
        d.textContent = what;
        row.append(kbd, d);
        col.appendChild(row);
      }
      cols.appendChild(col);
    }
    box.append(h, cols);
    el.appendChild(box);
    el.addEventListener('click', (e) => {
      if (e.target === el) this.hide();
    });
  }
  get open(): boolean {
    return !this.el.hidden;
  }
  show(): void {
    this.el.hidden = false;
  }
  hide(): void {
    this.el.hidden = true;
  }
  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }
}
