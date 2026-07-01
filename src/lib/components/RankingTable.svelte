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

  $: showPlaysColumn = metric !== 'plays';
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

<div class="table-wrap">
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
        <tr>
          <td>{index + 1}</td>
          <td>
            {#if showLinks}
              <a class="entity-link" href={entityHref(row)}>
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

  .empty {
    color: var(--muted);
  }
</style>
