<script lang="ts">
  import { formatMinutes } from '$lib/metrics';
  import type { CalendarDay } from '$lib/types';

  export let days: CalendarDay[] = [];

  $: maxMinutes = Math.max(1, ...days.map((day) => day.minutes));
  $: points = days
    .map((day, index) => {
      const x = days.length <= 1 ? 0 : (index / (days.length - 1)) * 100;
      const y = 100 - (day.minutes / maxMinutes) * 88 - 6;
      return `${x},${y}`;
    })
    .join(' ');
</script>

<div class="timeline">
  {#if days.length > 0}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Listening over time">
      <polyline points={points} fill="none" stroke="var(--accent-dark)" stroke-width="2.5" vector-effect="non-scaling-stroke" />
    </svg>
    <div class="timeline-meta">
      <span>{days[0].local_date}</span>
      <strong>{formatMinutes(maxMinutes)} peak</strong>
      <span>{days[days.length - 1].local_date}</span>
    </div>
  {:else}
    <p class="muted">No timeline data available.</p>
  {/if}
</div>

<style>
  .timeline {
    display: grid;
    gap: 10px;
  }

  svg {
    width: 100%;
    height: 180px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background:
      linear-gradient(to right, rgba(217, 226, 220, 0.65) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(217, 226, 220, 0.65) 1px, transparent 1px),
      white;
    background-size: 20% 100%, 100% 25%;
  }

  .timeline-meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--muted);
    font-size: 0.84rem;
  }
</style>
