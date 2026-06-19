<script lang="ts">
  import { formatMetric, metricValue } from '$lib/metrics';
  import type { Metric, RankingRow } from '$lib/types';

  export let rows: RankingRow[] = [];
  export let metric: Metric = 'minutes';
  export let limit = 8;

  const barWidth = 24;

  $: chartRows = rows.slice(0, limit);
  $: maxValue = Math.max(1, ...chartRows.map((row) => metricValue(row, metric)));

  function rankLabel(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  function asciiBar(value: number): string {
    const filled = Math.max(0, Math.round((value / maxValue) * barWidth));
    return '#'.repeat(filled).padEnd(barWidth, '-');
  }
</script>

<div class="bars" aria-label="Ranking bar chart">
  {#each chartRows as row, index}
    {@const value = metricValue(row, metric)}
    <div class="bar-row">
      <div class="bar-rank">{rankLabel(index)}</div>
      <div class="bar-label" title={row.entity_name}>{row.entity_name}</div>
      <div class="bar-track">[{asciiBar(value)}]</div>
      <div class="bar-value">{formatMetric(value, metric)}</div>
    </div>
  {:else}
    <p class="muted">No chart data available.</p>
  {/each}
</div>

<style>
  .bars {
    display: grid;
    gap: 6px;
  }

  .bar-row {
    display: grid;
    grid-template-columns: 3ch minmax(14ch, 1fr) minmax(28ch, auto) minmax(8ch, auto);
    align-items: baseline;
    gap: 8px;
  }

  .bar-rank {
    color: var(--muted);
  }

  .bar-label {
    overflow: hidden;
    color: var(--text);
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-track {
    overflow: hidden;
    color: var(--muted);
    white-space: nowrap;
  }

  .bar-value {
    color: var(--muted);
    text-align: right;
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .bar-row {
      grid-template-columns: 3ch minmax(0, 1fr) minmax(8ch, auto);
      gap: 4px 8px;
    }

    .bar-track {
      grid-column: 2 / 4;
    }

    .bar-value {
      text-align: left;
    }
  }
</style>
