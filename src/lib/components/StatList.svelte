<script lang="ts">
  import type { RankingRow } from '$lib/types';

  export let rows: RankingRow[] = [];
  export let loading = false;
  export let placeholderCount = 8;

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
    {#each rows as row}
      <li>
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
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--line);
    counter-increment: rank;
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
