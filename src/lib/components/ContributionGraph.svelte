<script lang="ts">
  import type { CalendarDay } from '$lib/types';
  import { melbourneToday } from '$lib/dateRanges';
  import {
    availableYears,
    buildYearGrid,
    WEEKDAY_LABELS,
    type CalendarMetric,
    type ContributionCell
  } from '$lib/calendar';

  export let days: CalendarDay[];
  export let metric: CalendarMetric = 'plays';

  let selectedYear: number | null = null;

  $: years = availableYears(days);
  // Default to the newest year, and re-snap if the data set changes under us.
  $: if (years.length > 0 && (selectedYear === null || !years.includes(selectedYear))) {
    selectedYear = years[0];
  }
  $: grid =
    selectedYear === null
      ? null
      : buildYearGrid(days, selectedYear, metric, { endDate: melbourneToday() });

  const noun = metric === 'plays' ? 'plays' : 'minutes';
  const amount = (value: number): string =>
    metric === 'plays' ? `${value} ${value === 1 ? 'play' : 'plays'}` : `${value} min`;

  function tooltip(cell: ContributionCell): string {
    if (!cell.inRange) return '';
    const label = new Date(`${cell.date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    return cell.value > 0 ? `${amount(cell.value)} · ${label}` : `No ${noun} · ${label}`;
  }
</script>

{#if grid && grid.weeks.length > 0}
  <div class="calendar">
    <div class="calendar-main">
      <div class="graph-scroll">
        <div class="graph" style="--columns: {grid.weeks.length}">
          <div class="months">
            {#each grid.monthLabels as { column, label } (column)}
              <span class="month" style="grid-column: {column + 1}">{label}</span>
            {/each}
          </div>

          <div class="weekdays" aria-hidden="true">
            {#each WEEKDAY_LABELS as label}
              <span class="weekday">{label}</span>
            {/each}
          </div>

          <div class="cells" role="img" aria-label="Listening activity in {selectedYear}">
            {#each grid.weeks as week}
              {#each week as cell (cell.date)}
                {#if cell.inRange}
                  <span class="cell" data-level={cell.level} title={tooltip(cell)}></span>
                {:else}
                  <span class="cell pad"></span>
                {/if}
              {/each}
            {/each}
          </div>
        </div>
      </div>

      <div class="legend">
        <span class="muted">Less</span>
        {#each [0, 1, 2, 3, 4] as level}
          <span class="cell" data-level={level}></span>
        {/each}
        <span class="muted">More</span>
      </div>
    </div>

    {#if years.length > 1}
      <div class="years" role="radiogroup" aria-label="Year">
        {#each years as year}
          <button
            class:active={year === selectedYear}
            type="button"
            role="radio"
            aria-checked={year === selectedYear}
            on:click={() => (selectedYear = year)}
          >
            {year}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .calendar {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }

  .calendar-main {
    /* Take the leftover width and allow shrinking so the grid scrolls in place. */
    flex: 1 1 0;
    min-width: 0;
  }

  .graph-scroll {
    overflow-x: auto;
    padding-bottom: 4px;
  }

  /* Two columns: weekday labels gutter + the cells. Months row spans the top. */
  .graph {
    --cell: 11px;
    --gap: 3px;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    gap: 4px 6px;
    width: max-content;
  }

  .months {
    grid-column: 2;
    display: grid;
    grid-template-columns: repeat(var(--columns), var(--cell));
    gap: var(--gap);
    font-size: 0.72rem;
    color: var(--muted);
  }

  .month {
    grid-row: 1;
    white-space: nowrap;
  }

  .weekdays {
    grid-column: 1;
    grid-row: 2;
    display: grid;
    grid-template-rows: repeat(7, var(--cell));
    gap: var(--gap);
    font-size: 0.68rem;
    color: var(--muted);
  }

  .weekday {
    line-height: var(--cell);
  }

  .cells {
    grid-column: 2;
    grid-row: 2;
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, var(--cell));
    grid-auto-columns: var(--cell);
    gap: var(--gap);
  }

  .cell {
    width: var(--cell);
    height: var(--cell);
    border-radius: 2px;
    background: color-mix(in srgb, var(--line) 16%, transparent);
  }

  .cell[data-level='1'] {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .cell[data-level='2'] {
    background: color-mix(in srgb, var(--accent) 48%, transparent);
  }
  .cell[data-level='3'] {
    background: color-mix(in srgb, var(--accent) 72%, transparent);
  }
  .cell[data-level='4'] {
    background: var(--accent);
  }

  .cell.pad {
    background: transparent;
  }

  .legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    font-size: 0.72rem;
  }

  .legend .cell {
    width: 11px;
    height: 11px;
  }

  .years {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 2px;
  }

  .years button {
    min-height: 0;
    padding: 3px 10px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
    text-align: left;
  }

  .years button:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .years button.active {
    background: var(--text);
    color: var(--bg);
  }
</style>
