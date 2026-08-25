<script lang="ts">
  import { formatMetric } from '$lib/metrics';
  import {
    buildTimelineHistogram,
    monthlyBarWidth,
    timelineBucketMode,
    type TimelineHistogramBucket
  } from '$lib/monthlyTimeline';
  import type { CalendarDay } from '$lib/types';

  export let days: CalendarDay[] = [];
  export let start: string;
  export let end: string;
  export let metric: 'minutes' | 'plays' = 'plays';
  export let entityName: string;

  $: buckets = buildTimelineHistogram(days, start, end);
  $: bucketMode = timelineBucketMode(start, end);
  $: maxValue = Math.max(0, ...buckets.map((bucket) => bucket[metric]));
  $: total = buckets.reduce((sum, bucket) => sum + bucket[metric], 0);
  $: metricLabel = metric === 'minutes' ? 'Minutes' : 'Plays';
  $: accessibleLabel = `${entityName} listening history from ${start} to ${end}: ${formatMetric(total, metric)} total ${metricLabel.toLowerCase()} across ${buckets.length} ${bucketMode === 'month' ? 'monthly' : 'daily'} buckets.`;

  function bucketTitle(bucket: TimelineHistogramBucket): string {
    return `${bucket.key}: ${formatMetric(bucket[metric], metric)}`;
  }
</script>

{#if buckets.length > 0}
  <div
    class="histogram"
    class:is-daily={bucketMode === 'day'}
    role="img"
    aria-label={accessibleLabel}
  >
    {#each buckets as bucket}
      {@const value = bucket[metric]}
      <div class="histogram-column" title={bucketTitle(bucket)} aria-hidden="true">
        <div
          class="histogram-bar"
          class:is-empty={value <= 0}
          style:height={`${monthlyBarWidth(value, maxValue)}%`}
        ></div>
        {#if bucket.label}
          <span class="histogram-label">{bucket.label}</span>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <p class="muted">No listening history for this range.</p>
{/if}

<style>
  .histogram {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    min-height: 118px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 0 24px;
    border-bottom: 1px solid var(--line);
    scrollbar-gutter: stable;
  }

  .histogram-column {
    position: relative;
    display: flex;
    flex: 0 0 10px;
    align-items: flex-end;
    height: 86px;
  }

  .histogram.is-daily .histogram-column {
    flex-basis: 4px;
    gap: 1px;
  }

  .histogram-bar {
    width: 100%;
    min-height: 1px;
    background: var(--accent);
  }

  .histogram-bar.is-empty {
    min-height: 0;
    background: transparent;
  }

  .histogram-label {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    color: var(--muted);
    font-size: var(--text-2xs);
    line-height: 1;
    white-space: nowrap;
  }
</style>
