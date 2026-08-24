<script context="module" lang="ts">
  /** What ships when a caller passes no dials — the /admin/mark benches seed
      their sliders from this same object, so they always open on it. */
  export const DITHER_FIELD_DEFAULTS = {
    shape: 'simplex',
    dither: '8x8',
    scale: 0.1,
    pxSize: 1.25,
    speed: 1
  } as const;
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    DitheringShapes,
    DitheringTypes,
    ShaderFitOptions,
    ShaderMount,
    ditheringFragmentShader
  } from '@paper-design/shaders';
  import type { Rgba } from '$lib/effects/coverEffects';
  import { disposeShaderMount, readThemeVar } from '$lib/effects/webgl';

  /**
   * An animated dither layer that fills its nearest positioned ancestor —
   * the record mark's own shader, accent cells on a transparent ground, so
   * the pattern happens directly on the page. DitherFrame wraps this for the
   * band-behind-content case; use it bare for a background layer (give the
   * parent `position: relative` and mind the stacking order).
   *
   * Each instance is one live WebGL context (browsers cap these at 16), so
   * place a few, not a grid of them.
   */
  export let shape: keyof typeof DitheringShapes = DITHER_FIELD_DEFAULTS.shape;
  export let dither: keyof typeof DitheringTypes = DITHER_FIELD_DEFAULTS.dither;
  export let scale: number = DITHER_FIELD_DEFAULTS.scale;
  export let pxSize: number = DITHER_FIELD_DEFAULTS.pxSize;
  export let speed: number = DITHER_FIELD_DEFAULTS.speed;
  /** Alpha on the lit cells; 1 is full accent. */
  export let opacity = 1;

  let host: HTMLDivElement | undefined;
  let mount: ShaderMount | null = null;
  let themeWatcher: MutationObserver | null = null;
  let motionQuery: MediaQueryList | null = null;
  /* Parsed accent, cached until the theme flips — reading and parsing the CSS
     var on every opacity tick (a bench slider drag) would be wasted work. */
  let accent: Rgba | null = null;

  /* Transparent back: the page ground is the unlit cell, so the field has no
     hard edge of its own — the way the record mark fades into the page. */
  function colors(alpha: number) {
    accent ??= readThemeVar('--accent');
    return {
      u_colorBack: [0, 0, 0, 0] as Rgba,
      u_colorFront: [accent[0], accent[1], accent[2], alpha] as Rgba
    };
  }

  function handleThemeChange(): void {
    accent = null;
    mount?.setUniforms(colors(opacity));
  }

  function applySpeed(next: number): void {
    /* speed 0 runs no rAF loop at all, so reduced motion costs nothing. */
    mount?.setSpeed(motionQuery?.matches ? 0 : next);
  }

  /* Re-push the tunables whenever a prop changes (the /admin/mark benches bind
     them to sliders). Each value is passed as an argument so the compiler can
     see the dependency — it cannot look through a bare function call. */
  $: if (mount) {
    mount.setUniforms({
      u_scale: scale,
      u_pxSize: pxSize,
      u_shape: DitheringShapes[shape],
      u_type: DitheringTypes[dither]
    });
  }
  $: if (mount) applySpeed(speed);
  $: if (mount) mount.setUniforms(colors(opacity));

  onMount(() => {
    if (!host) return;

    /* No WebGL2: the content renders on the plain page, no field. */
    if (!document.createElement('canvas').getContext('webgl2')) return;

    mount = new ShaderMount(
      host,
      ditheringFragmentShader,
      {
        u_fit: ShaderFitOptions.cover,
        u_scale: scale,
        u_rotation: 0,
        u_offsetX: 0,
        u_offsetY: 0,
        u_originX: 0.5,
        u_originY: 0.5,
        u_worldWidth: 0,
        u_worldHeight: 0,
        u_pxSize: pxSize,
        u_shape: DitheringShapes[shape],
        u_type: DitheringTypes[dither],
        ...colors(opacity)
      },
      undefined,
      0,
      0
    );

    /* Themes only swap CSS variables, so re-read them when the attribute flips
       rather than coupling this component to the theme store. */
    themeWatcher = new MutationObserver(handleThemeChange);
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', handleMotionChange);
    applySpeed(speed);
  });

  function handleMotionChange(): void {
    applySpeed(speed);
  }

  onDestroy(() => {
    themeWatcher?.disconnect();
    motionQuery?.removeEventListener('change', handleMotionChange);
    if (!mount) return;
    disposeShaderMount(mount, host);
    mount = null;
  });
</script>

<div class="field" bind:this={host} aria-hidden="true"></div>

<style>
  .field {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .field :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
