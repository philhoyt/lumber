/**
 * Drag handles on the view's left and right edges that resize the stock palette and the
 * side panel. The widths live in the --palette and --side variables on the root, so the
 * grid follows; the hidden-panel classes on #app still win. Double-click resets a panel.
 */
import { DEFAULT_LAYOUT, draggedWidth, parseLayout, type Layout, type Panel } from '../layout';

const KEY = 'lumber.layout';

export function wireSplitters(viewport: HTMLElement): void {
  const root = document.documentElement;
  const layout: Layout = parseLayout(read());
  const apply = (): void => {
    root.style.setProperty('--palette', `${layout.palette}px`);
    root.style.setProperty('--side', `${layout.side}px`);
  };
  const save = (): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* best effort */
    }
  };
  apply();

  for (const panel of ['palette', 'side'] as const) {
    const bar = document.createElement('div');
    bar.className = 'splitter ' + (panel === 'palette' ? 'left' : 'right');
    bar.title =
      (panel === 'palette' ? 'Drag to resize the stock palette' : 'Drag to resize the side panel') +
      '; double-click resets';
    viewport.appendChild(bar);
    let drag: { x: number; start: number } | null = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      bar.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, start: layout[panel] };
      bar.classList.add('dragging');
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag) return;
      layout[panel] = draggedWidth(panel, drag.start, e.clientX - drag.x);
      apply();
    });
    const end = (): void => {
      if (!drag) return;
      drag = null;
      bar.classList.remove('dragging');
      save();
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('dblclick', () => {
      layout[panel] = DEFAULT_LAYOUT[panel];
      apply();
      save();
    });
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export type { Panel };
