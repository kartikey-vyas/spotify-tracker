/**
 * Shared plumbing for @paper-design ShaderMount instances: reading theme
 * colours out of CSS custom properties, and the context-releasing teardown.
 * Browser-only — every caller lives behind onMount.
 */
import type { ShaderMount } from '@paper-design/shaders';
import type { Rgba, ThemeColors } from './coverEffects';

/** Resolve a `#rrggbb`/`#rgb` CSS custom property to an RGBA tuple. */
export function readThemeVar(name: string): Rgba {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = raw.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
    1
  ];
}

/** The theme palette every cover effect and overlay builds its uniforms from. */
export function readThemeColors(): ThemeColors {
  return {
    bg: readThemeVar('--bg'),
    accent: readThemeVar('--accent'),
    text: readThemeVar('--text'),
    surface2: readThemeVar('--surface-2')
  };
}

/**
 * Tear a mount down and release its WebGL context immediately. The canvas
 * must be captured BEFORE dispose() detaches it, and the explicit context
 * loss matters: Chromium frees contexts lazily, and lingering ones count
 * against the 16 live contexts browsers allow.
 */
export function disposeShaderMount(mount: ShaderMount, host: Element | null | undefined): void {
  const canvas = host?.querySelector('canvas');
  mount.dispose();
  canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
}
