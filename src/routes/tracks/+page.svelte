<script lang="ts">
  import { onMount } from 'svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import { getPresetDateRange } from '$lib/dateRanges';
  import { getRankings } from '$lib/queries/rankings';
  import type { Metric, RankingRow } from '$lib/types';

  let rows: RankingRow[] = [];
  let error = '';
  let loading = true;
  const range = getPresetDateRange('last_30_days');
  const metric: Metric = 'plays';

  onMount(async () => {
    try {
      rows = await getRankings({ entityType: 'track', start: range.start, end: range.end, metric, limit: 100 });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  });
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Tracks</span>
    <h1>Top tracks</h1>
    <p class="lede">Last 30 days by API-synced plays.</p>
  </div>

  {#if loading}
    <section class="panel"><p class="muted">Loading tracks...</p></section>
  {:else if error}
    <section class="panel"><p class="error">{error}</p></section>
  {:else}
    <section class="grid cols-2">
      <div class="panel"><BarChart {rows} {metric} limit={12} /></div>
      <div class="panel"><RankingTable {rows} entityType="track" {metric} /></div>
    </section>
  {/if}
</section>
