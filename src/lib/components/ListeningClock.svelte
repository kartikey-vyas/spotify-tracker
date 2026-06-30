<script lang="ts">
  import type { ClockBucket } from '$lib/types';
  import { buildHourClock } from '$lib/clock';

  export let buckets: ClockBucket[];

  $: clock = buildHourClock(buckets);

  const SIZE = 200;
  const C = SIZE / 2;
  const R_OUTER = 80;
  const R_INNER = 34;
  const R_LABEL = 92;
  const PAD_DEG = 1.4; // angular gap between hour wedges
  const HOUR_LABELS = [0, 6, 12, 18];

  // 0deg = top (midnight), increasing clockwise.
  function polar(r: number, deg: number): [number, number] {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
  }

  function sector(rIn: number, rOut: number, a0: number, a1: number): string {
    const [x0o, y0o] = polar(rOut, a0);
    const [x1o, y1o] = polar(rOut, a1);
    const [x1i, y1i] = polar(rIn, a1);
    const [x0i, y0i] = polar(rIn, a0);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0o} ${y0o} A ${rOut} ${rOut} 0 ${large} 1 ${x1o} ${y1o} ` +
      `L ${x1i} ${y1i} A ${rIn} ${rIn} 0 ${large} 0 ${x0i} ${y0i} Z`;
  }

  const hourText = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

  function tooltip(hour: number, value: number): string {
    return value > 0
      ? `${value.toLocaleString()} ${value === 1 ? 'play' : 'plays'} · ${hourText(hour)}`
      : `No plays · ${hourText(hour)}`;
  }

  $: wedges = clock.hours.map((slice) => {
    const a0 = slice.hour * 15 + PAD_DEG;
    const a1 = (slice.hour + 1) * 15 - PAD_DEG;
    const rValue = R_INNER + slice.fraction * (R_OUTER - R_INNER);
    return {
      hour: slice.hour,
      value: slice.value,
      track: sector(R_INNER, R_OUTER, a0, a1),
      fill: slice.fraction > 0 ? sector(R_INNER, rValue, a0, a1) : ''
    };
  });

  $: labels = HOUR_LABELS.map((hour) => {
    const [x, y] = polar(R_LABEL, hour * 15);
    return { hour, x, y };
  });
</script>

{#if clock.total > 0}
  <div class="clock">
    <svg viewBox="0 0 {SIZE} {SIZE}" role="img" aria-label="Plays by hour of day">
      {#each wedges as wedge (wedge.hour)}
        <path class="track" d={wedge.track}>
          <title>{tooltip(wedge.hour, wedge.value)}</title>
        </path>
        {#if wedge.fill}
          <path class="value" d={wedge.fill} />
        {/if}
      {/each}

      {#each labels as label (label.hour)}
        <text class="label" x={label.x} y={label.y}>{String(label.hour).padStart(2, '0')}</text>
      {/each}

      {#if clock.peakHour !== null}
        <text class="peak-value" x={C} y={C - 4}>{hourText(clock.peakHour)}</text>
        <text class="peak-label" x={C} y={C + 11}>peak</text>
      {/if}
    </svg>
  </div>
{/if}

<style>
  .clock {
    display: flex;
    justify-content: center;
    padding: 6px 0 2px;
  }

  svg {
    width: 100%;
    max-width: 260px;
    height: auto;
    font-family: inherit;
  }

  .track {
    fill: color-mix(in srgb, var(--line) 16%, transparent);
  }

  .value {
    fill: var(--accent);
    pointer-events: none;
  }

  .label {
    fill: var(--muted);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .peak-value {
    fill: var(--text);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .peak-label {
    fill: var(--muted);
    font-size: 7.5px;
    letter-spacing: 0.12em;
    text-anchor: middle;
    dominant-baseline: middle;
    text-transform: uppercase;
  }
</style>
