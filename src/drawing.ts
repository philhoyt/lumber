/**
 * Shop drawings as SVG: three orthographic views of the whole model with its overall
 * dimensions, and a sheet per unique part with its face and edge views, cut sizes, miter
 * and bevel angles, joinery and fastener marks. Everything is drawn from the model's exact boxes;
 * nothing is traced from the 3D view. Pure functions returning SVG text.
 */
import { Quaternion, Vector3 } from 'three';
import { describeFastener } from './fastener';
import {
  describeCut,
  boundsOfPoints,
  boxCorners,
  cutCorners,
  localCorners,
  sawBevel,
  partDims,
  type Part,
  type Vec3,
  isReferencePart,
} from './model';
import { cutRows, type CutRow } from './pack';
import { fmt, r32 } from './units';

/** A unique part for a drawing: a cut-list row, but markers split rows too. */
export type DrawingRow = CutRow;

export const drawingRows = (parts: readonly Part[]): DrawingRow[] => cutRows(parts, true);

// ---- geometry helpers ----
export type Pt = [number, number];

/** Convex hull, counterclockwise (Andrew's monotone chain). Collinear points dropped. */
export function hull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The part's eight corners, angled cuts included, in world space. */
export function partCorners(p: Part): Vec3[] {
  const q = new Quaternion().fromArray(p.q);
  const d = partDims(p);
  return (localCorners(p, d) ?? boxCorners(d)).map((c) => {
    const v = new Vector3().fromArray(c).applyQuaternion(q);
    return [
      Math.round((v.x + p.pos[0]) * 1e6) / 1e6,
      Math.round((v.y + p.pos[1]) * 1e6) / 1e6,
      Math.round((v.z + p.pos[2]) * 1e6) / 1e6,
    ];
  });
}

export type ViewName = 'front' | 'right' | 'top';

/** Page axes per view: which world axis runs across, which runs up, and which points at the viewer. */
const VIEW_AXES: Record<
  ViewName,
  { across: 0 | 1 | 2; up: 0 | 1 | 2; toward: 0 | 1 | 2; sign: 1 | -1 }
> = {
  front: { across: 0, up: 2, toward: 1, sign: -1 }, // seen from −Y
  right: { across: 1, up: 2, toward: 0, sign: 1 }, // seen from +X
  top: { across: 0, up: 1, toward: 2, sign: 1 }, // seen from +Z
};

/** A part's outline in a view, as page-space inches (x across, y up). */
export function partOutline(p: Part, view: ViewName): Pt[] {
  const a = VIEW_AXES[view];
  return hull(partCorners(p).map((c) => [c[a.across], c[a.up]] as Pt));
}

// ---- SVG primitives ----
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const n = (v: number): string => (Math.round(v * 100) / 100).toString();

const TEXT = 'font-family="system-ui, sans-serif" font-size="10"';

/** A horizontal dimension between x1 and x2 (px) at y (px), text above. */
export function dimH(x1: number, x2: number, y: number, text: string, extTo?: number): string {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  const ext =
    extTo === undefined
      ? ''
      : `<line x1="${n(lo)}" y1="${n(extTo)}" x2="${n(lo)}" y2="${n(y)}" class="ext"/><line x1="${n(hi)}" y1="${n(extTo)}" x2="${n(hi)}" y2="${n(y)}" class="ext"/>`;
  return `<g class="dim">${ext}<line x1="${n(lo)}" y1="${n(y)}" x2="${n(hi)}" y2="${n(y)}"/>${tick(lo, y)}${tick(hi, y)}<text x="${n((lo + hi) / 2)}" y="${n(y - 3)}" text-anchor="middle" ${TEXT}>${esc(text)}</text></g>`;
}
/** A vertical dimension between y1 and y2 (px) at x (px), text to the right, rotated. */
export function dimV(y1: number, y2: number, x: number, text: string, extTo?: number): string {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  const ext =
    extTo === undefined
      ? ''
      : `<line x1="${n(extTo)}" y1="${n(lo)}" x2="${n(x)}" y2="${n(lo)}" class="ext"/><line x1="${n(extTo)}" y1="${n(hi)}" x2="${n(x)}" y2="${n(hi)}" class="ext"/>`;
  return `<g class="dim">${ext}<line x1="${n(x)}" y1="${n(lo)}" x2="${n(x)}" y2="${n(hi)}"/>${tick(x, lo)}${tick(x, hi)}<text x="${n(x + 4)}" y="${n((lo + hi) / 2)}" transform="rotate(-90 ${n(x + 4)} ${n((lo + hi) / 2)})" text-anchor="middle" dominant-baseline="hanging" ${TEXT}>${esc(text)}</text></g>`;
}
/** An architect's tick at a dimension end. */
const tick = (x: number, y: number): string =>
  `<line x1="${n(x - 3)}" y1="${n(y + 3)}" x2="${n(x + 3)}" y2="${n(y - 3)}"/>`;

const poly = (pts: readonly Pt[], cls: string): string =>
  `<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" class="${cls}"/>`;

// ---- the model's three views ----
export interface ViewsResult {
  svg: string;
  /** Overall size [W, D, H] in inches. */
  size: Vec3;
}

/**
 * Front, right and top views in third-angle layout: front at the left, right view beside
 * it, top view below the front, all to one scale, with overall dimensions.
 */
export function modelViewsSvg(parts: readonly Part[], pageW = 760): ViewsResult {
  const visible = parts.filter((p) => !p.hidden && !isReferencePart(p));
  if (!visible.length) return { svg: '', size: [0, 0, 0] };
  const corners = visible.flatMap(partCorners);
  const { min, max } = boundsOfPoints(corners);
  const W = max[0] - min[0];
  const D = max[1] - min[1];
  const H = max[2] - min[2];
  const gap = Math.max(6, Math.max(W, D, H) * 0.18);
  const margin = 34; // px, room for dimensions
  const totalW = W + gap + D; // inches across
  const totalH = H + gap + D; // inches down
  const s = Math.min((pageW - 3 * margin) / totalW, (560 - 3 * margin) / totalH);
  const pageH = totalH * s + 3 * margin;

  // Page origins (px) of each view's bottom-left corner in page inches.
  const views: {
    name: ViewName;
    title: string;
    x0: number;
    yBottom: number;
    w: number;
    h: number;
  }[] = [
    { name: 'front', title: 'Front', x0: margin, yBottom: margin + H * s, w: W, h: H },
    {
      name: 'right',
      title: 'Right side',
      x0: margin * 2 + W * s,
      yBottom: margin + H * s,
      w: D,
      h: H,
    },
    { name: 'top', title: 'Top', x0: margin, yBottom: margin * 2 + (H + D) * s, w: W, h: D },
  ];
  let svg = '';
  for (const v of views) {
    const a = VIEW_AXES[v.name];
    const lo: Pt = [min[a.across], min[a.up]];
    const toPx = ([x, y]: Pt): Pt => [v.x0 + (x - lo[0]) * s, v.yBottom - (y - lo[1]) * s];
    // Painter's order: far parts first, by the centre of each part along the viewing axis.
    const sorted = [...visible].sort((p, q) => (p.pos[a.toward] - q.pos[a.toward]) * a.sign);
    let g = `<g class="view"><text x="${n(v.x0)}" y="${n(v.yBottom - v.h * s - 8)}" ${TEXT} font-weight="600">${v.title}</text>`;
    for (const p of sorted) g += poly(partOutline(p, v.name).map(toPx), 'part');
    const [x1, y1] = toPx([lo[0], lo[1]]);
    const [x2, y2] = toPx([lo[0] + v.w, lo[1] + v.h]);
    g += dimH(x1, x2, y1 + 18, fmt(v.w), y1 + 2);
    g += dimV(y1, y2, x2 + 18, fmt(v.h), x2 + 2);
    svg += g + '</g>';
  }
  return {
    svg: `<svg class="drawing" viewBox="0 0 ${n(pageW)} ${n(pageH)}" width="${n(pageW)}" height="${n(pageH)}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
    size: [r32(W), r32(D), r32(H)],
  };
}

// ---- one part ----
export interface SheetResult {
  svg: string;
  /** Lines for the notes under the drawing: joinery, markers, grain. */
  notes: string[];
}

/**
 * A part sheet: the face view (length across, width up, front edge at the bottom) with
 * the miter outline, joinery and markers; the edge view (front, thickness up) under it;
 * and dimensions for the length, width, thickness and every cut's position.
 */
export function partSheetSvg(r: DrawingRow, pageW = 760): SheetResult {
  const { len, w, t, miter } = r;
  const margin = 40;
  const s = Math.min((pageW - 2 * margin - 60) / len, 22);
  const faceTop = margin;
  const faceBottom = faceTop + w * s;
  const edgeTop = faceBottom + 44;
  const edgeBottom = edgeTop + t * s;
  const x0 = margin;
  const fx = (x: number) => x0 + x * s; // x from end A, inches → px
  const fy = (yFromFront: number) => faceBottom - yFromFront * s;
  const ez = (zFromBottom: number) => edgeBottom - zFromBottom * s;
  let svg = '';
  const notes: string[] = [];

  // Face view: the top face's outline (corners with +Z), in centred local coordinates.
  const corners = cutCorners([len, w, t], miter, r.bevel, r.edge);
  const face = [4, 5, 7, 6].map(
    (i) => [fx(corners[i]![0] + len / 2), fy(corners[i]![1] + w / 2)] as Pt,
  );
  svg += poly(face, 'part');
  // Edge view: the front edge (corners with −Y), where a bevel shows.
  svg += `<text x="${n(x0)}" y="${n(edgeTop - 10)}" ${TEXT} font-weight="600">Front edge</text>`;
  const edge = [0, 1, 5, 4].map(
    (i) => [fx(corners[i]![0] + len / 2), ez(corners[i]![2] + t / 2)] as Pt,
  );
  svg += poly(edge, 'part');

  // Joinery.
  const rect = (x: number, y: number, wd: number, ht: number, cls: string) =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(wd, 0.5))}" height="${n(Math.max(ht, 0.5))}" class="${cls}"/>`;
  let dimRow = 0;
  const cutDims: string[] = [];
  for (const c of r.cuts) {
    const hiddenFace = 'face' in c && c.face === 'bottom';
    const cls = hiddenFace ? 'cut hidden' : 'cut';
    if (c.kind === 'dado') {
      svg += rect(fx(c.at), fy(w), c.width * s, w * s, cls);
      svg += rect(fx(c.at), hiddenFace ? ez(c.depth) : ez(t), c.width * s, c.depth * s, cls);
      cutDims.push(dimH(fx(0), fx(c.at), faceTop - 16 - dimRow * 14, fmt(c.at), faceTop));
      dimRow++;
    } else if (c.kind === 'groove') {
      svg += rect(fx(0), fy(c.at + c.width), len * s, c.width * s, cls);
      svg += rect(fx(0), hiddenFace ? ez(c.depth) : ez(t), len * s, c.depth * s, cls);
      cutDims.push(dimV(fy(0), fy(c.at), fx(len) + 34 + dimRow * 14, fmt(c.at), fx(len)));
      dimRow++;
    } else if (c.kind === 'rabbet' || c.kind === 'chamfer') {
      if (c.edge === 'endA' || c.edge === 'endB') {
        const xa = c.edge === 'endA' ? 0 : len - c.width;
        svg += rect(fx(xa), fy(w), c.width * s, w * s, cls);
        svg += rect(fx(xa), hiddenFace ? ez(c.depth) : ez(t), c.width * s, c.depth * s, cls);
      } else {
        const ya = c.edge === 'front' ? 0 : w - c.width;
        svg += rect(fx(0), fy(ya + c.width), len * s, c.width * s, cls);
        svg += rect(fx(0), hiddenFace ? ez(c.depth) : ez(t), len * s, c.depth * s, cls);
      }
    } else {
      const ya = c.edge === 'front' ? 0 : w - c.depth;
      svg += rect(fx(c.at), fy(ya + c.depth), c.width * s, c.depth * s, 'cut through');
      svg += rect(fx(c.at), ez(t), c.width * s, t * s, 'cut hidden');
      cutDims.push(dimH(fx(0), fx(c.at), faceTop - 16 - dimRow * 14, fmt(c.at), faceTop));
      dimRow++;
    }
    notes.push(describeCut(c, fmt));
  }
  // Markers: circles on the face view (top solid, bottom dashed); edge ones on the edge view.
  for (const f of r.fasteners) {
    const rr = Math.max(2.5, 0.2 * s);
    if (f.face === 'top' || f.face === 'bottom')
      svg += `<circle cx="${n(fx(f.at[0]))}" cy="${n(fy(f.at[1]))}" r="${n(rr)}" class="mark${f.face === 'bottom' ? ' hidden' : ''}"/>`;
    else if (f.face === 'front' || f.face === 'back')
      svg += `<circle cx="${n(fx(f.at[0]))}" cy="${n(ez(f.at[1]))}" r="${n(rr)}" class="mark${f.face === 'back' ? ' hidden' : ''}"/>`;
    notes.push(describeFastener(f, fmt));
  }
  svg += cutDims.join('');
  // The face title sits above every cut dimension.
  svg += `<text x="${n(x0)}" y="${n(faceTop - 22 - dimRow * 14)}" ${TEXT} font-weight="600">Face (top), front edge down</text>`;

  // Overall dimensions.
  const dimY = edgeBottom + 20;
  svg += dimH(
    fx(0),
    fx(len),
    dimY,
    `${fmt(len)}${miter[0] || miter[1] ? ' long point' : ''}`,
    edgeBottom + 2,
  );
  const b = r.bevel;
  if (miter[0] || miter[1] || b[0] || b[1]) notes.push(`Short point ${fmt(r.short)}`);
  if (miter[0] || miter[1]) {
    notes.push(`Miter A ${angle(miter[0])}, B ${angle(miter[1])}`);
    if (miter[0])
      svg += `<text x="${n(fx(0) + 4)}" y="${n(faceTop + 12)}" ${TEXT}>${Math.abs(miter[0])}°</text>`;
    if (miter[1])
      svg += `<text x="${n(fx(len) - 4)}" y="${n(faceTop + 12)}" text-anchor="end" ${TEXT}>${Math.abs(miter[1])}°</text>`;
  }
  if (b[0] || b[1]) {
    notes.push(`Bevel A ${bevelAngle(b[0])}, B ${bevelAngle(b[1])}`);
    for (const end of [0, 1] as const)
      if (b[end] && miter[end])
        notes.push(
          `End ${end ? 'B' : 'A'} compound: saw miter ${Math.abs(miter[end])}°, saw bevel ${sawBevel(miter[end], b[end])}°`,
        );
    // Bevel angles sit on the edge view, where the cut shows.
    if (b[0])
      svg += `<text x="${n(fx(0) + 4)}" y="${n(edgeTop + 12)}" ${TEXT}>${Math.abs(b[0])}°</text>`;
    if (b[1])
      svg += `<text x="${n(fx(len) - 4)}" y="${n(edgeTop + 12)}" text-anchor="end" ${TEXT}>${Math.abs(b[1])}°</text>`;
  }
  const e = r.edge;
  if (e[0] || e[1]) {
    notes.push(
      `Edge bevel front ${bevelAngle(e[0])}, back ${bevelAngle(e[1])}; ${fmt(r.shortW)} wide at the short point`,
    );
    // Edge angles sit on the face view beside the edge they belong to.
    if (e[0])
      svg += `<text x="${n(fx(len / 2))}" y="${n(faceBottom - 4)}" text-anchor="middle" ${TEXT}>${Math.abs(e[0])}°</text>`;
    if (e[1])
      svg += `<text x="${n(fx(len / 2))}" y="${n(faceTop + 12)}" text-anchor="middle" ${TEXT}>${Math.abs(e[1])}°</text>`;
  }
  svg += dimV(
    fy(0),
    fy(w),
    fx(len) + 20,
    `${fmt(w)}${e[0] || e[1] ? ' long point' : ''}`,
    fx(len) + 2,
  );
  svg += dimV(ez(0), ez(t), fx(len) + 20, fmt(t), fx(len) + 2);
  if (r.grain !== 'any')
    notes.push(
      r.grain === 'length' ? 'Grain runs along the length' : 'Grain runs across the length',
    );
  const pageH = dimY + 30;
  const topPad = 24 + dimRow * 14;
  return {
    svg: `<svg class="drawing" viewBox="0 ${n(-topPad)} ${n(pageW)} ${n(pageH + topPad)}" width="${n(pageW)}" height="${n(pageH + topPad)}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
    notes,
  };
}

const bevelAngle = (deg: number): string =>
  deg === 0
    ? 'square'
    : `${Math.abs(deg)}°${deg > 0 ? ' (short point on top)' : ' (short point on bottom)'}`;
const angle = (deg: number): string =>
  deg === 0
    ? 'square'
    : `${Math.abs(deg)}°${deg > 0 ? ' (short point on back edge)' : ' (short point on front edge)'}`;
