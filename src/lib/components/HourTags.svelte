<script lang="ts">
  import type { HourTagBucket, HourTagLabel } from '$lib/types';
  import { formatLift, hourRange, HOUR_PART_NAMES } from '$lib/insights';
  import { formatPlays } from '$lib/metrics';
  import { tooltip as tipAction } from '$lib/actions/tooltip';

  export let buckets: HourTagBucket[];

  function labelTooltip(label: HourTagLabel): string {
    return `${formatPlays(label.plays)} · ${formatLift(label.lift)} your usual share`;
  }
</script>

<ol class="parts">
  {#each buckets as bucket (bucket.part)}
    <li>
      <div class="part-head">
        <span class="part-name">{HOUR_PART_NAMES[bucket.part]}</span>
        <span class="part-hours">{hourRange(bucket)}</span>
      </div>
      {#if bucket.labels.length > 0}
        <ol class="labels">
          {#each bucket.labels as label, index (label.label)}
            <li class:top={index === 0} use:tipAction={labelTooltip(label)}>
              <span class="label">{label.label}</span>
              <span class="lift">{formatLift(label.lift)}</span>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="empty">Nothing stands out</p>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .parts {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .part-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-2);
    padding-bottom: var(--space-1);
    margin-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  .part-name {
    font-weight: 700;
  }

  .part-hours {
    color: var(--muted);
    font-size: var(--text-2xs);
    line-height: var(--leading-2xs);
    font-variant-numeric: tabular-nums;
  }

  .labels {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .labels li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 2px 0;
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lift {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  /* The part's strongest tag gets the accent, like a #1 rank. */
  .labels li.top .label,
  .labels li.top .lift {
    color: var(--accent);
  }

  .empty {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  @media (max-width: 900px) {
    .parts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 480px) {
    .parts {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
