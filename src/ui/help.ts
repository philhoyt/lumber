/** The key reference, shown as an overlay with ? or the toolbar's help button. */
import { X } from 'lucide';
import { icon } from './icons';

const SECTIONS: [string, [string, string][]][] = [
  [
    'Select',
    [
      ['Click', 'Select a part, or its whole assembly'],
      ['Double-click', 'Select just that part inside a group'],
      ['Shift+click', 'Add or remove from the selection'],
      ['Drag on empty space', 'Box select (Shift adds)'],
      ['A / Alt+A', 'Select all / none'],
      ['Right-click', 'Menu for the selection or the scene'],
    ],
  ],
  [
    'Transform',
    [
      ['G', 'Grab: follows the mouse on the floor'],
      ['X / Y / Z while grabbing', 'Move along one axis'],
      ['Shift+X / Y / Z', 'Move in the plane without that axis'],
      ['Type a length, Enter', "Move exactly that far (16, 3/4, 2'6)"],
      ['R then X / Y / Z', 'Quarter turn; Shift reverses; or drag a ring'],
      ['S then a length', 'Set the cut length'],
      ['Enter / click · Esc / right-click', 'Confirm · cancel'],
      ['Arrows, PgUp / PgDn', 'Nudge by the grid step'],
      ['Alt+G', 'Drop onto the floor or the parts below'],
      ['Ctrl+M then X / Y / Z', 'Mirror across that axis through the centre'],
    ],
  ],
  [
    'Edit',
    [
      ['Shift+A', 'Add stock at the pointer'],
      ['Shift+D', 'Duplicate and grab the copy'],
      ['Ctrl+D', 'Duplicate with an offset'],
      ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
      ['F', 'Fastener markers: click a face to place one, a marker to remove it'],
      ['H / Alt+H', 'Hide / show all'],
      ['X or Delete', 'Delete'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Ctrl+S / Ctrl+O', 'Save / open'],
      ['Up / Down in a length field', 'Step by the grid; Shift 1", Ctrl 1/16"'],
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
      ['1 / 3 / 7', 'Front / right / top; Ctrl for the opposite'],
      ['2 / 4 / 6 / 8', 'Orbit in 15° steps'],
      ['5', 'Perspective / orthographic'],
      ['. / Home', 'Frame the selection / fit the model'],
      ['E', 'Exploded view: pull the parts apart; drag the slider; E collapses'],
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
