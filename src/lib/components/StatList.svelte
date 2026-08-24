<script context="module" lang="ts">
  /** The #1-row wave's own dials, separate from the metric-card frame's — a
      short wide row wants different values than a padded band. Tunable at
      /admin/mark ("Rank wave"), whose sliders seed from this same object. */
  export const RANK_WAVE_DEFAULTS = {
    scale: 1.2,
    pxSize: 1.25,
    speed: 1,
    opacity: 0.5
  };
</script>

<script lang="ts">
  import DitherField from '$lib/components/DitherField.svelte';
  import type { RankingRow } from '$lib/types';

  export let rows: RankingRow[] = [];
  export let loading = false;
  export let placeholderCount = 8;
  /** Set to 'artist' to expose rows to the pixel-person artist rail. Off by default
      because this component also renders tracks, which must never be tagged. */
  export let entityKind: 'artist' | null = null;
  /** Run the animated dither wave behind the #1 row. One WebGL context per
      list, so opt in per placement rather than defaulting on. */
  export let waveTop = false;
  export let wave = RANK_WAVE_DEFAULTS;

  $: placeholders = Array.from({ length: placeholderCount });
</script>

{#if loading}
  <ol class="stat-list skeleton-list" aria-hidden="true">
    {#each placeholders as _, index (index)}
      <li><span class="skeleton skeleton-line"></span></li>
    {/each}
  </ol>
{:else}
  <ol class="stat-list">
    {#each rows as row, index (row.entity_id)}
      <li
        data-pixel-artist={entityKind === 'artist' ? row.entity_name : undefined}
        data-pixel-artist-rank={entityKind === 'artist' ? index + 1 : undefined}
      >
        {#if waveTop && index === 0}
          <span class="wave" aria-hidden="true">
            <DitherField shape="wave" {...wave} />
          </span>
        {/if}
        <span class="name">{row.entity_name}</span>
        <span class="count">{row.plays.toLocaleString()}</span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .stat-list {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: rank;
  }

  .stat-list li {
    /* position + z-index make each row its own stacking context, so the
       wave layer's z-index: -1 tucks it behind the row's text and rank
       counter without escaping under the page. */
    position: relative;
    z-index: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--line);
    counter-increment: rank;
  }

  .wave {
    position: absolute;
    inset: 0;
    z-index: -1;
  }

  .stat-list li:last-child {
    border-bottom: 0;
  }

  .stat-list li::before {
    content: counter(rank);
    min-width: 1.4em;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  /* Rank #1 gets the accent: marker and count light up. */
  .stat-list:not(.skeleton-list) li:first-child::before {
    color: var(--accent);
    font-weight: 700;
  }

  .stat-list:not(.skeleton-list) li:first-child .count {
    color: var(--accent);
    font-weight: 700;
  }

  .stat-list .name {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stat-list .count {
    margin-left: auto;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  /* Skeleton rows reuse the .stat-list scaffold (rank number + border) so the
     placeholder reads like the real list. Widths vary so the bars look like
     names rather than a uniform block. */
  .skeleton-line {
    display: block;
    width: 62%;
    height: 0.82rem;
  }

  .skeleton-list li:nth-child(3n) .skeleton-line {
    width: 46%;
  }

  .skeleton-list li:nth-child(4n + 1) .skeleton-line {
    width: 74%;
  }
</style>
