<script lang="ts">
  import { base } from '$app/paths';
  import { formatMetric, metricValue } from '$lib/metrics';
  import type { EntityType, Metric, RankingRow } from '$lib/types';

  export let rows: RankingRow[] = [];
  export let entityType: EntityType;
  export let metric: Metric = 'minutes';
  export let showLinks = true;
</script>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Name</th>
        <th>{metric === 'skip_rate' ? 'Skip rate' : 'Metric'}</th>
        <th>Plays</th>
        <th>Unknown</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row, index}
        <tr>
          <td>{index + 1}</td>
          <td>
            {#if showLinks}
              <a
                class="entity-link"
                href="{base}/explore/?entity={entityType}&id={encodeURIComponent(row.entity_id)}"
              >
                {row.entity_name}
              </a>
            {:else}
              {row.entity_name}
            {/if}
          </td>
          <td>{formatMetric(metricValue(row, metric), metric)}</td>
          <td>{row.plays.toLocaleString()}</td>
          <td>{row.unknown_duration_plays.toLocaleString()}</td>
        </tr>
      {:else}
        <tr>
          <td colspan="5" class="empty">No listening data for this view.</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .entity-link {
    color: var(--accent-dark);
    font-weight: 720;
  }

  .empty {
    color: var(--muted);
  }
</style>
