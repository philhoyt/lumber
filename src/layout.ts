/**
 * The widths of the two side panels: the stock palette on the left and the side panel on
 * the right. Dragging the splitter beside either one sets it; the widths are remembered
 * per browser. Pure numbers; the UI applies them.
 */

export type Panel = 'palette' | 'side';

export interface Layout {
  palette: number;
  side: number;
}

export const DEFAULT_LAYOUT: Layout = { palette: 230, side: 340 };

/** How narrow and wide each panel may go, pixels. */
const LIMITS: Record<Panel, [number, number]> = {
  palette: [150, 480],
  side: [260, 680],
};

/** A width kept within the panel's limits, rounded to whole pixels. */
export function clampWidth(panel: Panel, px: number): number {
  const [lo, hi] = LIMITS[panel];
  return Math.round(Math.min(hi, Math.max(lo, px)));
}

/**
 * The width after a splitter drag of `dx` pixels to the right: the palette grows with
 * its splitter, the side panel shrinks as its splitter moves right.
 */
export function draggedWidth(panel: Panel, startWidth: number, dx: number): number {
  return clampWidth(panel, panel === 'palette' ? startWidth + dx : startWidth - dx);
}

/** Read a saved layout, falling back to the defaults for anything missing or odd. */
export function parseLayout(json: string | null): Layout {
  if (!json) return { ...DEFAULT_LAYOUT };
  try {
    const v = JSON.parse(json) as Partial<Record<Panel, unknown>>;
    const pick = (panel: Panel): number =>
      typeof v[panel] === 'number' && Number.isFinite(v[panel])
        ? clampWidth(panel, v[panel])
        : DEFAULT_LAYOUT[panel];
    return { palette: pick('palette'), side: pick('side') };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}
