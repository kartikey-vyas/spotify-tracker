<script lang="ts">
  import { onMount } from 'svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import MetricCard from '$lib/components/MetricCard.svelte';
  import CoverWall, { type CoverItem } from '$lib/components/CoverWall.svelte';
  import ContributionGraph from '$lib/components/ContributionGraph.svelte';
  import ListeningClock from '$lib/components/ListeningClock.svelte';
  import ReleaseYearChart from '$lib/components/ReleaseYearChart.svelte';
  import { getPresetDateRange, melbourneToday } from '$lib/dateRanges';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import {
    bestAvailableMetric,
    formatMetric,
    metricValue,
    summaryValue,
    topArtistDetail
  } from '$lib/metrics';
  import { getPublicProfileOverview } from '$lib/queries/overview';
  import { getProfileRankings } from '$lib/queries/rankings';
  import { fetchAlbumImages } from '$lib/queries/images';
  import { listPublicProfiles } from '$lib/queries/profile';
  import type { CalendarDay, OverviewPayload, PublicProfileOption } from '$lib/types';

  const defaultSlug = 'kartikey';

  let profiles: PublicProfileOption[] = [];
  let selectedSlug = defaultSlug;
  let overview: OverviewPayload | null = null;
  let topAlbums: CoverItem[] = [];
  let loading = true;
  let error = '';
  let profileMenu: HTMLDetailsElement | null = null;

  const last7DaysRange = getPresetDateRange('last_7_days');
  const last30DaysRange = getPresetDateRange('last_30_days');

  $: todayDate = melbourneToday();
  // `daily` (full history) supersedes the legacy `last_365_days`; read whichever
  // the cache has so the page works before and after the migration is applied.
  $: calendarDays = overview
    ? (overview.calendar.daily ?? overview.calendar.last_365_days ?? [])
    : [];
  $: todayPlays = playsForDate(calendarDays, todayDate);
  $: last7DaysPlays = playsForRange(calendarDays, last7DaysRange.start, last7DaysRange.end);
  $: last30DaysPlays = playsForRange(calendarDays, last30DaysRange.start, last30DaysRange.end);
  $: selectedProfile = profiles.find((profile) => profile.slug === selectedSlug) ?? null;

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    selectedSlug = params.get('slug') ?? defaultSlug;

    try {
      profiles = await listPublicProfiles();
      if (!profiles.some((profile) => profile.slug === selectedSlug)) {
        selectedSlug = profiles.find((profile) => profile.slug === defaultSlug)?.slug ?? profiles[0]?.slug ?? defaultSlug;
      }
      overview = profiles.length > 0 ? await getPublicProfileOverview(selectedSlug) : null;
      topAlbums = overview ? await loadCoverWall(selectedSlug) : [];
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
    topAlbums = [];

    try {
      overview = await getPublicProfileOverview(selectedSlug);
      topAlbums = overview ? await loadCoverWall(selectedSlug) : [];
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

  async function loadCoverWall(slug: string): Promise<CoverItem[]> {
    const albums = await getProfileRankings({
      slug,
      entityType: 'album',
      start: last7DaysRange.start,
      end: last7DaysRange.end,
      metric: 'plays',
      limit: 50
    });
    if (albums.length === 0) return [];

    const metric = bestAvailableMetric(albums, 'plays');
    const sorted = [...albums]
      .sort((left, right) => metricValue(right, metric) - metricValue(left, metric))
      .slice(0, 24);
    const images = await fetchAlbumImages(sorted.map((row) => Number(row.entity_id)));

    return sorted.map((row) => {
      const art = images.get(Number(row.entity_id));
      return {
        id: row.entity_id,
        title: row.entity_name,
        subtitle: null,
        value: formatMetric(metricValue(row, metric), metric),
        imageUrl: art?.image_url ?? null,
        href: `/explore/?entity=album&id=${encodeURIComponent(row.entity_id)}`
      } satisfies CoverItem;
    });
  }

  function profileOptionLabel(profile: PublicProfileOption): string {
    return profile.display_name;
  }

  function playsForDate(days: CalendarDay[], localDate: string): number {
    return days.find((day) => day.local_date === localDate)?.plays ?? 0;
  }

  function playsForRange(days: CalendarDay[], start: string, end: string): number {
    return days
      .filter((day) => day.local_date >= start && day.local_date <= end)
      .reduce((total, day) => total + day.plays, 0);
  }

  function summaryRows(): Array<{ label: string; value: string; caption: string; detail: string }> {
    if (!overview) return [];
    return [
      {
        label: 'Today',
        value: summaryValue(todayPlays),
        ...topArtistDetail(overview.today.top_artist)
      },
      {
        label: 'Last 7 days',
        value: summaryValue(last7DaysPlays),
        ...topArtistDetail(overview.this_week.top_artists[0]?.entity_name)
      },
      {
        label: 'Last 30 days',
        value: summaryValue(last30DaysPlays),
        ...topArtistDetail(overview.last_30_days.top_artists[0]?.entity_name)
      }
    ];
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
      <DataQualityBadge quality={1} />
      <span class="muted">Generated {new Date(overview.generated_at).toLocaleString()}</span>
      {#if overview.sync.last_success_at}
        <span class="muted">Last API sync {new Date(overview.sync.last_success_at).toLocaleString()}</span>
      {/if}
    </div>
    <section class="grid cols-3">
      {#each summaryRows() as row}
        <MetricCard label={row.label} value={row.value} caption={row.caption} detail={row.detail} />
      {/each}
    </section>

    {#if topAlbums.length > 0}
      <section class="panel section-gap">
        <div class="section-heading">
          <h2>Top albums last 7 days</h2>
          <span class="muted">Cover wall</span>
        </div>
        <CoverWall items={topAlbums} />
      </section>
    {/if}

    <section class="grid cols-2 section-gap">
      <div class="panel">
        <div class="section-heading">
          <h2>Top artists last 7 days</h2>
          <span class="muted">Plays</span>
        </div>
        <ol class="stat-list">
          {#each overview.this_week.top_artists.slice(0, 8) as row}
            <li>
              <span class="name">{row.entity_name}</span>
              <span class="count">{row.plays.toLocaleString()}</span>
            </li>
          {/each}
        </ol>
      </div>

      <div class="panel">
        <div class="section-heading">
          <h2>Top tracks last 7 days</h2>
          <span class="muted">Plays</span>
        </div>
        <ol class="stat-list">
          {#each overview.this_week.top_tracks.slice(0, 8) as row}
            <li>
              <span class="name">{row.entity_name}</span>
              <span class="count">{row.plays.toLocaleString()}</span>
            </li>
          {/each}
        </ol>
      </div>
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Listening calendar</h2>
        <span class="muted">Plays per day</span>
      </div>
      <ContributionGraph days={calendarDays} metric="plays" />
    </section>

    {#if overview.clock && overview.clock.length > 0}
      <section class="panel section-gap clock-panel">
        <div class="section-heading">
          <h2>Listening clock</h2>
          <span class="muted">By hour · last 30 days</span>
        </div>
        <ListeningClock buckets={overview.clock} />
      </section>
    {/if}

    {#if overview.release_years && overview.release_years.length > 0}
      <section class="panel section-gap">
        <div class="section-heading">
          <h2>The age of your music</h2>
          <span class="muted">Plays by release year</span>
        </div>
        <ReleaseYearChart buckets={overview.release_years} />
      </section>
    {/if}
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

  /* The radial clock is squarish, so keep its panel to ~half width. */
  .clock-panel {
    max-width: 520px;
  }

  .stat-list {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: rank;
  }

  .stat-list li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--line);
    counter-increment: rank;
  }

  .stat-list li:last-child {
    border-bottom: 0;
  }

  .stat-list li::before {
    content: counter(rank);
    min-width: 1.4em;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .stat-list .name {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stat-list .count {
    margin-left: auto;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

</style>
