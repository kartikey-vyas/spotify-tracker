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

  function glyph(value: number): string {
    return ['.', '-', '=', '+', '#'][level(value)];
  }
</script>

<div class="calendar" aria-label="Listening calendar">
  {#each days as day}
    <span
      class={`day level-${level(valueFor(day))}`}
      title={`${day.local_date}: ${formatMetric(valueFor(day), metric)}, ${day.plays} plays`}
      >{glyph(valueFor(day))}</span
    >
  {:else}
    <p class="muted">No calendar data available.</p>
  {/each}
</div>

<style>
  .calendar {
    display: block;
    overflow-x: auto;
    padding-bottom: 2px;
    color: var(--muted);
    font-size: 0.95rem;
    line-height: 1.35;
    word-break: break-all;
  }

  .day {
    display: inline-block;
    width: 1ch;
    text-align: center;
  }

  .level-1 {
    color: var(--text);
  }

  .level-2 {
    color: var(--text);
  }

  .level-3 {
    color: var(--text);
  }

  .level-4 {
    color: var(--text);
  }

  @media (max-width: 760px) {
    .calendar {
      font-size: 0.9rem;
    }
  }
</style>
