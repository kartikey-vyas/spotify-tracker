<script lang="ts">
  import { onMount } from 'svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import ListeningCalendar from '$lib/components/ListeningCalendar.svelte';
  import OverviewCard from '$lib/components/OverviewCard.svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import { formatMinutes } from '$lib/metrics';
  import { getOverview } from '$lib/queries/overview';
  import type { OverviewPayload } from '$lib/types';

  let overview: OverviewPayload | null = null;
  let loading = true;
  let error = '';

  onMount(async () => {
    try {
      overview = await getOverview();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  });
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Australia/Melbourne</span>
    <h1>Listening history</h1>
    <p class="lede">Public read-only Spotify listening summaries powered by daily rollups.</p>
  </div>

  {#if !publicSupabaseConfigured}
    <section class="panel">
      <h2>Supabase is not configured</h2>
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY to load public dashboard data.</p>
    </section>
  {:else if loading}
    <section class="panel"><p class="muted">Loading overview...</p></section>
  {:else if error}
    <section class="panel"><p class="error">{error}</p></section>
  {:else if !overview}
    <section class="panel">
      <h2>No overview cache yet</h2>
      <p class="muted">Run an import or refresh job so the public_home overview cache is generated.</p>
    </section>
  {:else}
    <div class="status-row">
      <DataQualityBadge quality={1} gapRisk={overview.sync.gap_risk} />
      <span class="muted">Generated {new Date(overview.generated_at).toLocaleString()}</span>
      {#if overview.sync.last_success_at}
        <span class="muted">Last API sync {new Date(overview.sync.last_success_at).toLocaleString()}</span>
      {/if}
    </div>

    <section class="grid cols-4">
      <OverviewCard label="Today" value={formatMinutes(overview.today.minutes)} detail={overview.today.top_artist ?? 'No plays yet'} />
      <OverviewCard label="This week" value={formatMinutes(overview.this_week.minutes)} detail={overview.this_week.top_artists[0]?.entity_name ?? 'No plays yet'} />
      <OverviewCard label="Last 30 days" value={formatMinutes(overview.last_30_days.minutes)} detail={overview.last_30_days.top_artists[0]?.entity_name ?? 'No plays yet'} />
      <OverviewCard label="Top genre" value={overview.today.top_genre ?? 'Unknown'} detail="Today" />
    </section>

    <section class="grid cols-2 section-gap">
      <div class="panel">
        <div class="section-heading">
          <h2>Top artists this week</h2>
          <span class="muted">Minutes listened</span>
        </div>
        <BarChart rows={overview.this_week.top_artists} metric="minutes" />
      </div>

      <div class="panel">
        <div class="section-heading">
          <h2>Top genres this week</h2>
          <span class="muted">Split by primary artist genres</span>
        </div>
        <BarChart rows={overview.this_week.top_genres} metric="minutes" />
      </div>
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Top tracks this week</h2>
        <span class="muted">Exact minutes exclude API-only unknown durations</span>
      </div>
      <RankingTable rows={overview.this_week.top_tracks} entityType="track" metric="minutes" />
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Listening calendar</h2>
        <span class="muted">Last 365 days</span>
      </div>
      <ListeningCalendar days={overview.calendar.last_365_days} />
    </section>
  {/if}
</section>

<style>
  .status-row,
  .section-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .status-row {
    margin-bottom: 16px;
  }

  .section-gap {
    margin-top: 16px;
  }
</style>
