/** Light or dark, remembered per browser; follows the system until chosen. */
export type Theme = 'dark' | 'light';

const KEY = 'lumber.theme';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* best effort */
  }
}

export function initTheme(): Theme {
  let theme: Theme | null = null;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    /* no storage */
  }
  if (!theme) theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'light' ? 'dark' : 'light';
  applyTheme(next);
  return next;
}
