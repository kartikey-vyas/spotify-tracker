<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import { dateRangeOptions, getPresetDateRange, type DateRangePreset } from '$lib/dateRanges';
  import {
    bestAvailableMetric,
    disabledMetricLabel,
    formatMetric,
    isMetricAvailable,
    metricOptions,
    metricValue
  } from '$lib/metrics';
  import { getEntityTimeline, getRankings } from '$lib/queries/rankings';
  import type { CalendarDay, EntityType, Metric, RankingRow } from '$lib/types';

  const entityOptions: Array<{ value: EntityType; label: string }> = [
    { value: 'artist', label: 'Artist' },
    { value: 'track', label: 'Track' },
    { value: 'album', label: 'Album' },
    { value: 'genre', label: 'Genre' }
  ];

  let mounted = false;
  let preset: DateRangePreset = 'last_30_days';
  let entityType: EntityType = 'artist';
  let metric: Metric = 'plays';
  let entityId = '';
  let rankings: RankingRow[] = [];
  let timeline: CalendarDay[] = [];
  let loading = false;
  let error = '';
  let lastKey = '';

  $: range = getPresetDateRange(preset);
  $: selectedRow = entityId ? rankings.find((row) => row.entity_id === entityId) ?? null : null;
  $: selectedValue = selectedRow ? metricValue(selectedRow, metric) : 0;
  $: timelineMetric = timelineDisplayMetric(rankings, metric);
  $: if (mounted && !loading && !isMetricAvailable(rankings, metric)) {
    metric = 'plays';
  }
  $: queryKey = `${preset}:${entityType}:${metric}:${entityId}`;
  $: if (mounted && queryKey !== lastKey) {
    void loadExplorer();
  }

  onMount(() => {
    const entityParam = $page.url.searchParams.get('entity');
    const idParam = $page.url.searchParams.get('id');
    if (entityParam && ['artist', 'track', 'album', 'genre'].includes(entityParam)) {
      entityType = entityParam as EntityType;
    }
    if (idParam) entityId = idParam;
    mounted = true;
    void loadExplorer();
  });

  async function loadExplorer(): Promise<void> {
    lastKey = queryKey;
    loading = true;
    error = '';

    try {
      rankings = await getRankings({
        entityType,
        start: range.start,
        end: range.end,
        metric,
        limit: 100
      });

      timeline = entityId
        ? await getEntityTimeline({
            entityType,
            entityId,
            start: range.start,
            end: range.end
          })
        : [];
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  }

  function timelineDisplayMetric(rows: RankingRow[], selectedMetric: Metric): 'minutes' | 'plays' {
    return selectedMetric === 'plays' || bestAvailableMetric(rows) === 'plays' ? 'plays' : 'minutes';
  }

  function timelineText(days: CalendarDay[], selectedMetric: 'minutes' | 'plays'): string {
    const maxValue = Math.max(1, ...days.map((day) => dayValue(day, selectedMetric)));
    return days.map((day) => glyph(dayValue(day, selectedMetric), maxValue)).join(' ');
  }

  function dayValue(day: CalendarDay, selectedMetric: 'minutes' | 'plays'): number {
    return selectedMetric === 'plays' ? day.plays : day.minutes;
  }

  function glyph(value: number, maxValue: number): string {
    if (value <= 0) return '.';
    return ['.', '-', '=', '+', '#'][Math.min(4, Math.ceil((value / maxValue) * 4))];
  }

  function asciiBarRows(rows: RankingRow[], selectedMetric: Metric, limit = 12): string[] {
    const chartRows = rows.slice(0, limit);
    const maxValue = Math.max(1, ...chartRows.map((row) => metricValue(row, selectedMetric)));

    return chartRows.map((row, index) => {
      const value = metricValue(row, selectedMetric);
      const filled = Math.max(0, Math.round((value / maxValue) * 24));
      const bar = '#'.repeat(filled).padEnd(24, '-');
      return `${String(index + 1).padStart(2, '0')} ${row.entity_name} [${bar}] ${formatMetric(value, selectedMetric)}`;
    });
  }
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Explorer</span>
    <h1>Compare listening windows</h1>
    <p class="lede">Use daily rollups for fast rankings by artist, track, album, and genre.</p>
  </div>

  <div class="toolbar">
    <div class="field">
      <label for="range">Date range</label>
      <select id="range" bind:value={preset}>
        {#each dateRangeOptions as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="entity">Entity</label>
      <select id="entity" bind:value={entityType} on:change={() => (entityId = '')}>
        {#each entityOptions as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="metric">Metric</label>
      <select id="metric" bind:value={metric}>
        {#each metricOptions as option}
          {@const disabled = !isMetricAvailable(rankings, option.value)}
          <option value={option.value} {disabled}>
            {disabled ? disabledMetricLabel(option.value) : option.label}
          </option>
        {/each}
      </select>
    </div>

    <div class="field grow">
      <label for="entity-id">Drilldown ID</label>
      <input id="entity-id" bind:value={entityId} placeholder="Optional entity_id" />
    </div>
  </div>

  {#if loading}
    <section class="panel section-gap"><p class="muted">Loading explorer data...</p></section>
  {:else if error}
    <section class="panel section-gap"><p class="error">{error}</p></section>
  {:else}
    {#if selectedRow}
      <section class="grid cols-3 section-gap">
        <div class="panel metric">
          <span class="muted">Selected</span>
          <strong>{selectedRow.entity_name}</strong>
        </div>
        <div class="panel metric">
          <span class="muted">Metric</span>
          <strong>{formatMetric(selectedValue, metric)}</strong>
        </div>
        <div class="panel metric">
          <span class="muted">Plays</span>
          <strong>{selectedRow.plays.toLocaleString()}</strong>
        </div>
      </section>

      <section class="panel section-gap">
        <h2>Listening over time</h2>
        <pre class="ascii-list">{timelineText(timeline, timelineMetric)}</pre>
      </section>
    {/if}

    <section class="grid cols-2 section-gap">
      <div class="panel">
        <h2>Ranking</h2>
        <RankingTable rows={rankings} {entityType} {metric} />
      </div>
      <div class="panel">
        <h2>Distribution</h2>
        <pre class="ascii-list">{asciiBarRows(rankings, metric).join('\n')}</pre>
      </div>
    </section>
  {/if}
</section>

<style>
  .grow {
    flex: 1;
    min-width: 220px;
  }

  .section-gap {
    margin-top: 16px;
  }

  .ascii-list {
    margin: 0;
    overflow-x: auto;
    color: var(--muted);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
