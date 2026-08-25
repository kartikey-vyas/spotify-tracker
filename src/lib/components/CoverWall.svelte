<script context="module" lang="ts">
  export type CoverItem = {
    id: string;
    title: string;
    subtitle?: string | null;
    value?: string | null;
    imageUrl: string | null;
    href?: string | null;
  };
</script>

<script lang="ts">
  import { base } from '$app/paths';
  import { onDestroy, onMount } from 'svelte';
  import { ShaderMount, type ShaderMountUniforms } from '@paper-design/shaders';
  import { tooltip } from '$lib/actions/tooltip';
  import { HOVER_OVERLAYS, OVERLAY_SIZING } from '$lib/effects/hoverOverlays';
  import { disposeShaderMount, readThemeColors } from '$lib/effects/webgl';

  export let items: CoverItem[] = [];
  // When true, render skeleton tiles instead of items (same grid + row trim).
  export let loading = false;
  export let placeholderCount = 36;
  export let trimIncompleteRows = true;

  let failed: Record<string, boolean> = {};
  let grid: HTMLUListElement | undefined;
  let columns = 0;

  // Read the live column count from the resolved grid template (auto-fill).
  function measureColumns(): void {
    if (!grid) return;
    const tracks = getComputedStyle(grid).gridTemplateColumns;
    columns = tracks && tracks !== 'none' ? tracks.split(' ').filter(Boolean).length : 0;
  }

  onMount(() => {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    /* Themes only swap CSS variables, so refresh the wave's uniforms when the
       attribute flips rather than rebuilding them on every hover. */
    themeWatcher = new MutationObserver(() => fxMount?.setUniforms(waveUniforms()));
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    if (!grid) return;
    measureColumns();
    const observer = new ResizeObserver(measureColumns);
    observer.observe(grid);
    return () => observer.disconnect();
  });

  // How many items fill only complete rows at the current column count. Falls
  // back to all items before the first measure (columns === 0) or when there
  // aren't even enough for one full row, so the wall is always a filled rectangle.
  function completeRowCount(itemCount: number, columnCount: number): number {
    if (columnCount === 0) return itemCount;
    return Math.floor(itemCount / columnCount) * columnCount || itemCount;
  }

  $: visible = trimIncompleteRows ? items.slice(0, completeRowCount(items.length, columns)) : items;
  $: skeletonCount = trimIncompleteRows
    ? completeRowCount(placeholderCount, columns)
    : placeholderCount;

  function markFailed(id: string): void {
    failed = { ...failed, [id]: true };
  }

  function captionText(item: CoverItem): string {
    return [item.title, item.subtitle].filter(Boolean).join(' — ');
  }

  /* ---- hover wave --------------------------------------------------------
     One dither-wave ShaderMount for the whole wall, parked over whichever
     tile is hovered. A second hovered tile cannot exist, and per-tile mounts
     would blow the 16-WebGL-context budget (this wall renders up to 36). */
  const waveOverlay = HOVER_OVERLAYS.ditherWave;

  let fxHost: HTMLDivElement | undefined;
  let fxMount: ShaderMount | null = null;
  let fxFailed = false;
  let fxVisible = false;
  let themeWatcher: MutationObserver | null = null;
  let motionQuery: MediaQueryList | null = null;

  function waveUniforms(): ShaderMountUniforms {
    return {
      ...OVERLAY_SIZING,
      ...waveOverlay.build(waveOverlay.defaults, readThemeColors())
    } as ShaderMountUniforms;
  }

  function enterTile(event: Event): void {
    const li = (event.currentTarget as HTMLElement).closest('li');
    if (!li || !fxHost) return;
    fxHost.style.left = `${li.offsetLeft}px`;
    fxHost.style.top = `${li.offsetTop}px`;
    fxHost.style.width = `${li.offsetWidth}px`;
    fxHost.style.height = `${li.offsetWidth}px`;
    if (!fxMount && !fxFailed) {
      try {
        fxMount = new ShaderMount(fxHost, waveOverlay.shader, waveUniforms(), undefined, 0, 0);
      } catch {
        /* No WebGL2. The tooltip still names the album; skip the wave. */
        fxFailed = true;
        return;
      }
    }
    fxMount?.setSpeed(motionQuery?.matches ? 0 : waveOverlay.defaults.speed);
    fxVisible = true;
  }

  function leaveTile(): void {
    fxVisible = false;
    /* Speed 0 stops the rAF loop outright, so an unhovered wall costs nothing. */
    fxMount?.setSpeed(0);
  }

  onDestroy(() => {
    themeWatcher?.disconnect();
    if (!fxMount) return;
    disposeShaderMount(fxMount, fxHost);
    fxMount = null;
  });
</script>

{#if loading || items.length > 0}
  <ul class="cover-wall" bind:this={grid}>
    {#if loading}
      {#each Array(skeletonCount) as _, index (index)}
        <li>
          <span class="tile skeleton" aria-hidden="true"></span>
          <span class="shelf" data-pixel-collision="platform"></span>
        </li>
      {/each}
    {:else}
      {#each visible as item, index (item.id)}
        <li
          data-pixel-collision="occluder"
          data-pixel-record={item.imageUrl && !failed[item.id] ? item.imageUrl : undefined}
          data-pixel-artist={item.subtitle ?? undefined}
          data-pixel-artist-rank={index + 1}
        >
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <svelte:element
            this={item.href ? 'a' : 'div'}
            class="tile"
            href={item.href ? `${base}${item.href}` : undefined}
            data-pixel-collision="ignore"
            use:tooltip={[captionText(item), item.value].filter(Boolean).join(' · ')}
            on:mouseenter={enterTile}
            on:mouseleave={leaveTile}
            on:focusin={enterTile}
            on:focusout={leaveTile}
          >
            {#if item.imageUrl && !failed[item.id]}
              <img
                class="art"
                src={item.imageUrl}
                alt={captionText(item)}
                loading="lazy"
                on:error={() => markFailed(item.id)}
              />
            {:else}
              <span class="art placeholder" aria-hidden="true">♪</span>
            {/if}
          </svelte:element>
          <span class="shelf" data-pixel-collision="platform"></span>
          {#if index % 3 === 1}
            <span class="ladder" data-pixel-collision="ladder"></span>
          {/if}
        </li>
      {/each}
    {/if}
    <!-- The single hover wave, parked over the hovered tile from enterTile. -->
    <div class="hover-fx" class:is-visible={fxVisible} bind:this={fxHost} aria-hidden="true"></div>
  </ul>
{:else}
  <p class="empty muted">No albums for this view.</p>
{/if}

<style>
  .cover-wall {
    /* Positioning context for the parked hover wave. */
    position: relative;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    /* Row gap is deliberately off the 4px spacing scale: .ladder spans from this
       row's shelf up to the one above, so its -13px top is measured against this
       exact 14px. Change one and you must re-derive the other. */
    gap: 14px 8px;
    margin: 0;
    padding: 0 0 8px;
    list-style: none;
  }

  .cover-wall li {
    position: relative;
  }

  /* Pixel shelf board each row of records stands on; the pixel people walk
     along these. The element spans exactly the tile so its collision rect
     ends flush with the wall (overhang stubs were standable and people
     pinballed down them). All paint lives on the ::before, which also extends
     4px into each column gap to connect boards across it — pseudo-elements
     and overflowing paint are both invisible to the geometry scanner. */
  .shelf {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -7px;
    height: 6px;
  }

  /* A 2px board the records stand on, with a 1px echo rule beneath it — the
     app's paired-hairline-rules vocabulary. The 3px of air between them is
     what makes it read as a shelf edge rather than one thick bar. */
  .shelf::before {
    content: '';
    position: absolute;
    inset: 0 -4px;
    background:
      linear-gradient(var(--line), var(--line)) 0 0 / 100% 2px no-repeat,
      linear-gradient(var(--line), var(--line)) 0 5px / 100% 1px no-repeat;
  }

  /* Invisible climbing zone in the column gap, spanning from this row's
     shelf up to the shelf above; pixel people use these to climb the wall. */
  .ladder {
    position: absolute;
    top: -13px;
    bottom: -7px;
    right: -6px;
    width: 4px;
    pointer-events: none;
  }

  .tile {
    position: relative;
    display: block;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--text);
    text-decoration: none;
  }

  .art {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* The art-missing glyph is sized as a graphic, not as text, so it sits off
     the type scale on purpose. */
  .placeholder {
    color: var(--muted);
    font-size: 1.6rem;
  }

  /* The shared hover wave. Hidden rather than unmounted between hovers so the
     WebGL context survives; pointer-events off so it never eats the tile's
     own mouseleave. */
  .hover-fx {
    position: absolute;
    top: 0;
    left: 0;
    visibility: hidden;
    pointer-events: none;
  }

  .hover-fx.is-visible {
    visibility: visible;
  }

  .hover-fx :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .empty {
    margin: 0;
  }
</style>
