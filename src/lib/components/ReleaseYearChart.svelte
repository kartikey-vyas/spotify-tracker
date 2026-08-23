<script lang="ts">
  import type { ReleaseYearBucket } from '$lib/types';
  import {
    buildReleaseYearChart,
    EARLIEST_RELEASE_YEAR,
    type ReleaseYearBar
  } from '$lib/release-years';
  import { formatPlays } from '$lib/metrics';
  import { tooltip as tipAction } from '$lib/actions/tooltip';

  export let buckets: ReleaseYearBucket[];

  $: chart = buildReleaseYearChart(buckets);
  $: lastYear = chart.bars.length > 0 ? chart.bars[chart.bars.length - 1].year : null;

  // Label decade boundaries plus the most recent year to keep the axis readable.
  const showLabel = (year: number): boolean => year % 10 === 0 || year === lastYear;
  const yearLabel = (year: number): string =>
    year === EARLIEST_RELEASE_YEAR ? `≤${EARLIEST_RELEASE_YEAR}` : String(year);

  function tooltip(bar: ReleaseYearBar): string {
    const label = yearLabel(bar.year);
    return bar.value > 0 ? `${label} · ${formatPlays(bar.value)}` : `${label} · No plays`;
  }
</script>

{#if chart.bars.length > 0}
  <div class="chart-scroll">
    <div class="histogram">
      <div class="bars" role="img" aria-label="Plays by release year">
        {#each chart.bars as bar (bar.year)}
          <div class="col" use:tipAction={tooltip(bar)}>
            <div
              class="bar"
              class:empty={bar.value === 0}
              class:max={bar.fraction === 1}
              style="height: {bar.value > 0 ? Math.max(2, bar.fraction * 100) : 0}%"
            ></div>
          </div>
        {/each}
      </div>

      <div class="axis" aria-hidden="true">
        {#each chart.bars as bar (bar.year)}
          <span class="tick">{showLabel(bar.year) ? yearLabel(bar.year) : ''}</span>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .chart-scroll {
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .histogram {
    min-width: 100%;
    width: max-content;
  }

  .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 150px;
  }

  .col {
    display: flex;
    flex: 1 0 5px;
    flex-direction: column;
    justify-content: flex-end;
    height: 100%;
  }

  /* Softened accent for the field of bars; the tallest year in full accent. */
  .bar {
    width: 100%;
    background: color-mix(in oklab, var(--accent) 55%, var(--surface-2));
  }

  .bar.max {
    background: var(--accent);
  }

  .bar.empty {
    background: color-mix(in srgb, var(--line) 16%, transparent);
    height: 2px;
  }

  .col:hover .bar:not(.empty) {
    background: var(--accent-dark);
  }

  .axis {
    display: flex;
    gap: 2px;
    margin-top: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--muted);
  }

  .tick {
    flex: 1 0 5px;
    overflow: visible;
    font-variant-numeric: tabular-nums;
    text-align: center;
    white-space: nowrap;
  }
</style>
