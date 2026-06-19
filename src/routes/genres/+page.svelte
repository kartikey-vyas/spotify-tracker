<script lang="ts">
  import { onMount } from 'svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import { getPresetDateRange } from '$lib/dateRanges';
  import { getRankings } from '$lib/queries/rankings';
  import type { RankingRow } from '$lib/types';

  let rows: RankingRow[] = [];
  let error = '';
  let loading = true;
  const range = getPresetDateRange('last_30_days');

  onMount(async () => {
    try {
      rows = await getRankings({ entityType: 'genre', start: range.start, end: range.end, metric: 'minutes', limit: 100 });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  });
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Genres</span>
    <h1>Favourite genres</h1>
    <p class="lede">Split across primary artist Spotify genre tags.</p>
  </div>

  {#if loading}
    <section class="panel"><p class="muted">Loading genres...</p></section>
  {:else if error}
    <section class="panel"><p class="error">{error}</p></section>
  {:else}
    <section class="grid cols-2">
      <div class="panel"><BarChart {rows} metric="minutes" limit={12} /></div>
      <div class="panel"><RankingTable {rows} entityType="genre" metric="minutes" /></div>
    </section>
  {/if}
</section>
