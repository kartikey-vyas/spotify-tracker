<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    DitheringShapes,
    DitheringTypes,
    ShaderFitOptions,
    ShaderMount,
    ditheringFragmentShader
  } from '@paper-design/shaders';
  import { readThemeVar } from '$lib/effects/webgl';

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

  /* The unlit dither cells are the page ground, not a surface tint, so the disc
     has no hard edge — where the noise field goes dark the mark simply fades
     into the page. It reads as a disc catching light rather than a stamped-out
     circle, which is the whole character of it. */
  function colors() {
    return { u_colorBack: readThemeVar('--bg'), u_colorFront: readThemeVar('--accent') };
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

<!-- Every class here is prefixed `mark-`, which is not this codebase's habit and
     is deliberate. The obvious names for a record — disc, groove, label — are
     also the obvious names for things that have nothing to do with a record, and
     two of them were already taken elsewhere: `.groove` was the homepage's ticker
     and `.label` is the listening clock's hour text. Svelte's scoping normally
     keeps them apart, but it is the ONLY thing keeping them apart, and when a
     dev server served this component's CSS unscoped the ticker inherited this
     mark's `border-radius: 50%` and its spin, and orbited the page. The prefix
     makes that failure impossible rather than unlikely. -->
<div class="mark" role="status" style="--diameter: {px}px">
  {#if canRender}
    <div class="mark-disc">
      <div class="mark-shader" bind:this={host}></div>
      <span class="mark-label" style="--label: {labelPct}%; --hole: {holeOfLabel}%"></span>
    </div>
  {:else}
    <!-- No WebGL2: the same mark without the dither, and one accent groove
         sweeping so it still reads as spinning rather than parked. -->
    <div class="mark-disc is-plain">
      <span class="mark-groove"></span>
      <span class="mark-label" style="--label: {labelPct}%; --hole: {holeOfLabel}%"></span>
    </div>
  {/if}
  {#if label}<span class="mark-caption">{label}</span>{/if}
</div>

<style>
  .mark {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  /* The canvas is square; the circle is this clip. */
  .mark-disc {
    position: relative;
    width: var(--diameter);
    height: var(--diameter);
    overflow: hidden;
    border-radius: 50%;
  }

  .mark-shader {
    width: 100%;
    height: 100%;
  }

  /* Modifier, so it needs no prefix of its own — it only ever qualifies a
     .mark-disc, and the compound selector is what scopes it. */
  .mark-disc.is-plain {
    background: var(--surface-2);
  }

  .mark-groove {
    position: absolute;
    inset: 12%;
    border: 2px solid transparent;
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: mark-spin 1.4s linear infinite;
  }

  /* Prefixed for the same reason the classes are: Svelte scopes keyframe names
     too, so this is the only thing standing between one component's spin and
     another's if that scoping ever fails. */
  @keyframes mark-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mark-groove {
      animation: none;
    }
  }

  /* Label and spindle hole, stacked over the disc. A mask would only punch a
     hole, and a hole disappears into the disc it is punched out of. */
  .mark-label {
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--label);
    height: var(--label);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--accent);
  }

  .mark-label::after {
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

  .mark-caption {
    color: var(--muted);
    font-size: var(--text-sm);
    letter-spacing: 0.02em;
  }
</style>
