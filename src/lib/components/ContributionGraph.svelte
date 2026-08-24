<script lang="ts">
  import type { CalendarDay } from '$lib/types';
  import { melbourneToday } from '$lib/dateRanges';
  import { formatPlays } from '$lib/metrics';
  import { tooltip as tipAction } from '$lib/actions/tooltip';
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
  let yearButtons: Record<number, HTMLButtonElement | null> = {};

  $: years = availableYears(days);
  // Default to the newest year, and re-snap if the data set changes under us.
  $: if (years.length > 0 && (selectedYear === null || !years.includes(selectedYear))) {
    selectedYear = years[0];
  }
  $: grid =
    selectedYear === null
      ? null
      : buildYearGrid(days, selectedYear, metric, { endDate: melbourneToday() });
  // Below 800px the picker is a horizontal rail, so the selected year can sit off
  // screen — after a click, and after the default snap above picks the newest year.
  // `nearest` on both axes so this only ever moves the rail, never the page.
  // Re-runs once bind:this fills the map, which is when the button first exists.
  $: yearButtons[selectedYear ?? -1]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const noun = metric === 'plays' ? 'plays' : 'minutes';
  const amount = (value: number): string =>
    metric === 'plays' ? formatPlays(value) : `${value} min`;

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
                  <span class="cell" data-level={cell.level} use:tipAction={tooltip(cell)}></span>
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
        {#each years as year (year)}
          <button
            bind:this={yearButtons[year]}
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
    /* Size to the grid and allow shrinking so it scrolls in place. Deliberately
       does not grow: the grid is a fixed 12px per week, so a growing column just
       strands the year picker against the far edge — worst in January, when only
       a few weeks are drawn. */
    flex: 0 1 auto;
    min-width: 0;
  }

  .graph-scroll {
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
  }

  /* Two columns: weekday labels gutter + the cells. Months row spans the top. */
  .graph {
    --cell: 10px;
    --gap: 2px;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    gap: var(--space-2);
    width: max-content;
  }

  .months {
    grid-column: 2;
    display: grid;
    grid-template-columns: repeat(var(--columns), var(--cell));
    gap: var(--gap);
    font-size: var(--text-2xs);
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
    font-size: var(--text-2xs);
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

  /* Stepped ramp from --surface-2 toward --accent (flat solids, no alpha) so
     the calendar picks up each theme's accent while empty days stay quiet. */
  .cell {
    width: var(--cell);
    height: var(--cell);
    background: var(--surface-2);
  }

  .cell[data-level='1'] {
    background: var(--data-1);
  }
  .cell[data-level='2'] {
    background: var(--data-2);
  }
  .cell[data-level='3'] {
    background: var(--data-3);
  }
  .cell[data-level='4'] {
    background: var(--data-4);
  }

  .cell.pad {
    background: transparent;
  }

  .legend {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-3);
    font-size: var(--text-2xs);
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
    /* Show ~5 years; the rest scroll. A reserved (stable) gutter keeps the thin
       scrollbar from ever overlapping or clipping the labels, whether the OS
       uses overlay or always-visible scrollbars. */
    max-height: 8.5rem;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
  }

  /* WebKit fallback (Safari / older Chrome) for the thin themed scrollbars. */
  .years::-webkit-scrollbar,
  .graph-scroll::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .years::-webkit-scrollbar-track,
  .graph-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .years::-webkit-scrollbar-thumb,
  .graph-scroll::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: var(--line);
  }

  .years::-webkit-scrollbar-thumb:hover,
  .graph-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--muted);
  }

  .years button {
    min-height: 0;
    /* Keep full height inside the capped, scrollable column (don't flex-shrink). */
    flex: 0 0 auto;
    padding: var(--space-1);
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .years button:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .years button.active {
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* Phone: the picker column costs width the grid needs, so stack it as a
     horizontal rail above the grid instead. Restructuring the container to a
     column leaves .calendar-main's no-grow rule untouched — it only governs the
     row axis, which no longer exists here. */
  @media (max-width: 800px) {
    .calendar {
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-2);
    }

    /* Grid stays first in the DOM so it leads the reading order; only the visual
       order flips. */
    .years {
      order: -1;
      flex-direction: row;
      flex-wrap: nowrap;
      gap: var(--space-1);
      max-height: none;
      overflow-x: auto;
      overflow-y: hidden;
      /* A scrollbar under a single-line rail costs more height than it earns on a
         phone, and the years are reachable by swipe or keyboard without it. */
      scrollbar-gutter: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .years::-webkit-scrollbar {
      display: none;
    }

    .years button {
      padding: var(--space-1) var(--space-2);
      text-align: center;
      white-space: nowrap;
    }
  }
</style>
