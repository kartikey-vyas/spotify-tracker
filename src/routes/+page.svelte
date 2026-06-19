<script lang="ts">
  import { onMount } from 'svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import { getPresetDateRange } from '$lib/dateRanges';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import {
    bestAvailableMetric,
    formatMetric,
    formatMinutes,
    metricLabel,
    metricValue
  } from '$lib/metrics';
  import { getPublicProfileOverview } from '$lib/queries/overview';
  import { listPublicProfiles } from '$lib/queries/profile';
  import type { CalendarDay, Metric, OverviewPayload, PublicProfileOption, RankingRow } from '$lib/types';

  const defaultSlug = 'kartikey';

  let profiles: PublicProfileOption[] = [];
  let selectedSlug = defaultSlug;
  let overview: OverviewPayload | null = null;
  let loading = true;
  let error = '';
  let profileMenu: HTMLDetailsElement | null = null;

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
  $: selectedProfile = profiles.find((profile) => profile.slug === selectedSlug) ?? null;
  $: apiOnlyMode =
    overview !== null &&
    overview.this_week.top_artists.some((row) => row.plays > 0 && row.unknown_duration_plays > 0) &&
    overview.this_week.minutes === 0;

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    selectedSlug = params.get('slug') ?? defaultSlug;

    try {
      profiles = await listPublicProfiles();
      if (!profiles.some((profile) => profile.slug === selectedSlug)) {
        selectedSlug = profiles.find((profile) => profile.slug === defaultSlug)?.slug ?? profiles[0]?.slug ?? defaultSlug;
      }
      overview = profiles.length > 0 ? await getPublicProfileOverview(selectedSlug) : null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  });

  onMount(() => {
    const closeProfileMenu = (event: MouseEvent) => {
      if (profileMenu && event.target instanceof Node && !profileMenu.contains(event.target)) {
        profileMenu.open = false;
      }
    };

    document.addEventListener('click', closeProfileMenu);
    return () => document.removeEventListener('click', closeProfileMenu);
  });

  async function chooseProfile(slug: string): Promise<void> {
    if (slug === selectedSlug) {
      if (profileMenu) profileMenu.open = false;
      return;
    }

    selectedSlug = slug;
    if (profileMenu) profileMenu.open = false;
    error = '';
    loading = true;

    try {
      overview = await getPublicProfileOverview(selectedSlug);
      const url = new URL(window.location.href);
      if (selectedSlug === defaultSlug) {
        url.searchParams.delete('slug');
      } else {
        url.searchParams.set('slug', selectedSlug);
      }
      window.history.replaceState({}, '', url.toString());
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  }

  function profileOptionLabel(profile: PublicProfileOption): string {
    return profile.display_name;
  }

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

  function summaryRows(): Array<{ label: string; value: string; detail: string }> {
    if (!overview) return [];
    return [
      {
        label: 'Today',
        value: summaryValue(overview.today.minutes, todayPlays),
        detail: overview.today.top_artist ?? 'No plays yet'
      },
      {
        label: 'This week',
        value: summaryValue(overview.this_week.minutes, weekPlays),
        detail: overview.this_week.top_artists[0]?.entity_name ?? 'No plays yet'
      },
      {
        label: 'Last 30 days',
        value: summaryValue(overview.last_30_days.minutes, last30DaysPlays),
        detail: overview.last_30_days.top_artists[0]?.entity_name ?? 'No plays yet'
      },
      {
        label: 'Top genre',
        value: overview.today.top_genre ?? 'Unknown',
        detail: 'Today'
      }
    ];
  }

  function asciiBarRows(rows: RankingRow[], metric: Metric, limit = 8): string[] {
    const chartRows = rows.slice(0, limit);
    const maxValue = Math.max(1, ...chartRows.map((row) => metricValue(row, metric)));

    return chartRows.map((row, index) => {
      const value = metricValue(row, metric);
      const filled = Math.max(0, Math.round((value / maxValue) * 24));
      const bar = '#'.repeat(filled).padEnd(24, '-');
      return `${String(index + 1).padStart(2, '0')} ${row.entity_name} [${bar}] ${formatMetric(value, metric)}`;
    });
  }

  function calendarGlyph(day: CalendarDay, metric: 'minutes' | 'plays', maxValue: number): string {
    const value = metric === 'plays' ? day.plays : day.minutes;
    if (value <= 0) return '.';
    return ['.', '-', '=', '+', '#'][Math.min(4, Math.ceil((value / maxValue) * 4))];
  }

  function calendarText(days: CalendarDay[], metric: 'minutes' | 'plays'): string {
    const maxValue = Math.max(1, ...days.map((day) => (metric === 'plays' ? day.plays : day.minutes)));
    return days.map((day) => calendarGlyph(day, metric, maxValue)).join('');
  }
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Australia/Melbourne</span>
    <h1>{selectedProfile?.display_name ?? 'Listening history'}</h1>
    <p class="lede">
      {selectedProfile ? `@${selectedProfile.slug}` : 'Public read-only Spotify listening summaries.'}
    </p>
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
  {:else if profiles.length === 0}
    <section class="panel">
      <h2>No public profiles yet</h2>
      <p class="muted">Make at least one connected profile public to show it here.</p>
    </section>
  {:else if !overview}
    <section class="panel">
      <h2>No overview cache yet</h2>
      <p class="muted">Run a sync so this profile has a public overview cache.</p>
    </section>
  {:else}
    <div class="profile-picker">
      <span class="profile-label">Profile</span>
      <details bind:this={profileMenu} class="profile-menu">
        <summary>{selectedProfile ? profileOptionLabel(selectedProfile) : 'Choose profile'}</summary>
        <div class="profile-options" role="radiogroup" aria-label="Profile">
          {#each profiles as profile}
            <button
              class:active={profile.slug === selectedSlug}
              type="button"
              role="radio"
              aria-checked={profile.slug === selectedSlug}
              on:click={() => chooseProfile(profile.slug)}
            >
              <span>{profile.display_name}</span>
            </button>
          {/each}
        </div>
      </details>
    </div>

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
      {#each summaryRows() as row}
        <section class="panel metric-card">
          <span class="metric-label">{row.label}</span>
          <strong>{row.value}</strong>
          <p>{row.detail}</p>
        </section>
      {/each}
    </section>

    <section class="grid cols-2 section-gap">
      <div class="panel">
        <div class="section-heading">
          <h2>Top artists this week</h2>
          <span class="muted">{metricNote(artistMetric, overview.this_week.top_artists)}</span>
        </div>
        <pre class="ascii-list">{asciiBarRows(overview.this_week.top_artists, artistMetric).join('\n')}</pre>
      </div>

      <div class="panel">
        <div class="section-heading">
          <h2>Top genres this week</h2>
          <span class="muted">{metricNote(genreMetric, overview.this_week.top_genres)}</span>
        </div>
        <pre class="ascii-list">{asciiBarRows(overview.this_week.top_genres, genreMetric).join('\n')}</pre>
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
      <pre class="calendar-text">{calendarText(overview.calendar.last_365_days, calendarMetric)}</pre>
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

  .profile-picker {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .profile-label {
    color: var(--muted);
  }

  .profile-menu {
    position: relative;
    min-width: 220px;
  }

  .profile-menu summary {
    min-height: 32px;
    padding: 5px 28px 5px 9px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    list-style: none;
  }

  .profile-menu summary::after {
    position: absolute;
    top: 13px;
    right: 9px;
    width: 0;
    height: 0;
    border-top: 5px solid var(--muted);
    border-right: 4px solid transparent;
    border-left: 4px solid transparent;
    content: "";
  }

  .profile-menu[open] summary::after {
    transform: rotate(180deg);
  }

  .profile-menu summary::-webkit-details-marker {
    display: none;
  }

  .profile-menu summary:hover {
    background: var(--surface-2);
  }

  .profile-options {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 10;
    display: grid;
    width: 100%;
    border: 1px solid var(--line);
    background: var(--surface);
  }

  .profile-options button {
    display: block;
    width: 100%;
    min-height: 32px;
    padding: 7px 9px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: transparent;
    color: var(--text);
    text-align: left;
  }

  .profile-options button:last-child {
    border-bottom: 0;
  }

  .profile-options button:hover {
    background: var(--surface-2);
  }

  .profile-options button.active {
    background: var(--text);
    color: var(--bg);
  }

  .section-gap {
    margin-top: 16px;
  }

  .metric-card {
    display: grid;
    gap: 4px;
  }

  .metric-label {
    color: var(--muted);
    font-size: 0.86rem;
  }

  .metric-label::before {
    content: "> ";
  }

  .metric-card strong {
    font-size: 1rem;
  }

  .metric-card p,
  .ascii-list,
  .calendar-text {
    color: var(--muted);
  }

  .ascii-list,
  .calendar-text {
    margin: 0;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .notice {
    margin-bottom: 16px;
    padding: 8px 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.94rem;
    font-weight: 400;
  }
</style>
