/**
 * Blender's navigation gizmo in the top-right corner of the view: a ball of six axis
 * handles that turns with the camera. Click a handle to look along that axis (again for
 * the other side), drag the ball to orbit. Below it, drag buttons for zoom and pan and a
 * toggle for the projection.
 */
import { Move, ZoomIn } from 'lucide';
import { zoomScale } from '../gestures';
import { AXIS_COLORS, dragOrbit, handleAt, handleView, layoutHandles } from '../navGizmo';
import type { HandleSpot } from '../navGizmo';
import type { LumberScene } from '../scene';
import { icon } from './icons';
import { viewIcon } from './viewIcons';

const SIZE = 96;
const RADIUS = 34;
const BALL = 8;
const LABELS = ['X', 'Y', 'Z'] as const;

export function wireNavGizmo(viewport: HTMLElement, scene: LumberScene): void {
  const box = document.createElement('div');
  box.className = 'nav-gizmo';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
  svg.setAttribute('width', String(SIZE));
  svg.setAttribute('height', String(SIZE));
  svg.classList.add('nav-ball');
  svg.innerHTML = `<circle class="nav-disc" r="${SIZE / 2 - 2}"/><g class="nav-handles"></g>`;
  const handles = svg.querySelector<SVGGElement>('.nav-handles')!;
  box.appendChild(svg);

  const zoom = dragButton(icon(ZoomIn, 16), 'Drag to zoom (+ / -)', (_dx, dy) =>
    scene.rig.dolly(zoomScale(dy)),
  );
  const pan = dragButton(icon(Move, 16), 'Drag to pan (Ctrl+2 / 4 / 6 / 8)', (dx, dy) =>
    scene.rig.panPixels(-dx, dy),
  );
  const proj = document.createElement('button');
  proj.type = 'button';
  proj.addEventListener('click', () => scene.rig.toggleProjection());
  box.append(zoom, pan, proj);
  viewport.appendChild(box);

  let spots: HandleSpot[] = [];
  let hot: HandleSpot | null = null;

  const draw = (): void => {
    spots = layoutHandles(scene.rig.cameraAxes(), RADIUS);
    handles.innerHTML = spots.map((s) => handleSvg(s, hot)).join('');
    const mode = scene.rig.projection;
    proj.textContent = '';
    proj.appendChild(viewIcon(mode === 'ortho' ? 'ortho' : 'persp', 16));
    proj.title =
      mode === 'ortho' ? 'Orthographic · 5 for perspective' : 'Perspective · 5 for orthographic';
    proj.setAttribute('aria-label', proj.title);
  };
  scene.rig.watchCamera(draw);
  draw();

  // Pointer position in the gizmo's own coordinates, centre at 0,0.
  const local = (e: PointerEvent): [number, number] => {
    const r = svg.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
  };
  const sameHandle = (a: HandleSpot | null, b: HandleSpot | null): boolean =>
    a === b || (!!a && !!b && a.axis === b.axis && a.sign === b.sign);
  const setHot = (h: HandleSpot | null): void => {
    if (sameHandle(h, hot)) return;
    hot = h;
    draw();
  };

  let drag: { x: number; y: number; moved: boolean } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    svg.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: false };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) {
      const [x, y] = local(e);
      setHot(handleAt(spots, x, y, BALL + 2));
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const { az, el } = dragOrbit(dx, dy, RADIUS);
    scene.rig.orbitFree(az, el);
  });
  svg.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null;
    if (!wasClick) return;
    const [x, y] = local(e);
    const h = handleAt(spots, x, y, BALL + 2);
    if (h) scene.rig.setView(handleView(h, scene.rig.viewDir()));
  });
  svg.addEventListener('pointerleave', () => setHot(null));
  svg.addEventListener('pointercancel', () => (drag = null));
  box.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** One handle: a ball on a stem for the positive end, a hollow ball for the negative. */
function handleSvg(s: HandleSpot, hot: HandleSpot | null): string {
  const color = AXIS_COLORS[s.axis];
  const isHot = hot !== null && hot.axis === s.axis && hot.sign === s.sign;
  const cls = `nav-handle${isHot ? ' hot' : ''}${s.depth >= 0 ? '' : ' far'}${s.sign > 0 ? '' : ' neg'}`;
  const x = s.x.toFixed(1);
  const y = s.y.toFixed(1);
  const line = s.sign > 0 ? `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="${color}"/>` : '';
  const fill = s.sign > 0 ? color : 'var(--nav-back)';
  const label =
    s.sign > 0 || isHot
      ? `<text x="${x}" y="${y}">${s.sign > 0 ? '' : '-'}${LABELS[s.axis]}</text>`
      : '';
  return `<g class="${cls}">${line}<circle cx="${x}" cy="${y}" r="${BALL}" fill="${fill}" stroke="${color}"/>${label}</g>`;
}

/** A button that acts while dragged: `onDrag` gets the pointer's movement in pixels. */
function dragButton(
  glyph: SVGElement,
  title: string,
  onDrag: (dx: number, dy: number) => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(glyph);
  let last: [number, number] | null = null;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    b.setPointerCapture(e.pointerId);
    last = [e.clientX, e.clientY];
    b.classList.add('dragging');
  });
  b.addEventListener('pointermove', (e) => {
    if (!last) return;
    onDrag(e.clientX - last[0], e.clientY - last[1]);
    last = [e.clientX, e.clientY];
  });
  const end = (): void => {
    last = null;
    b.classList.remove('dragging');
  };
  b.addEventListener('pointerup', end);
  b.addEventListener('pointercancel', end);
  return b;
}
