<script lang="ts">
  import type { ClockBucket } from '$lib/types';
  import { buildClockGrid, type ClockCell, type ClockRow } from '$lib/clock';

  export let buckets: ClockBucket[];

  $: grid = buildClockGrid(buckets);

  const HOUR_LABELS = [0, 6, 12, 18];
  const hourText = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

  function tooltip(row: ClockRow, cell: ClockCell): string {
    const when = `${row.label} ${hourText(cell.hour)}`;
    return cell.value > 0
      ? `${cell.value} ${cell.value === 1 ? 'play' : 'plays'} · ${when}`
      : `No plays · ${when}`;
  }
</script>

{#if grid.rows.length > 0}
  <div class="clock-scroll">
    <div class="clock">
      <div class="days" aria-hidden="true">
        {#each grid.rows as row (row.dayIndex)}
          <span class="day">{row.label}</span>
        {/each}
      </div>

      <div class="cells" role="img" aria-label="Listening activity by hour of day and weekday">
        {#each grid.rows as row (row.dayIndex)}
          {#each row.cells as cell (cell.hour)}
            <span class="cell" data-level={cell.level} title={tooltip(row, cell)}></span>
          {/each}
        {/each}
      </div>

      <div class="hours" aria-hidden="true">
        {#each HOUR_LABELS as hour}
          <span class="hour" style="grid-column: {hour + 1}">{hourText(hour)}</span>
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
{/if}

<style>
  .clock-scroll {
    overflow-x: auto;
    padding-bottom: 4px;
  }

  /* Day-label gutter + 24 hour columns; hour labels sit on the bottom row. */
  .clock {
    --cell: 13px;
    --gap: 3px;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    gap: 4px 6px;
    width: max-content;
  }

  .days {
    grid-column: 1;
    grid-row: 1;
    display: grid;
    grid-template-rows: repeat(7, var(--cell));
    gap: var(--gap);
    font-size: 0.68rem;
    color: var(--muted);
  }

  .day {
    line-height: var(--cell);
  }

  .cells {
    grid-column: 2;
    grid-row: 1;
    display: grid;
    grid-template-columns: repeat(24, var(--cell));
    grid-auto-rows: var(--cell);
    gap: var(--gap);
  }

  .hours {
    grid-column: 2;
    grid-row: 2;
    display: grid;
    grid-template-columns: repeat(24, var(--cell));
    gap: var(--gap);
    font-size: 0.68rem;
    color: var(--muted);
  }

  .hour {
    grid-row: 1;
    white-space: nowrap;
  }

  .cell {
    width: var(--cell);
    height: var(--cell);
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

  .legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    font-size: 0.72rem;
  }

  .legend .cell {
    width: 13px;
    height: 13px;
  }
</style>
