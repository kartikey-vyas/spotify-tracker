import { browser } from '$app/environment';

// NOTE: src/app.html has an inline <head> script that hand-duplicates THEME_KEY
// and the light/default apply logic for FOUC prevention — keep them in sync.
export const THEME_KEY = 'spotify-history-theme';

export const themes = [
  { value: 'warm-dark', label: 'dark' },
  { value: 'kanagawa', label: 'kanagawa' },
  { value: 'light', label: 'light' },
  { value: 'blush', label: 'blush' },
  { value: 'rose', label: 'rose' },
  { value: 'black', label: 'black' },
  { value: 'gruvbox', label: 'gruvbox' },
  { value: 'seafoam', label: 'seafoam' }
] as const;

export type Theme = (typeof themes)[number]['value'];

export function isTheme(value: string | undefined | null): value is Theme {
  return themes.some((option) => option.value === value);
}

export function applyTheme(nextTheme: Theme): void {
  if (!browser) return;

  if (nextTheme === 'light') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = nextTheme;
  }

  try {
    localStorage.setItem(THEME_KEY, nextTheme);
  } catch {
    // Keep the applied theme even when storage is unavailable.
  }
}
