<script lang="ts">
  import { formatMetric } from '$lib/metrics';
  import type { CalendarDay } from '$lib/types';

  export let days: CalendarDay[] = [];
  export let metric: 'minutes' | 'plays' = 'minutes';

  $: maxValue = Math.max(1, ...days.map((day) => valueFor(day)));

  function valueFor(day: CalendarDay): number {
    return metric === 'plays' ? day.plays : day.minutes;
  }

  function level(value: number): number {
    if (value <= 0) return 0;
    return Math.min(4, Math.ceil((value / maxValue) * 4));
  }
</script>

<div class="calendar" aria-label="Listening calendar">
  {#each days as day}
    <span
      class={`day level-${level(valueFor(day))}`}
      title={`${day.local_date}: ${formatMetric(valueFor(day), metric)}, ${day.plays} plays`}
    ></span>
  {:else}
    <p class="muted">No calendar data available.</p>
  {/each}
</div>

<style>
  .calendar {
    display: grid;
    grid-template-columns: repeat(53, minmax(8px, 1fr));
    grid-auto-rows: 12px;
    grid-auto-flow: column;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .day {
    width: 100%;
    min-width: 10px;
    height: 12px;
    border-radius: 3px;
    background: #e4ebe6;
  }

  .level-1 {
    background: #bfe9cb;
  }

  .level-2 {
    background: #72d68e;
  }

  .level-3 {
    background: #1db954;
  }

  .level-4 {
    background: #0d7a36;
  }

  @media (max-width: 760px) {
    .calendar {
      grid-template-columns: repeat(26, minmax(10px, 1fr));
    }
  }
</style>
