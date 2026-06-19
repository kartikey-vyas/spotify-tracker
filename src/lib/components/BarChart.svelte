<script lang="ts">
  import { formatMetric, metricValue } from '$lib/metrics';
  import type { Metric, RankingRow } from '$lib/types';

  export let rows: RankingRow[] = [];
  export let metric: Metric = 'minutes';
  export let limit = 8;

  $: chartRows = rows.slice(0, limit);
  $: maxValue = Math.max(1, ...chartRows.map((row) => metricValue(row, metric)));
</script>

<div class="bars" aria-label="Ranking bar chart">
  {#each chartRows as row}
    <div class="bar-row">
      <div class="bar-label" title={row.entity_name}>{row.entity_name}</div>
      <div class="bar-track">
        <span style={`width: ${(metricValue(row, metric) / maxValue) * 100}%`}></span>
      </div>
      <div class="bar-value">{formatMetric(metricValue(row, metric), metric)}</div>
    </div>
  {:else}
    <p class="muted">No chart data available.</p>
  {/each}
</div>

<style>
  .bars {
    display: grid;
    gap: 12px;
  }

  .bar-row {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(120px, 2fr) minmax(78px, auto);
    align-items: center;
    gap: 10px;
  }

  .bar-label {
    overflow: hidden;
    color: var(--text);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-track {
    height: 12px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-2);
  }

  .bar-track span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent), var(--blue));
  }

  .bar-value {
    color: var(--muted);
    font-size: 0.86rem;
    font-weight: 700;
    text-align: right;
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .bar-row {
      grid-template-columns: 1fr;
      gap: 6px;
    }

    .bar-value {
      text-align: left;
    }
  }
</style>
