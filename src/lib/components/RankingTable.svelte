<script lang="ts">
  import { base } from '$app/paths';
  import { formatMetric, metricLabel, metricValue } from '$lib/metrics';
  import type { EntityType, Metric, RankingRow } from '$lib/types';

  export let rows: RankingRow[] = [];
  export let entityType: EntityType;
  export let metric: Metric = 'minutes';
  export let showLinks = true;
  export let profileSlug: string | null = null;
  export let rangePreset: string | null = null;
  export let compact = false;
  export let selectedEntityId: string | null = null;

  $: showPlaysColumn = !compact && metric !== 'plays';
  $: columnCount = showPlaysColumn ? 4 : 3;

  function entityHref(row: RankingRow): string {
    const params = new URLSearchParams({
      entity: entityType,
      id: row.entity_id
    });
    if (profileSlug) params.set('profile', profileSlug);
    if (rangePreset) params.set('range', rangePreset);
    return `${base}/explore/?${params.toString()}`;
  }
</script>

<div class="table-wrap" class:compact>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Name</th>
        <th>{metricLabel(metric)}</th>
        {#if showPlaysColumn}
          <th>Plays</th>
        {/if}
      </tr>
    </thead>
    <tbody>
      {#each rows as row, index}
        <tr class:top-row={index === 0} class:selected-row={row.entity_id === selectedEntityId}>
          <td>{index + 1}</td>
          <td>
            {#if showLinks}
              <a
                class="entity-link"
                href={entityHref(row)}
                aria-current={row.entity_id === selectedEntityId ? 'page' : undefined}
                title={compact ? row.entity_name : undefined}
              >
                {row.entity_name}
              </a>
            {:else}
              {row.entity_name}
            {/if}
          </td>
          <td>{formatMetric(metricValue(row, metric), metric)}</td>
          {#if showPlaysColumn}
            <td>{row.plays.toLocaleString()}</td>
          {/if}
        </tr>
      {:else}
        <tr>
          <td colspan={columnCount} class="empty">No listening data for this view.</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .entity-link {
    color: var(--text);
    font-weight: 400;
  }

  .compact table {
    table-layout: fixed;
  }

  .compact th:first-child,
  .compact td:first-child {
    width: 2.25rem;
  }

  .compact th:last-child,
  .compact td:last-child {
    width: 5.75rem;
    text-align: right;
  }

  .compact th:nth-child(2),
  .compact td:nth-child(2) {
    overflow: hidden;
  }

  .compact .entity-link {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Rank #1: soft accent tint across the row, accent marker on the rank cell. */
  .top-row td {
    background: var(--accent-soft);
  }

  .top-row td:first-child {
    color: var(--accent);
    font-weight: 700;
  }

  .selected-row td {
    background: var(--accent-soft);
  }

  .selected-row td:first-child {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .selected-row .entity-link {
    color: var(--accent);
    font-weight: 700;
  }

  .empty {
    color: var(--muted);
  }
</style>
