<script lang="ts">
  import { formatMetric } from '$lib/metrics';
  import type { CalendarDay } from '$lib/types';

  export let days: CalendarDay[] = [];
  export let metric: 'minutes' | 'plays' = 'minutes';

  $: maxValue = Math.max(1, ...days.map((day) => valueFor(day)));
  $: sparkline = days
    .map((day) => glyph(valueFor(day)))
    .join(' ');

  function valueFor(day: CalendarDay): number {
    return metric === 'plays' ? day.plays : day.minutes;
  }

  function glyph(value: number): string {
    if (value <= 0) return '.';
    const level = Math.min(4, Math.ceil((value / maxValue) * 4));
    return ['.', '-', '=', '+', '#'][level];
  }
</script>

<div class="timeline">
  {#if days.length > 0}
    <pre aria-label="Listening over time">{sparkline}</pre>
    <div class="timeline-meta">
      <span>{days[0].local_date}</span>
      <strong>{formatMetric(maxValue, metric)} peak</strong>
      <span>{days[days.length - 1].local_date}</span>
    </div>
  {:else}
    <p class="muted">No timeline data available.</p>
  {/if}
</div>

<style>
  .timeline {
    display: grid;
    gap: 8px;
  }

  pre {
    width: 100%;
    min-height: 44px;
    margin: 0;
    padding: 8px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--text);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .timeline-meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--muted);
    font-size: 0.84rem;
  }
</style>
