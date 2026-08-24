<script lang="ts">
  import type { CalendarDay } from '$lib/types';
  import { melbourneToday } from '$lib/dateRanges';
  import { formatPlays } from '$lib/metrics';
  import { tooltip as tipAction } from '$lib/actions/tooltip';
  import {
    buildYearGrid,
    yearTotals,
    WEEKDAY_LABELS,
    type CalendarMetric,
    type ContributionCell
  } from '$lib/calendar';

  export let days: CalendarDay[];
  export let metric: CalendarMetric = 'plays';

  let selectedYear: number | null = null;
  let yearButtons: Record<number, HTMLButtonElement | null> = {};

  $: totals = yearTotals(days, metric);
  $: years = totals.map((total) => total.year);
  // How many years stack in one rail column before the next one starts. Seven is
  // what fits beside the clock at desktop widths without the rail becoming the
  // thing that sets the row's height.
  const RAIL_MAX_ROWS = 7;
  // Balanced rather than filled: 8 years read better as 4 + 4 than as 7 + 1, and
  // both are one column short of the cap either way.
  $: railRows =
    totals.length === 0
      ? 1
      : Math.ceil(totals.length / Math.ceil(totals.length / RAIL_MAX_ROWS));
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

    {#if totals.length > 1}
      <div class="years" role="radiogroup" aria-label="Year" style="--rail-rows: {railRows}">
        {#each totals as total (total.year)}
          <button
            bind:this={yearButtons[total.year]}
            class:active={total.year === selectedYear}
            type="button"
            role="radio"
            aria-checked={total.year === selectedYear}
            style="--share: {total.share.toFixed(3)}"
            use:tipAction={`${amount(total.value)} · ${total.year}`}
            on:click={() => (selectedYear = total.year)}
          >
            {total.year}
          </button>
        {/each}
      </div>
    {:else if totals.length === 1}
      <!-- A single year is not a choice, so it is a caption rather than a picker.
           It is still worth drawing: without it nothing on the panel says which
           year the squares belong to, which is exactly the account where that is
           least obvious. No bar — a lone year is always 100% of itself, so the
           bar would carry no information. -->
      <p class="years"><span class="only-year">{totals[0].year}</span></p>
    {/if}
  </div>
{/if}

<style>
  .calendar {
    display: flex;
    /* The rail is the taller of the two once it wraps into columns, so centring
       hangs the grid against the middle of it. */
    align-items: center;
    gap: var(--space-4);
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

  /* Same affordance as the release-year chart: the hovered day darkens while
     the tooltip names it. Scoped to .cells so the legend key, which reuses
     .cell, stays inert — it is a caption, not data.

     The outline does most of the visible work here. A bar is tall enough that
     recolouring it reads from anywhere, but a 10px square sits almost entirely
     under the pointer, so on its own the fill change is easy to miss. */
  .cells .cell:not(.pad):hover {
    outline: 1px solid var(--text);
  }

  /* A day with no plays keeps its empty fill — darkening it toward the accent
     would imply listening that did not happen. The chart leaves its empty bars
     alone for the same reason. */
  .cells .cell:not(.pad):not([data-level='0']):hover {
    background: var(--accent-dark);
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

  /* An index rail rather than a scrolling list. It used to be one capped column
     with `overflow-y: auto`, which meant a permanent scrollbar and a year clipped
     through the middle of its digits for anyone with more than five years of
     history — while the panel beside it had ~100px of unused height, because the
     row is as tall as the clock and the grid cannot grow into it.

     Columns spend both: the rail takes the height the clock already gives the
     row, and years past the seventh start a second column in the space the panel
     already had to the right of the grid. Nothing scrolls, nothing is clipped.

     A GRID rather than `flex-flow: column wrap`, which was the first attempt and
     is broken in Safari: WebKit sizes a wrapping column-flex container to ONE
     column, so the rest overflow its box — between 820px and 1180px wide they
     land on top of the listening clock. Chromium sizes it to all the columns and
     shows nothing wrong, so this only appears if you check WebKit. Grid has no
     such disagreement, and it needs no definite height to flow against, which
     also retires the magic max-height the flex version needed. */
  .years {
    display: grid;
    flex: 0 0 auto;
    /* Fill down --rail-rows, then start a column. The row count comes from the
       component so it can balance the columns (4 + 4 rather than 7 + 1). */
    grid-auto-flow: column;
    grid-template-rows: repeat(var(--rail-rows, 1), auto);
    grid-auto-columns: max-content;
    /* The single-year caption is a <p>, which arrives with the global paragraph
       margin. */
    margin: 0;
    gap: var(--space-0-5) var(--space-2);
  }

  /* WebKit fallback (Safari / older Chrome) for the thin themed scrollbar. */
  .graph-scroll::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .graph-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .graph-scroll::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: var(--line);
  }

  .graph-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--muted);
  }

  .years button {
    position: relative;
    min-height: 0;
    /* Roomier at the bottom than the top: the year's bar lives in that space. */
    padding: var(--space-1) var(--space-2) var(--space-2);
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  /* A rule under each year, as long as that year was loud relative to the
     busiest one, so the rail doubles as a coarse history of the account instead
     of being a bare list of numbers.

     A rule rather than a filled row, which was the first attempt and was wrong:
     the selected year is already a filled accent block, so filled rows in a
     second colour read as "also selected" rather than as data. A 2px rule cannot
     be confused with a selection.

     scaleX on a full-width bar rather than a percentage width, because the width
     has to be measured inside the button's own padding — anchoring to `right`
     with a percentage width would measure against the padding box and hang the
     long bars out past the left edge. */
  .years button::after {
    content: '';
    position: absolute;
    right: var(--space-2);
    bottom: var(--space-0-5);
    left: var(--space-2);
    height: 2px;
    /* --data-bar, not a ramp step: this is one series with no ramp to sit on,
       which is the case that token exists for. It happens to equal --data-2
       today; taking the ramp step would silently break if the ramp is retuned. */
    background: var(--data-bar);
    /* Right-anchored, so every bar ends on the same line as the digits above it
       and the rail reads right-to-left off a shared edge. */
    transform: scaleX(var(--share, 0));
    transform-origin: right;
  }

  .years button:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .years button.active {
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* --data-bar is nearly the accent itself, so it vanishes on the selected block.
     Ink at reduced weight keeps the bar readable without competing with the
     digits. */
  .years button.active::after {
    background: var(--accent-ink);
    opacity: 0.4;
  }

  /* The lone year of a single-year account: same type as a year button, but flat
     — no hit target, no bar, nothing to suggest there is a choice here. */
  .only-year {
    padding: var(--space-1) var(--space-2);
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  /* Phone: the rail's columns cost width the grid needs, so lay it along the top
     as a single scrolling line instead. .calendar-main's no-grow rule survives
     the switch untouched — it governs the row axis, which no longer exists here
     — but its alignment does not; see below. */
  @media (max-width: 800px) {
    .calendar {
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-2);
    }

    /* align-self is the horizontal axis now, so the `center` both of these carry
       for the desktop rail shrink-wraps them to max-content — 662px of grid and
       of year rail inside a 390px phone — and pushes the whole document sideways
       instead of letting each one's own overflow-x take it. Probe for this with
       documentElement.scrollWidth > clientWidth at 390px; it does not look like
       anything in a screenshot of the component alone. */
    .calendar-main,
    .years {
      align-self: stretch;
    }

    /* Grid stays first in the DOM so it leads the reading order; only the visual
       order flips. */
    .years {
      order: -1;
      /* One row, however many years there are: the grid keeps flowing along
         columns and the row scrolls. --rail-rows is ignored here rather than
         recomputed, so the phone layout owes the component nothing. */
      grid-template-rows: auto;
      gap: var(--space-1);
      /* Not centred: a centred rail that overflows scrolls its own first years
         out of reach on the left, with no way back. */
      justify-content: start;
      overflow-x: auto;
      overflow-y: hidden;
      /* A scrollbar under a single-line rail costs more height than it earns on a
         phone, and the years are reachable by swipe or keyboard without it. */
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
