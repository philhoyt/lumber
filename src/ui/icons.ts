/** Lucide icon helpers shared by the toolbar, header, panels and menus. */
import { createElement, type IconNode } from 'lucide';

export function icon(node: IconNode, size = 16): SVGElement {
  return createElement(node, { width: size, height: size, 'stroke-width': 2 });
}

/** Put an icon inside an existing button, replacing whatever it held. */
export function setIcon(button: HTMLElement, node: IconNode, size = 16): void {
  button.textContent = '';
  button.appendChild(icon(node, size));
}

export function iconButton(
  node: IconNode,
  title: string,
  onClick: () => void,
  className = '',
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(icon(node, 18));
  b.addEventListener('click', onClick);
  return b;
}
