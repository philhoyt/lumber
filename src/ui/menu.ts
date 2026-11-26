/**
 * The right-click menu: every action on the selection, or on empty space, with Lucide
 * icons and the key beside each item. One level of submenus for stock, align and views.
 */
import {
  AlignHorizontalJustifyStart,
  ArrowDownToLine,
  Boxes,
  Camera,
  ChevronRight,
  Copy,
  createElement,
  Drill,
  Expand,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Grid3x3,
  ListOrdered,
  Maximize,
  Move3d,
  Plus,
  RotateCw,
  Ruler,
  SquareDashedMousePointer,
  Trash2,
  type IconNode,
  Ungroup,
} from 'lucide';
import type { AlignMode, Axis, AxisIndex, Vec3 } from '../model';
import type { MenuContext, ViewName } from '../scene';
import { getStock } from '../stock';
import type { Store } from '../store';

export interface MenuItem {
  label: string;
  key?: string;
  icon?: IconNode;
  action?: () => void;
  children?: MenuItem[];
}

/** What the menu needs from the scene. */
export interface MenuActions {
  beginArray(): void;
  beginGrab(): void;
  beginRotate(): void;
  beginSize(): void;
  duplicateAndGrab(): void;
  setView(name: ViewName): void;
  flipView(): void;
  toggleFasten(): void;
  toggleExplode(): void;
  toggleAssembly(): void;
}

const VIEWS: [ViewName, string, string][] = [
  ['iso', 'Iso', ''],
  ['top', 'Top', '7'],
  ['bottom', 'Bottom', 'Ctrl+7'],
  ['front', 'Front', '1'],
  ['back', 'Back', 'Ctrl+1'],
  ['right', 'Right', '3'],
  ['left', 'Left', 'Ctrl+3'],
  ['fit', 'Fit all', 'Home'],
  ['selected', 'Frame selected', '.'],
];
const MIRROR: [Axis, string][] = [
  ['x', 'Left-right'],
  ['y', 'Front-back'],
  ['z', 'Top-bottom'],
];
const ALIGN: [AxisIndex, AlignMode, string][] = [
  [0, 'min', 'Left'],
  [0, 'center', 'Center X'],
  [0, 'max', 'Right'],
  [1, 'min', 'Front'],
  [1, 'center', 'Center Y'],
  [1, 'max', 'Back'],
  [2, 'min', 'Bottom'],
  [2, 'center', 'Center Z'],
  [2, 'max', 'Top'],
];

/** One item per stock; choosing it adds a full piece resting on the floor at `ground`. */
export function stockItems(ground: Vec3 | null, store: Store): MenuItem[] {
  return getStock().map((s) => ({
    label: s.name,
    action: () => {
      const g = ground ?? [0, 0, 0];
      const grid = store.settings.grid;
      const snap = (v: number) => (grid ? Math.round(v / grid) * grid : v);
      store.addPart(s.id, [snap(g[0]), snap(g[1]), 0] as Vec3);
    },
  }));
}

/** The menu's sections for a right click, as lists separated by rules. */
export function buildMenu(ctx: MenuContext, store: Store, scene: MenuActions): MenuItem[][] {
  const hasSelection = store.selected.size > 0;
  const hidden = store.parts.some((p) => p.hidden);
  const addStock: MenuItem = {
    label: 'Add stock',
    icon: Plus,
    children: stockItems(ctx.ground, store),
  };
  const views: MenuItem = {
    label: 'View',
    icon: Camera,
    children: [
      ...VIEWS.map(([name, label, key]) => ({
        label,
        key,
        action: () => scene.setView(name),
      })),
      { label: 'Opposite side', key: '9', action: () => scene.flipView() },
    ],
  };
  const exploded: MenuItem = {
    label: 'Exploded view',
    key: 'E',
    icon: Expand,
    action: () => scene.toggleExplode(),
  };
  const assembly: MenuItem = {
    label: 'Assembly steps',
    key: 'Shift+E',
    icon: ListOrdered,
    action: () => scene.toggleAssembly(),
  };
  const selectAll: MenuItem = {
    label: 'Select all',
    key: 'A',
    icon: SquareDashedMousePointer,
    action: () => store.selectAll(),
  };
  const showAll: MenuItem = {
    label: 'Show hidden',
    key: 'Alt+H',
    icon: Eye,
    action: () => store.unhideAll(),
  };

  const fasteners: MenuItem = {
    label: 'Fasteners',
    key: 'F',
    icon: Drill,
    action: () => scene.toggleFasten(),
  };
  if (!hasSelection) {
    const first: MenuItem[] = [addStock, selectAll, fasteners];
    if (hidden) first.push(showAll);
    return [
      first,
      [
        views,
        exploded,
        assembly,
        { label: 'Fit all', key: 'Home', icon: Maximize, action: () => scene.setView('fit') },
      ],
    ];
  }

  const edit: MenuItem[] = [
    { label: 'Grab', key: 'G', icon: Move3d, action: () => scene.beginGrab() },
    { label: 'Rotate', key: 'R', icon: RotateCw, action: () => scene.beginRotate() },
    { label: 'Set length', key: 'S', icon: Ruler, action: () => scene.beginSize() },
    fasteners,
  ];
  const arrange: MenuItem[] = [
    { label: 'Duplicate', key: 'Shift+D', icon: Copy, action: () => scene.duplicateAndGrab() },
    {
      label: 'Array by dragging',
      key: 'Shift+R',
      icon: Grid3x3,
      action: () => scene.beginArray(),
    },
    { label: 'Drop', key: 'Alt+G', icon: ArrowDownToLine, action: () => store.dropSelected() },
    {
      label: 'Mirror',
      key: 'Ctrl+M',
      icon: FlipHorizontal2,
      children: MIRROR.map(([axis, label]) => ({
        label,
        key: axis.toUpperCase(),
        action: () => store.mirrorSelected(axis),
      })),
    },
  ];
  if (store.selected.size > 1)
    arrange.splice(2, 0, {
      label: 'Align',
      icon: AlignHorizontalJustifyStart,
      children: ALIGN.map(([axis, mode, label]) => ({
        label,
        action: () => store.alignSelected(axis, mode),
      })),
    });
  const grouping: MenuItem[] = [];
  if (store.selected.size > 1 && !store.selectedGroup())
    grouping.push({
      label: 'Group',
      key: 'Ctrl+G',
      icon: Boxes,
      action: () => store.groupSelected(),
    });
  if (store.selectedParts().some((p) => p.group !== undefined))
    grouping.push({
      label: 'Ungroup',
      key: 'Ctrl+Shift+G',
      icon: Ungroup,
      action: () => store.ungroupSelected(),
    });
  const visibility: MenuItem[] = [
    { label: 'Hide', key: 'H', icon: EyeOff, action: () => store.hideSelected() },
  ];
  if (hidden) visibility.push(showAll);
  visibility.push({
    label: 'Delete',
    key: 'X',
    icon: Trash2,
    action: () => store.deleteSelected(),
  });
  const sections = [edit, arrange];
  if (grouping.length) sections.push(grouping);
  return [...sections, visibility, [addStock, selectAll, views, exploded, assembly]];
}

/** A title for the menu: the part's name, or how many parts are selected. */
export function menuTitle(store: Store): string {
  const n = store.selected.size;
  const g = store.selectedGroup();
  if (g) return `${g.name} · ${n} part${n === 1 ? '' : 's'}`;
  if (n === 1) return store.selectedParts()[0]!.name;
  if (n > 1) return `${n} parts`;
  return 'Scene';
}

/** Draws the menu, keeps it on screen, and closes it on an outside click or Escape. */
export class ContextMenu {
  private root: HTMLElement | null = null;
  private sub: HTMLElement | null = null;

  constructor() {
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (
          this.root &&
          !this.root.contains(e.target as Node) &&
          !this.sub?.contains(e.target as Node)
        )
          this.close();
      },
      { capture: true },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.root) {
          this.close();
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(x: number, y: number, title: string, sections: MenuItem[][]): void {
    this.close();
    const el = document.createElement('div');
    el.className = 'cmenu';
    el.setAttribute('role', 'menu');
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = title;
    el.appendChild(t);
    sections.forEach((items, i) => {
      if (i) el.appendChild(document.createElement('hr'));
      for (const item of items) el.appendChild(this.itemEl(item));
    });
    document.body.appendChild(el);
    this.root = el;
    place(el, x, y);
  }

  close(): void {
    this.closeSub();
    this.root?.remove();
    this.root = null;
  }

  private closeSub(): void {
    this.sub?.remove();
    this.sub = null;
    this.root?.querySelectorAll('.item.open').forEach((i) => i.classList.remove('open'));
  }

  private itemEl(item: MenuItem): HTMLElement {
    const el = document.createElement('div');
    el.className = 'item';
    el.setAttribute('role', 'menuitem');
    el.tabIndex = 0;
    const ic = document.createElement('span');
    ic.className = 'ic';
    if (item.icon)
      ic.appendChild(createElement(item.icon, { width: 14, height: 14, 'stroke-width': 2 }));
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = item.label;
    el.append(ic, lbl);
    if (item.children) {
      const chev = document.createElement('span');
      chev.className = 'key';
      chev.appendChild(createElement(ChevronRight, { width: 14, height: 14 }));
      el.appendChild(chev);
      const openSub = () => {
        if (el.classList.contains('open')) return;
        this.closeSub();
        el.classList.add('open');
        const sub = document.createElement('div');
        sub.className = 'cmenu sub';
        sub.setAttribute('role', 'menu');
        for (const c of item.children!) sub.appendChild(this.itemEl(c));
        document.body.appendChild(sub);
        this.sub = sub;
        const r = el.getBoundingClientRect();
        place(sub, r.right + 2, r.top - 4, r.left - 2);
      };
      el.addEventListener('mouseenter', openSub);
      el.addEventListener('click', openSub);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'ArrowRight') openSub();
      });
    } else {
      if (item.key) {
        const k = document.createElement('span');
        k.className = 'key';
        k.textContent = item.key;
        el.appendChild(k);
      }
      el.addEventListener('mouseenter', () => {
        if (el.parentElement === this.root) this.closeSub();
      });
      const run = () => {
        this.close();
        item.action?.();
      };
      el.addEventListener('click', run);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') run();
      });
    }
    return el;
  }
}

/** Put a fixed element at (x, y), flipped or shifted so it stays inside the window. */
function place(el: HTMLElement, x: number, y: number, flipX?: number): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  const r = el.getBoundingClientRect();
  if (r.right > innerWidth - 8) {
    // A submenu flips to the left of its parent item; a root menu slides left.
    const left = flipX !== undefined ? flipX - r.width : innerWidth - 8 - r.width;
    el.style.left = `${Math.max(8, left)}px`;
  }
  if (r.bottom > innerHeight - 8) el.style.top = `${Math.max(8, innerHeight - 8 - r.height)}px`;
}
