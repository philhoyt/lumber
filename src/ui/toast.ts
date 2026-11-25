/** A short message near the bottom of the window that fades after a few seconds. */
let el: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, ms = 3500): void {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('on');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => el?.classList.remove('on'), ms);
}
