<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    DitheringShapes,
    DitheringTypes,
    ShaderFitOptions,
    ShaderMount,
    ditheringFragmentShader
  } from '@paper-design/shaders';

  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let label = '';

  /* Visual knobs. The defaults are the mark; they are props only so /admin/mark
     can tune them against the real component instead of a second copy of it. */
  export let shape: keyof typeof DitheringShapes = 'simplex';
  export let dither: keyof typeof DitheringTypes = '8x8';
  export let scale = 0.3;
  export let pxSize = 1.5;
  export let speed = 2.5;
  export let labelPct = 34;
  export let holePct = 5;
  export let diameter: number | null = null;

  const DIAMETER = { sm: 72, md: 120, lg: 190 } as const;

  /* The pattern is authored against this reference diameter and fitted with
     `contain`, so a 72px mark is the 190px one scaled down rather than a
     smaller window onto the same noise field. Without it the small sizes crop
     to a fraction of a single blob and read as a fan, not a disc. */
  const WORLD = 190;

  let host: HTMLDivElement | undefined;
  let mount: ShaderMount | null = null;
  let themeWatcher: MutationObserver | null = null;
  let motionQuery: MediaQueryList | null = null;
  /* Assume WebGL2 until proven otherwise; a plain CSS record stands in if not. */
  let canRender = true;

  $: px = diameter ?? DIAMETER[size];
  $: holeOfLabel = Math.round((holePct / labelPct) * 100);

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
    mount?.setSpeed(motionQuery?.matches ? 0 : speed);
  }

  /* Re-push the tunables whenever a prop changes. Reads props and calls a
     method rather than assigning state another statement reads, so it is not
     exposed to the reactive-ordering trap. */
  $: if (mount) {
    mount.setUniforms({
      u_scale: scale,
      u_pxSize: pxSize,
      u_shape: DitheringShapes[shape],
      u_type: DitheringTypes[dither]
    });
  }
  $: if (mount && speed !== undefined) applyMotionPreference();

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
        u_scale: scale,
        u_rotation: 0,
        u_offsetX: 0,
        u_offsetY: 0,
        u_originX: 0.5,
        u_originY: 0.5,
        u_worldWidth: WORLD,
        u_worldHeight: WORLD,
        u_pxSize: pxSize,
        u_shape: DitheringShapes[shape],
        u_type: DitheringTypes[dither],
        ...colors()
      },
      undefined,
      speed,
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

<div class="record" role="status" style="--diameter: {px}px">
  {#if canRender}
    <div class="disc">
      <div class="shader" bind:this={host}></div>
      <span class="label" style="--label: {labelPct}%; --hole: {holeOfLabel}%"></span>
    </div>
  {:else}
    <!-- No WebGL2: the same mark without the dither, and one accent groove
         sweeping so it still reads as spinning rather than parked. -->
    <div class="disc plain">
      <span class="groove"></span>
      <span class="label" style="--label: {labelPct}%; --hole: {holeOfLabel}%"></span>
    </div>
  {/if}
  {#if label}<span class="caption">{label}</span>{/if}
</div>

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

  .plain {
    background: var(--surface-2);
  }

  .groove {
    position: absolute;
    inset: 12%;
    border: 2px solid transparent;
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: record-spin 1.4s linear infinite;
  }

  @keyframes record-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .groove {
      animation: none;
    }
  }

  /* Label and spindle hole, stacked over the disc. A mask would only punch a
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
