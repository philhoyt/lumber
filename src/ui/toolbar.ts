/**
 * The tool strip: actions on the selection at the top, views at the bottom. Every
 * button mirrors a key, shown in its tooltip; buttons that need a selection disable
 * without one.
 */
import {
  ArrowDownToLine,
  Axis3d,
  Boxes,
  CircleHelp,
  Copy,
  EyeOff,
  Grid3x3,
  Maximize,
  Move3d,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  RotateCw,
  Ruler,
  Scan,
  Square,
  Trash2,
  Ungroup,
} from 'lucide';
import type { LumberScene } from '../scene';
import type { Store } from '../store';
import { iconButton } from './icons';

export interface ToolbarActions {
  togglePalette(): void;
  focusArray(): void;
  showHelp(): void;
}

export function buildToolbar(
  el: HTMLElement,
  store: Store,
  scene: LumberScene,
  actions: ToolbarActions,
): void {
  const sep = () => {
    const s = document.createElement('span');
    s.className = 'sep';
    return s;
  };
  const needsSelection: HTMLButtonElement[] = [];
  const need = (b: HTMLButtonElement) => {
    needsSelection.push(b);
    return b;
  };

  const add = iconButton(Plus, 'Add stock (Shift+A, or open the palette)', actions.togglePalette);
  const grab = need(iconButton(Move3d, 'Grab (G)', () => scene.beginGrab()));
  const rotate = need(iconButton(RotateCw, 'Rotate (R)', () => scene.beginRotate()));
  const length = need(iconButton(Ruler, 'Set length (S)', () => scene.beginSize()));
  const dup = need(
    iconButton(Copy, 'Duplicate and grab (Shift+D)', () => scene.duplicateAndGrab()),
  );
  const array = need(iconButton(Grid3x3, 'Array', actions.focusArray));
  const group = need(iconButton(Boxes, 'Group (Ctrl+G)', () => store.groupSelected()));
  const ungroup = need(
    iconButton(Ungroup, 'Ungroup (Ctrl+Shift+G)', () => store.ungroupSelected()),
  );
  const drop = need(
    iconButton(ArrowDownToLine, 'Drop onto what is below (Alt+G)', () => store.dropSelected()),
  );
  const hide = need(iconButton(EyeOff, 'Hide (H) · Alt+H shows all', () => store.hideSelected()));
  const del = need(iconButton(Trash2, 'Delete (X)', () => store.deleteSelected(), 'danger'));

  const iso = iconButton(Axis3d, 'Isometric view', () => scene.setView('iso'));
  const top = iconButton(Square, 'Top view (7) · Ctrl for bottom', () => scene.setView('top'));
  const front = iconButton(RectangleHorizontal, 'Front view (1) · Ctrl for back', () =>
    scene.setView('front'),
  );
  const right = iconButton(RectangleVertical, 'Right view (3) · Ctrl for left', () =>
    scene.setView('right'),
  );
  const fit = iconButton(Maximize, 'Fit the model (Home) · . frames the selection', () =>
    scene.setView('fit'),
  );
  const proj = iconButton(Scan, 'Perspective / orthographic (5)', () => scene.toggleProjection());
  const help = iconButton(CircleHelp, 'All keys (?)', actions.showHelp);
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const spacer2 = document.createElement('span');
  spacer2.className = 'spacer';

  el.append(
    add,
    sep(),
    grab,
    rotate,
    length,
    sep(),
    dup,
    array,
    group,
    ungroup,
    drop,
    hide,
    del,
    spacer,
    iso,
    top,
    front,
    right,
    fit,
    proj,
    spacer2,
    help,
  );

  const refresh = () => {
    const n = store.selected.size;
    for (const b of needsSelection) b.disabled = n === 0;
    const inGroup = store.selectedParts().some((p) => p.group !== undefined);
    group.hidden = !(n > 1 && !store.selectedGroup());
    ungroup.hidden = !inGroup;
    if (n === 1) group.hidden = true;
  };
  store.subscribe((kind) => {
    if (kind !== 'drag') refresh();
  });
  refresh();
  scene.onProjectionChange = (mode) => {
    proj.classList.toggle('on', mode === 'ortho');
    proj.title =
      mode === 'ortho' ? 'Orthographic · 5 for perspective' : 'Perspective · 5 for orthographic';
  };
}
