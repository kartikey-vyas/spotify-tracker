<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    DitheringShapes,
    DitheringTypes,
    ShaderFitOptions,
    ShaderMount,
    ditheringFragmentShader
  } from '@paper-design/shaders';
  import SpotifyLoader from './SpotifyLoader.svelte';

  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let label = '';

  const DIAMETER = { sm: 72, md: 120, lg: 190 } as const;

  /* The pattern is authored against this reference diameter and fitted with
     `contain`, so a 72px mark is the 190px one scaled down rather than a
     smaller window onto the same noise field. Without it the small sizes crop
     to a fraction of a single blob and read as a fan, not a disc. */
  const WORLD = 190;

  const SHAPE = 'simplex';
  const DITHER = '8x8';
  const SCALE = 0.3;
  const PX_SIZE = 1.5;
  const SPEED = 2.5;

  /* Label and spindle as a share of the diameter. */
  const LABEL_PCT = 34;
  const HOLE_PCT = 5;

  let host: HTMLDivElement | undefined;
  let mount: ShaderMount | null = null;
  let themeWatcher: MutationObserver | null = null;
  let motionQuery: MediaQueryList | null = null;
  /* Assume WebGL2 until proven otherwise; the braille disc stands in if not. */
  let canRender = true;

  $: diameter = DIAMETER[size];

  function readVar(name: string): [number, number, number, number] {
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

  /* The unlit dither cells are the page ground, not a surface tint, so the disc
     has no hard edge — where the noise field goes dark the mark simply fades
     into the page. It reads as a disc catching light rather than a stamped-out
     circle, which is the whole character of it. */
  function colors() {
    return { u_colorBack: readVar('--bg'), u_colorFront: readVar('--accent') };
  }

  function applyTheme(): void {
    mount?.setUniforms(colors());
  }

  function applyMotionPreference(): void {
    /* speed 0 runs no rAF loop at all, so reduced motion costs nothing. */
    mount?.setSpeed(motionQuery?.matches ? 0 : SPEED);
  }

  onMount(() => {
    if (!host) return;

    if (!document.createElement('canvas').getContext('webgl2')) {
      canRender = false;
      return;
    }

    mount = new ShaderMount(
      host,
      ditheringFragmentShader,
      {
        u_fit: ShaderFitOptions.contain,
        u_scale: SCALE,
        u_rotation: 0,
        u_offsetX: 0,
        u_offsetY: 0,
        u_originX: 0.5,
        u_originY: 0.5,
        u_worldWidth: WORLD,
        u_worldHeight: WORLD,
        u_pxSize: PX_SIZE,
        u_shape: DitheringShapes[SHAPE],
        u_type: DitheringTypes[DITHER],
        ...colors()
      },
      undefined,
      SPEED,
      0
    );

    /* Themes only swap CSS variables, so re-read them when the attribute flips
       rather than coupling this component to the theme store. */
    themeWatcher = new MutationObserver(applyTheme);
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', applyMotionPreference);
    applyMotionPreference();
  });

  onDestroy(() => {
    themeWatcher?.disconnect();
    motionQuery?.removeEventListener('change', applyMotionPreference);
    mount?.dispose();
    mount = null;
  });
</script>

{#if canRender}
  <div class="record" role="status" style="--diameter: {diameter}px">
    <div class="disc">
      <div class="shader" bind:this={host}></div>
      <span
        class="label"
        style="--label: {LABEL_PCT}%; --hole: {Math.round((HOLE_PCT / LABEL_PCT) * 100)}%"
      ></span>
    </div>
    {#if label}<span class="caption">{label}</span>{/if}
  </div>
{:else}
  <SpotifyLoader {size} {label} />
{/if}

<style>
  .record {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  /* The canvas is square; the circle is this clip. */
  .disc {
    position: relative;
    width: var(--diameter);
    height: var(--diameter);
    overflow: hidden;
    border-radius: 50%;
  }

  .shader {
    width: 100%;
    height: 100%;
  }

  /* Label and spindle hole, stacked over the canvas. A mask would only punch a
     hole, and a hole disappears into the disc it is punched out of. */
  .label {
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--label);
    height: var(--label);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--accent);
  }

  .label::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--hole);
    height: var(--hole);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--bg);
    content: '';
  }

  .caption {
    color: var(--muted);
    font-size: var(--text-sm);
    letter-spacing: 0.02em;
  }
</style>
