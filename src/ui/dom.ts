/** Small DOM helpers shared by the panels. */

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

export function download(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Bind a change handler by element id inside `root`, ignoring missing elements. */
export function onChange(root: ParentNode, id: string, fn: (el: HTMLInputElement) => void): void {
  const el = root.querySelector<HTMLInputElement>(`#${id}`);
  if (el) el.addEventListener('change', () => fn(el));
}

export function onClick(root: ParentNode, id: string, fn: () => void): void {
  const el = root.querySelector<HTMLElement>(`#${id}`);
  if (el) el.addEventListener('click', fn);
}
