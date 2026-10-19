import { browser } from '$app/environment';

export const THEME_KEY = 'spotify-history-theme';

// Light themes first, then dark, so the menu reads as two groups.
export const themes = [
  { value: 'light', label: 'light' },
  { value: 'blush', label: 'blush' },
  { value: 'seafoam', label: 'seafoam' },
  { value: 'beach', label: 'beach' },
  { value: 'warm-dark', label: 'dark' },
  { value: 'black', label: 'black' },
  { value: 'kanagawa', label: 'kanagawa' },
  { value: 'rose', label: 'rose' },
  { value: 'passionfruit', label: 'passionfruit' },
  { value: 'aether', label: 'aether' }
] as const;

export type Theme = (typeof themes)[number]['value'];

export const DEFAULT_THEME: Theme = 'black';

/**
 * Inline <head> script that applies the saved theme before first paint, so the
 * page never flashes the wrong palette. Built from the list above, so a saved
 * value that is no longer a theme (gruvbox was removed) falls back to the
 * default. The root layout renders it into <svelte:head>; every page is
 * prerendered, so it is in the static HTML.
 */
export const themeBootScript = `<script>(function(){var t=${JSON.stringify(DEFAULT_THEME)};try{var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(themes.map((option) => option.value))}.indexOf(s)>=0)t=s}catch(e){}if(t==='light')document.documentElement.removeAttribute('data-theme');else document.documentElement.dataset.theme=t})()</script>`;

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
