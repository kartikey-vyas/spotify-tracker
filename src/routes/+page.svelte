<script lang="ts">
  import { onMount } from 'svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import ListeningCalendar from '$lib/components/ListeningCalendar.svelte';
  import OverviewCard from '$lib/components/OverviewCard.svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import { getPresetDateRange } from '$lib/dateRanges';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import { bestAvailableMetric, formatMetric, formatMinutes, metricLabel } from '$lib/metrics';
  import { getOverview } from '$lib/queries/overview';
  import type { CalendarDay, Metric, OverviewPayload, RankingRow } from '$lib/types';

  let overview: OverviewPayload | null = null;
  let loading = true;
  let error = '';

  const thisWeekRange = getPresetDateRange('this_week');
  const last30DaysRange = getPresetDateRange('last_30_days');

  $: todayDate = melbourneDate();
  $: todayPlays = overview ? playsForDate(overview.calendar.last_365_days, todayDate) : 0;
  $: weekPlays = overview ? playsForRange(overview.calendar.last_365_days, thisWeekRange.start, thisWeekRange.end) : 0;
  $: last30DaysPlays = overview
    ? playsForRange(overview.calendar.last_365_days, last30DaysRange.start, last30DaysRange.end)
    : 0;
  $: artistMetric = overview ? bestAvailableMetric(overview.this_week.top_artists) : 'minutes';
  $: genreMetric = overview ? bestAvailableMetric(overview.this_week.top_genres) : 'minutes';
  $: trackMetric = overview ? bestAvailableMetric(overview.this_week.top_tracks) : 'minutes';
  $: calendarMetric = overview ? calendarDisplayMetric(overview.calendar.last_365_days) : 'minutes';
  $: apiOnlyMode =
    overview !== null &&
    overview.this_week.top_artists.some((row) => row.plays > 0 && row.unknown_duration_plays > 0) &&
    overview.this_week.minutes === 0;

  onMount(async () => {
    try {
      overview = await getOverview();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  });

  function melbourneDate(date = new Date()): string {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Melbourne',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function playsForDate(days: CalendarDay[], localDate: string): number {
    return days.find((day) => day.local_date === localDate)?.plays ?? 0;
  }

  function playsForRange(days: CalendarDay[], start: string, end: string): number {
    return days
      .filter((day) => day.local_date >= start && day.local_date <= end)
      .reduce((total, day) => total + day.plays, 0);
  }

  function summaryValue(minutes: number, plays: number): string {
    return minutes > 0 ? formatMinutes(minutes) : `${plays.toLocaleString()} plays`;
  }

  function metricNote(metric: Metric, rows: RankingRow[]): string {
    const apiOnlyPlays = rows.reduce((total, row) => total + row.unknown_duration_plays, 0);
    if (metric === 'plays' && apiOnlyPlays > 0) return 'API-only plays';
    return metricLabel(metric);
  }

  function calendarDisplayMetric(days: CalendarDay[]): 'minutes' | 'plays' {
    return days.some((day) => day.minutes > 0) ? 'minutes' : 'plays';
  }
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
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY to load public dashboard data.</p>
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
    {#if apiOnlyMode}
      <section class="notice">
        Showing API-only play counts for now. Exact minutes will appear after the Spotify export import.
      </section>
    {/if}

    <section class="grid cols-4">
      <OverviewCard label="Today" value={summaryValue(overview.today.minutes, todayPlays)} detail={overview.today.top_artist ?? 'No plays yet'} />
      <OverviewCard label="This week" value={summaryValue(overview.this_week.minutes, weekPlays)} detail={overview.this_week.top_artists[0]?.entity_name ?? 'No plays yet'} />
      <OverviewCard label="Last 30 days" value={summaryValue(overview.last_30_days.minutes, last30DaysPlays)} detail={overview.last_30_days.top_artists[0]?.entity_name ?? 'No plays yet'} />
      <OverviewCard label="Top genre" value={overview.today.top_genre ?? 'Unknown'} detail="Today" />
    </section>

    <section class="grid cols-2 section-gap">
      <div class="panel">
        <div class="section-heading">
          <h2>Top artists this week</h2>
          <span class="muted">{metricNote(artistMetric, overview.this_week.top_artists)}</span>
        </div>
        <BarChart rows={overview.this_week.top_artists} metric={artistMetric} />
      </div>

      <div class="panel">
        <div class="section-heading">
          <h2>Top genres this week</h2>
          <span class="muted">{metricNote(genreMetric, overview.this_week.top_genres)}</span>
        </div>
        <BarChart rows={overview.this_week.top_genres} metric={genreMetric} />
      </div>
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Top tracks this week</h2>
        <span class="muted">{metricNote(trackMetric, overview.this_week.top_tracks)}</span>
      </div>
      <RankingTable rows={overview.this_week.top_tracks} entityType="track" metric={trackMetric} />
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Listening calendar</h2>
        <span class="muted">Last 365 days by {metricLabel(calendarMetric).toLowerCase()}</span>
      </div>
      <ListeningCalendar days={overview.calendar.last_365_days} metric={calendarMetric} />
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

  .notice {
    margin-bottom: 16px;
    padding: 12px 14px;
    border: 1px solid rgba(180, 83, 9, 0.24);
    border-radius: 8px;
    background: #fff7ed;
    color: #7c2d12;
    font-size: 0.94rem;
    font-weight: 650;
  }
</style>
