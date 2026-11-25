/**
 * View icons drawn by hand: a small isometric cube in the same 24-unit box and stroke
 * weight as the Lucide set, with the face you would be looking at filled in. The
 * projection pair shows converging edges for perspective and parallel ones for ortho.
 */
export type ViewIcon = 'iso' | 'top' | 'front' | 'right' | 'fit' | 'persp' | 'ortho';

// Cube corners, isometric from the front-right-above, like the default view.
const TOP = 'M12 3.5 19 7.5 12 11.5 5 7.5Z';
const FRONT = 'M5 7.5 12 11.5 12 19.5 5 15.5Z'; // the -Y face, lower left
const RIGHT = 'M12 11.5 19 7.5 19 15.5 12 19.5Z'; // the +X face, lower right
const CUBE = `${TOP}${FRONT}${RIGHT}`;

const face = (d: string, strong = true) =>
  `<path d="${d}" fill="currentColor" fill-opacity="${strong ? 0.9 : 0.28}" stroke="none"/>`;
const edges = (scale = 1, dx = 0, dy = 0) =>
  `<g transform="translate(${dx} ${dy}) scale(${scale})"><path d="${CUBE}"/></g>`;

const DRAWINGS: Record<ViewIcon, string> = {
  iso: `${face(TOP, false)}${face(FRONT, false)}${face(RIGHT, false)}${edges()}`,
  top: `${face(TOP)}${edges()}`,
  front: `${face(FRONT)}${edges()}`,
  right: `${face(RIGHT)}${edges()}`,
  fit: `${edges(0.62, 4.6, 4.6)}<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>`,
  // A box seen in perspective: the back face smaller, edges converging.
  persp: `<path d="M4 16V8l16-3v14L4 16Z"/><path d="M4 8l5 1.5v5L4 16M9 9.5 20 5M9 14.5 20 19"/>`,
  // The same box in parallel projection: front and back the same size.
  ortho: `<path d="M8 8h12v12H8Z"/><path d="M8 8 4 4v12l4 4M4 4h12l4 4M16 4v12"/>`,
};

export function viewIcon(kind: ViewIcon, size = 18): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = DRAWINGS[kind];
  return svg;
}
