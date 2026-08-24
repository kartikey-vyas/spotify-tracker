<script lang="ts">
  import { onMount } from 'svelte';
  import MetricCard from '$lib/components/MetricCard.svelte';
  import CoverWall, { type CoverItem } from '$lib/components/CoverWall.svelte';
  import ContributionGraph from '$lib/components/ContributionGraph.svelte';
  import ListeningClock from '$lib/components/ListeningClock.svelte';
  import ReleaseYearChart from '$lib/components/ReleaseYearChart.svelte';
  import RecordMark from '$lib/components/RecordMark.svelte';
  import StatList from '$lib/components/StatList.svelte';
  import { getPresetDateRange, melbourneToday } from '$lib/dateRanges';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import {
    bestAvailableMetric,
    formatMetric,
    metricValue,
    qualityLabel,
    summaryValue,
    topArtistDetail
  } from '$lib/metrics';
  import { defaultProfileSlug } from '$lib/profileDefaults';
  import { getPublicProfileOverview } from '$lib/queries/overview';
  import { getProfileRankings } from '$lib/queries/rankings';
  import { fetchAlbumArtists, fetchAlbumImages } from '$lib/queries/images';
  import { listPublicProfiles } from '$lib/queries/profile';
  import type { CalendarDay, OverviewPayload, PublicProfileOption, RankingRow } from '$lib/types';

  type ListWindow = '7d' | '30d';

  let profiles: PublicProfileOption[] = [];
  let selectedSlug = defaultProfileSlug;
  let overview: OverviewPayload | null = null;
  let topAlbums: CoverItem[] = [];
  let topArtists: RankingRow[] = [];
  let topTracks: RankingRow[] = [];
  let listWindow: ListWindow = '30d';
  let loadToken = 0;
  let loading = true;
  let bandLoading = false;
  let error = '';
  let profileMenu: HTMLDetailsElement | null = null;

  const last7DaysRange = getPresetDateRange('last_7_days');
  const last30DaysRange = getPresetDateRange('last_30_days');
  const rangeFor = (win: ListWindow) => (win === '7d' ? last7DaysRange : last30DaysRange);

  $: windowLabel = listWindow === '7d' ? 'last 7 days' : 'last 30 days';

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
  // Skeletons only when the band is loading with nothing to show yet (first
  // paint + profile switch). On a 7d/30d toggle the previous lists are kept, so
  // they stay visible instead of flashing to skeletons.
  $: bandSkeleton =
    bandLoading && topAlbums.length === 0 && topArtists.length === 0 && topTracks.length === 0;
  // Loading while data is already on screen (a 7d/30d toggle): dim the band so
  // the swap eases instead of popping. Distinct from the cold-load skeleton.
  $: bandPending = bandLoading && !bandSkeleton;

  // One long groove of today's numbers for the needle-drop ticker under the
  // site header. Built from the overview cache so it is ready at first paint.
  // Each window's count and its top artist stay one group (joined with a small
  // middot); the hollow ◦ only separates windows, so the pairing reads.
  $: grooveText = overview
    ? [
        [
          `${todayPlays.toLocaleString()} plays today`,
          overview.today.top_artist ? `top artist ${overview.today.top_artist}` : ''
        ],
        [
          `${last7DaysPlays.toLocaleString()} plays this week`,
          overview.this_week.top_artists[0]?.entity_name
            ? `on rotation ${overview.this_week.top_artists[0].entity_name}`
            : ''
        ],
        [
          `${last30DaysPlays.toLocaleString()} plays this month`,
          overview.last_30_days.top_artists[0]?.entity_name
            ? `heavy rotation ${overview.last_30_days.top_artists[0].entity_name}`
            : ''
        ]
      ]
        .map((group) => group.filter(Boolean).join(' · '))
        .filter(Boolean)
        .join(' ◦ ')
    : '';

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    selectedSlug = params.get('slug') ?? defaultProfileSlug;

    try {
      profiles = await listPublicProfiles();
      if (!profiles.some((profile) => profile.slug === selectedSlug)) {
        selectedSlug =
          profiles.find((profile) => profile.slug === defaultProfileSlug)?.slug ?? profiles[0]?.slug ?? defaultProfileSlug;
      }
      overview = profiles.length > 0 ? await getPublicProfileOverview(selectedSlug) : null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      // Render the page chrome (cards, calendar, clock) as soon as the overview
      // resolves; the band loads after and shows skeletons via bandLoading.
      loading = false;
    }

    await loadBand();
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
    topArtists = [];
    topTracks = [];

    try {
      overview = await getPublicProfileOverview(selectedSlug);
      const url = new URL(window.location.href);
      if (selectedSlug === defaultProfileSlug) {
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

    await loadBand();
  }

  // Loads the band rankings once the page chrome is up. Kept separate so the
  // cards/calendar/clock can paint from the overview cache while the band's live
  // queries resolve behind a skeleton.
  async function loadBand(): Promise<void> {
    if (!overview || error) return;
    try {
      await loadRecent(selectedSlug, rangeFor(listWindow));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  // Top albums/artists/tracks for the chosen window, queried live so any window
  // works (the cache only stores fixed 7d/30d slices). A token guards against a
  // slower in-flight load overwriting a newer one when the toggle is clicked.
  async function loadRecent(slug: string, range: { start: string; end: string }): Promise<void> {
    const token = ++loadToken;
    bandLoading = true;
    try {
      const [artists, tracks, albumRows] = await Promise.all([
        getProfileRankings({ slug, entityType: 'artist', start: range.start, end: range.end, metric: 'plays', limit: 8 }),
        getProfileRankings({ slug, entityType: 'track', start: range.start, end: range.end, metric: 'plays', limit: 8 }),
        getProfileRankings({ slug, entityType: 'album', start: range.start, end: range.end, metric: 'plays', limit: 50 })
      ]);
      const covers = await albumsToCovers(albumRows);
      if (token !== loadToken) return;
      topArtists = artists;
      topTracks = tracks;
      topAlbums = covers;
    } finally {
      // Only the newest load owns the flag; a superseded load must not clear it.
      if (token === loadToken) bandLoading = false;
    }
  }

  async function albumsToCovers(albums: RankingRow[]): Promise<CoverItem[]> {
    if (albums.length === 0) return [];

    const metric = bestAvailableMetric(albums, 'plays');
    // Pool enough albums to fill complete rows at any width; CoverWall trims to
    // whole rows for the current column count.
    const sorted = [...albums]
      .sort((left, right) => metricValue(right, metric) - metricValue(left, metric))
      .slice(0, 36);
    const ids = sorted.map((row) => Number(row.entity_id));
    const [images, artists] = await Promise.all([fetchAlbumImages(ids), fetchAlbumArtists(ids)]);

    return sorted.map((row) => {
      const art = images.get(Number(row.entity_id));
      return {
        id: row.entity_id,
        title: row.entity_name,
        subtitle: artists.get(Number(row.entity_id)) ?? null,
        value: formatMetric(metricValue(row, metric), metric),
        imageUrl: art?.image_url ?? null,
        href: `/explore/?profile=${encodeURIComponent(selectedSlug)}&entity=album&id=${encodeURIComponent(row.entity_id)}`
      } satisfies CoverItem;
    });
  }

  async function setWindow(next: ListWindow): Promise<void> {
    if (next === listWindow) return;
    listWindow = next;
    try {
      await loadRecent(selectedSlug, rangeFor(next));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
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

  // "22 Jul 2026, 09:14" — terse pressing-stamp date for the catalog footer.
  // en-GB keeps months to three letters (en-AU spells out "June"/"July").
  function catalogStamp(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
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
  {#if grooveText && !error}
    <div class="groove" aria-hidden="true">
      <div class="groove-track">
        <span class="groove-copy">{grooveText}&nbsp;&nbsp;◦&nbsp;&nbsp;</span>
        <span class="groove-copy groove-dup">{grooveText}&nbsp;&nbsp;◦&nbsp;&nbsp;</span>
      </div>
    </div>
  {/if}

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
    <section class="panel panel-loading"><RecordMark size="lg" label="Loading overview..." /></section>
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
      <span class="profile-label">profile</span>
      <details bind:this={profileMenu} class="menu">
        <summary class="menu-trigger"
          >{selectedProfile ? profileOptionLabel(selectedProfile) : 'Choose profile'}</summary
        >
        <div class="menu-options is-profile" role="radiogroup" aria-label="Profile">
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

    <section class="grid cols-3">
      {#each summaryRows() as row}
        <MetricCard label={row.label} value={row.value} caption={row.caption} detail={row.detail} />
      {/each}
    </section>

    <div class="window-bar section-gap">
      <div class="window-toggle" role="group" aria-label="Time window for top music">
        <button
          type="button"
          class:active={listWindow === '7d'}
          aria-pressed={listWindow === '7d'}
          on:click={() => setWindow('7d')}>7 days</button>
        <button
          type="button"
          class:active={listWindow === '30d'}
          aria-pressed={listWindow === '30d'}
          on:click={() => setWindow('30d')}>30 days</button>
      </div>
    </div>

    {#if bandSkeleton || topAlbums.length > 0}
      <section class="panel band-region" class:is-pending={bandPending}>
        <div class="panel-heading">
          <h2>Top albums {windowLabel}</h2>
          <span class="muted">Cover wall</span>
        </div>
        <CoverWall items={topAlbums} loading={bandSkeleton} />
      </section>
    {/if}

    <section class="grid cols-2 section-gap band-region" class:is-pending={bandPending}>
      <div>
        <div class="section-heading">
          <h2>Top artists {windowLabel}</h2>
          <span class="muted">Plays</span>
        </div>
        <StatList rows={topArtists} loading={bandSkeleton} entityKind="artist" />
      </div>

      <div>
        <div class="section-heading">
          <h2>Top tracks {windowLabel}</h2>
          <span class="muted">Plays</span>
        </div>
        <StatList rows={topTracks} loading={bandSkeleton} />
      </div>
    </section>

    <div class="time-row section-gap">
      <section class="calendar-panel">
        <div class="section-heading">
          <h2>Listening calendar</h2>
          <span class="muted">Plays per day</span>
        </div>
        <div class="cal-body">
          <ContributionGraph days={calendarDays} metric="plays" />
        </div>
      </section>

      {#if overview.clock && overview.clock.length > 0}
        <section class="clock-panel">
          <div class="section-heading">
            <h2>Listening clock</h2>
            <span class="muted">Last 30 days</span>
          </div>
          <ListeningClock buckets={overview.clock} />
        </section>
      {/if}
    </div>

    {#if overview.release_years && overview.release_years.length > 0}
      <section class="section-gap">
        <div class="section-heading">
          <h2>The age of your music</h2>
          <span class="muted">Plays by release year</span>
        </div>
        <ReleaseYearChart buckets={overview.release_years} />
      </section>
    {/if}

    <footer class="sleeve-footer section-gap">
      <p class="catalog">
        <span>Cat. musik-001</span>
        <span class="sep">·</span>
        <span>{qualityLabel(1)}</span>
        <span class="sep">·</span>
        <span>Generated {catalogStamp(overview.generated_at)}</span>
        {#if overview.sync.last_success_at}
          <span class="sep">·</span>
          <span>Synced {catalogStamp(overview.sync.last_success_at)}</span>
        {/if}
        <span class="sep">·</span>
        <span>All plays reserved</span>
      </p>
      <span class="barcode" aria-hidden="true"></span>
    </footer>
  {/if}
</section>

<style>
  /* Needle-drop ticker: one slow groove of today's numbers under the site
     header. Two identical copies scroll by -50% for a seamless wrap. */
  .groove {
    overflow: hidden;
    margin-bottom: var(--space-4);
    padding: var(--space-1) 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .groove-track {
    display: flex;
    width: max-content;
  }

  .groove-copy {
    color: var(--muted);
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: no-preference) {
    .groove-track {
      animation: groove-scroll 75s linear infinite;
    }

    @keyframes groove-scroll {
      from {
        transform: translateX(0);
      }
      to {
        transform: translateX(-50%);
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .groove-track {
      display: block;
      width: auto;
    }

    .groove-copy {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .groove-dup {
      display: none;
    }
  }

  /* Un-boxed sections: a heading plus one hairline rule. Content below sits
     directly on the page background — the rule is the only chrome. */
  .section-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
    margin-bottom: var(--space-4);
  }

  .section-heading .muted {
    font-size: var(--text-sm);
  }

  /* The cover wall keeps its original bordered shelf; its heading stays the
     plain flex row from the base design (no extra rule inside the box). */
  .panel-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  /* Quiet inline profile picker: a dotted-underline name instead of a bordered
     box; the dates it used to sit beside now live in the catalog footer. */
  .profile-picker {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-12);
  }

  .profile-label {
    color: var(--muted);
    font-size: var(--text-sm);
  }


  /* Un-boxed sections need whitespace to hold the page together: major
     sections sit ~36px apart instead of the old 16px. */
  .section-gap {
    margin-top: var(--space-12);
  }

  /* Wider gutter between the two un-boxed ranking columns. */
  .band-region.cols-2 {
    column-gap: 48px;
    row-gap: 32px;
  }

  .window-bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
  }

  .window-toggle {
    display: inline-flex;
    border: 1px solid var(--line);
  }

  .window-toggle button {
    min-height: 0;
    padding: var(--space-1) var(--space-4);
    border: 0;
    border-left: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .window-toggle button:first-child {
    border-left: 0;
  }

  .window-toggle button:hover:not(.active) {
    background: var(--surface-2);
    color: var(--text);
  }

  .window-toggle button.active {
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* Calendar (wide) + clock (compact) share a row, wrapping on narrow screens. */
  .time-row {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: var(--space-12);
  }

  .time-row .calendar-panel {
    display: flex;
    flex: 1 1 560px;
    min-width: 0;
    flex-direction: column;
  }

  /* Centre the grid vertically in the shared row height. min-width:0 (here and
     on the calendar root) lets the grid scroll inside the panel instead of
     overflowing it on cramped widths. */
  .cal-body {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
  }

  .cal-body :global(.calendar) {
    flex: 1;
    min-width: 0;
  }

  .time-row .clock-panel {
    display: flex;
    flex: 1 1 220px;
    flex-direction: column;
    max-width: 300px;
  }

  /* Catalog footer: rights line + a flat CSS barcode (hard-stop stripes, so
     it stays within the no-gradient look). */
  .sleeve-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3) var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--line);
  }

  .catalog {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin: 0;
    color: var(--muted);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .catalog .sep {
    opacity: 0.6;
  }

  .barcode {
    width: 78px;
    height: 18px;
    background: repeating-linear-gradient(90deg, var(--text) 0 2px, transparent 2px 5px, var(--text) 5px 6px, transparent 6px 9px);
  }

  /* Window toggle: ease the band down while the new window loads, then back up
     once it swaps in — a calm "refreshing" cue rather than a hard pop. */
  .band-region {
    transition: opacity 0.18s ease;
  }

  .band-region.is-pending {
    opacity: 0.5;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .band-region {
      transition: none;
    }

    .band-region.is-pending {
      opacity: 1;
    }
  }

</style>
