<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import DitherFrame from '$lib/components/DitherFrame.svelte';
  import MetricCard from '$lib/components/MetricCard.svelte';
  import CoverWall, { type CoverItem } from '$lib/components/CoverWall.svelte';
  import ContributionGraph from '$lib/components/ContributionGraph.svelte';
  import HourTags from '$lib/components/HourTags.svelte';
  import ListeningClock from '$lib/components/ListeningClock.svelte';
  import PixelRoom from '$lib/components/PixelRoom.svelte';
  import PopularityPanel from '$lib/components/PopularityPanel.svelte';
  import ReleaseYearChart from '$lib/components/ReleaseYearChart.svelte';
  import StatList from '$lib/components/StatList.svelte';
  import { coverVariant } from '$lib/covers';
  import { getPresetDateRange, melbourneToday } from '$lib/dateRanges';
  import {
    readCachedProfiles,
    readHomeSnapshot,
    saveCachedProfiles,
    saveHomeSnapshot,
    type BandWindow
  } from '$lib/homeCache';
  import { homePrefetchScript, takeHomePrefetch, type HomePrefetch } from '$lib/homePrefetch';
  import { bandFor, buildStrip, formatListeners, hasHourTags, reliableMedian } from '$lib/insights';
  import { publicSupabaseConfigured, supabasePublishableKey, supabaseUrl } from '$lib/supabase';
  import { formatMetric, metricValue, qualityLabel, summaryValue, topArtistDetail } from '$lib/metrics';
  import { defaultProfileSlug } from '$lib/profileDefaults';
  import {
    getHomeBand,
    HOME_BAND_ALBUM_LIMIT,
    HOME_BAND_LIST_LIMIT,
    type HomeBand
  } from '$lib/queries/home';
  import { getPopularityStrip, getPublicProfileInsights } from '$lib/queries/insights';
  import { getPublicProfileOverview } from '$lib/queries/overview';
  import { listPublicProfiles } from '$lib/queries/profile';
  import type {
    CalendarDay,
    DeepCut,
    InsightsPayload,
    OverviewPayload,
    PopularityStripRow,
    PublicProfileOption,
    RankingRow
  } from '$lib/types';

  type ListWindow = BandWindow;
  // The band rows on screen and what they were loaded for. Trails listWindow
  // while a toggle loads, so links keep matching the rows on screen.
  type ShownBand = { slug: string; window: ListWindow; data: HomeBand };

  type SummaryRow = { label: string; value: string; caption: string; detail: string };

  const SUMMARY_LABELS = ['Today', 'Last 7 days', 'Last 30 days'];
  const EMPTY_BAND: HomeBand = { artists: [], tracks: [], albums: [] };

  /* Starts the first requests from <head>, before the app's JavaScript has
     loaded. Only a full page load runs it; after a client-side navigation
     there is nothing to take and onMount fetches as usual. */
  const prefetchScript =
    supabaseUrl && supabasePublishableKey
      ? homePrefetchScript({
          url: supabaseUrl,
          key: supabasePublishableKey,
          defaultSlug: defaultProfileSlug,
          listLimit: HOME_BAND_LIST_LIMIT,
          albumLimit: HOME_BAND_ALBUM_LIMIT
        })
      : '';

  let profiles: PublicProfileOption[] = [];
  let profilesLoaded = false;
  let profilesRequest: Promise<PublicProfileOption[]> | null = null;
  let selectedSlug = defaultProfileSlug;
  let overview: OverviewPayload | null = null;
  // Set once the network has answered for selectedSlug. Before that, a missing
  // overview means "still loading", not "this profile has no cache".
  let overviewSettled = false;
  // The daily Last.fm insights cache. Optional: the page renders without it.
  let insights: InsightsPayload | null = null;
  let popularityRows: PopularityStripRow[] = [];
  let shownBand: ShownBand | null = null;
  let listWindow: ListWindow = '30d';
  // Each guards its loads the same way: a slow response for an earlier pick
  // must not land after a newer one.
  let bandToken = 0;
  let profileToken = 0;
  // A 7d/30d toggle with nothing stored for the new window: the previous rows
  // stay on screen, dimmed, instead of flashing to skeletons.
  let bandPending = false;
  let error = '';
  let profileMenu: HTMLDetailsElement | null = null;

  const last7DaysRange = getPresetDateRange('last_7_days');
  const last30DaysRange = getPresetDateRange('last_30_days');
  const rangeFor = (win: ListWindow) => (win === '7d' ? last7DaysRange : last30DaysRange);
  // The explorer's preset for each window, so a link opens on the same dates.
  const presetFor = (win: ListWindow) => (win === '7d' ? 'last_7_days' : 'last_30_days');

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
  $: summary = summaryRows(overview, todayPlays, last7DaysPlays, last30DaysPlays);
  $: selectedProfile = profiles.find((profile) => profile.slug === selectedSlug) ?? null;
  // Skeletons until the band has something to show for this profile.
  $: bandSkeleton = shownBand === null;
  $: topArtists = shownBand?.data.artists ?? [];
  $: topTracks = shownBand?.data.tracks ?? [];
  $: topAlbums = shownBand ? albumsToCovers(shownBand) : [];
  $: popularityStrip = buildStrip(popularityRows, selectedSlug);
  $: popularityCard = popularityCardFor(insights);
  $: metricColumns = popularityCard ? 'cols-4' : 'cols-3';
  $: noProfiles = profilesLoaded && profiles.length === 0 && !overview;
  $: noOverview = overviewSettled && !overview && !noProfiles;
  $: showGenericHeader = !publicSupabaseConfigured || noProfiles;

  onMount(() => {
    const slug = new URLSearchParams(window.location.search).get('slug') || defaultProfileSlug;
    const prefetched = takeHomePrefetch(
      window as unknown as Record<string, unknown>,
      slug,
      rangeFor('30d')
    );

    profiles = readCachedProfiles() ?? [];
    profilesRequest = loadProfiles(prefetched);
    void loadPopularityStrip();
    openProfile(slug, prefetched);
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

  // Uses the boot script's request when there is one, and asks again through
  // the client if it failed.
  function orFetch<T>(pending: Promise<T> | undefined, fetcher: () => Promise<T>): Promise<T> {
    return pending ? pending.catch(fetcher) : fetcher();
  }

  function messageOf(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught);
  }

  async function loadProfiles(prefetched: HomePrefetch | null): Promise<PublicProfileOption[]> {
    try {
      const list = await orFetch(prefetched?.profiles, listPublicProfiles);
      profiles = list;
      saveCachedProfiles(list);
      return list;
    } catch (caught) {
      error = messageOf(caught);
      return profiles;
    } finally {
      profilesLoaded = true;
    }
  }

  async function loadPopularityStrip(): Promise<void> {
    popularityRows = await getPopularityStrip().catch(() => []);
  }

  /* Shows what this browser stored for the profile at once, then loads the
     overview, insights and band side by side. Each part renders as soon as its
     own response arrives. */
  function openProfile(slug: string, prefetched: HomePrefetch | null = null): void {
    const token = ++profileToken;
    const snapshot = readHomeSnapshot(slug);
    selectedSlug = slug;
    error = '';
    overview = snapshot.overview ?? null;
    insights = snapshot.insights ?? null;
    overviewSettled = false;

    void loadOverview(slug, token, prefetched);
    void loadInsights(slug, token, prefetched);
    void loadBand(slug, listWindow, snapshot.bands?.[listWindow] ?? null, prefetched?.band);
  }

  async function loadOverview(slug: string, token: number, prefetched: HomePrefetch | null): Promise<void> {
    try {
      const next = await orFetch(prefetched?.overview, () => getPublicProfileOverview(slug));
      if (token !== profileToken) return;
      if (!next) {
        // An unknown or private slug in the URL: show the default profile instead.
        const fallback = await fallbackSlugFor(slug);
        if (token !== profileToken) return;
        if (fallback) {
          openProfile(fallback);
          return;
        }
      }
      overview = next;
      if (next) saveHomeSnapshot(slug, { overview: next });
    } catch (caught) {
      if (token === profileToken) error = messageOf(caught);
    } finally {
      if (token === profileToken) overviewSettled = true;
    }
  }

  async function fallbackSlugFor(slug: string): Promise<string | null> {
    const list = await (profilesRequest ?? Promise.resolve(profiles));
    if (list.some((profile) => profile.slug === slug)) return null;
    return list.find((profile) => profile.slug === defaultProfileSlug)?.slug ?? list[0]?.slug ?? null;
  }

  // The insights cache is extra: a missing row or a failed read hides its
  // panels instead of failing the page, and a failed refresh keeps what is shown.
  async function loadInsights(slug: string, token: number, prefetched: HomePrefetch | null): Promise<void> {
    let next: InsightsPayload | null;
    try {
      next = await orFetch(prefetched?.insights, () => getPublicProfileInsights(slug));
    } catch {
      return;
    }
    if (token !== profileToken) return;
    insights = next;
    if (next) saveHomeSnapshot(slug, { insights: next });
  }

  /* Top albums/artists/tracks for one window. Stored rows for the window paint
     at once and refresh quietly. Without them, a toggle dims the previous
     window's rows and a new profile shows skeletons. */
  async function loadBand(
    slug: string,
    win: ListWindow,
    stored: HomeBand | null,
    pending?: Promise<HomeBand>
  ): Promise<void> {
    const token = ++bandToken;
    if (stored) {
      shownBand = { slug, window: win, data: stored };
    } else if (shownBand && shownBand.slug !== slug) {
      shownBand = null;
    }
    bandPending = shownBand !== null && shownBand.window !== win;

    try {
      const data = await orFetch(pending, () => getHomeBand({ slug, ...rangeFor(win) }));
      if (token !== bandToken) return;
      shownBand = { slug, window: win, data };
      // An unknown slug answers with nothing; there is nothing worth keeping.
      if (data.artists.length + data.tracks.length + data.albums.length > 0) {
        saveHomeSnapshot(slug, { bands: { [win]: data } });
      }
    } catch (caught) {
      if (token !== bandToken) return;
      error = messageOf(caught);
      if (!shownBand) shownBand = { slug, window: win, data: EMPTY_BAND };
    } finally {
      if (token === bandToken) bandPending = false;
    }
  }

  function chooseProfile(slug: string): void {
    if (profileMenu) profileMenu.open = false;
    if (slug === selectedSlug) return;

    openProfile(slug);
    const url = new URL(window.location.href);
    if (slug === defaultProfileSlug) {
      url.searchParams.delete('slug');
    } else {
      url.searchParams.set('slug', slug);
    }
    window.history.replaceState({}, '', url.toString());
  }

  function setWindow(next: ListWindow): void {
    if (next === listWindow) return;
    listWindow = next;
    void loadBand(selectedSlug, next, readHomeSnapshot(selectedSlug).bands?.[next] ?? null);
  }

  // Deep cuts span all of history, so their artist links open the explorer on
  // "All time" rather than the band's 7d/30d window.
  function deepCutArtistHref(cut: DeepCut): string | null {
    if (cut.artist_id === null) return null;
    const params = new URLSearchParams({
      profile: selectedSlug,
      range: 'all_time',
      entity: 'artist',
      id: String(cut.artist_id)
    });
    return `${base}/explore/?${params.toString()}`;
  }

  function popularityCardFor(payload: InsightsPayload | null): SummaryRow | null {
    const listeners = reliableMedian(payload?.popularity.last_30_days);
    if (listeners === null) return null;
    return {
      label: 'Popularity, 30 days',
      value: bandFor(listeners),
      caption: 'Typical artist',
      detail: `${formatListeners(listeners)} listeners`
    };
  }

  // Without a base prefix: CoverWall adds it to cover hrefs itself.
  function exploreHref(band: ShownBand, entity: 'artist' | 'album', id: string): string {
    const params = new URLSearchParams({ profile: band.slug, range: presetFor(band.window), entity, id });
    return `/explore/?${params.toString()}`;
  }

  function artistHref(band: ShownBand | null, row: RankingRow): string {
    return band ? `${base}${exploreHref(band, 'artist', row.entity_id)}` : '';
  }

  // The RPC returns albums ranked by plays, already capped to the wall's size.
  // Covers use Spotify's 300px art: tiles are at most ~150px wide.
  function albumsToCovers(band: ShownBand): CoverItem[] {
    return band.data.albums.map(
      (row) =>
        ({
          id: row.entity_id,
          title: row.entity_name,
          subtitle: row.artist_name,
          value: formatMetric(metricValue(row, 'plays'), 'plays'),
          imageUrl: row.image_url ? coverVariant(row.image_url, 'medium') : null,
          href: exploreHref(band, 'album', row.entity_id)
        }) satisfies CoverItem
    );
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

  // The plays arguments are passed in, not read from state, so this re-runs
  // whenever they change (see the Svelte notes in AGENTS.md).
  function summaryRows(
    payload: OverviewPayload | null,
    today: number,
    last7Days: number,
    last30Days: number
  ): SummaryRow[] {
    if (!payload) return [];
    return [
      {
        label: SUMMARY_LABELS[0],
        value: summaryValue(today),
        ...topArtistDetail(payload.today.top_artist)
      },
      {
        label: SUMMARY_LABELS[1],
        value: summaryValue(last7Days),
        ...topArtistDetail(payload.this_week.top_artists[0]?.entity_name)
      },
      {
        label: SUMMARY_LABELS[2],
        value: summaryValue(last30Days),
        ...topArtistDetail(payload.last_30_days.top_artists[0]?.entity_name)
      }
    ];
  }
</script>

<svelte:head>
  {@html prefetchScript}
  <!-- Album art host for the cover wall. -->
  <link rel="preconnect" href="https://i.scdn.co" />
</svelte:head>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Australia/Melbourne</span>
    <!-- The slug is known before the profile list arrives, so the header shows
         it at once instead of a generic title that then changes size. -->
    <h1>{showGenericHeader ? 'Listening history' : (selectedProfile?.display_name ?? selectedSlug)}</h1>
    <p class="lede">
      {showGenericHeader ? 'Public read-only Spotify listening summaries.' : `@${selectedSlug}`}
    </p>
  </div>

  {#if !publicSupabaseConfigured}
    <section class="panel">
      <h2>Supabase is not configured</h2>
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY to load public dashboard data.</p>
    </section>
  {:else if error && !overview}
    <section class="panel"><p class="error">{error}</p></section>
  {:else if noProfiles}
    <section class="panel">
      <h2>No public profiles yet</h2>
      <p class="muted">Make at least one connected profile public to show it here.</p>
    </section>
  {:else if noOverview}
    <section class="panel">
      <h2>No overview cache yet</h2>
      <p class="muted">Run a sync so this profile has a public overview cache.</p>
    </section>
  {:else}
    <!-- One layout from the first paint (it is in the prerendered HTML) to the
         last response: each part shows a placeholder until its data arrives,
         so nothing moves when it does. -->
    {#if error}
      <p class="error refresh-error">Could not refresh: {error}</p>
    {/if}

    <div class="profile-picker">
      <span class="profile-label">profile</span>
      <details bind:this={profileMenu} class="menu">
        <summary class="menu-trigger"
          >{selectedProfile ? profileOptionLabel(selectedProfile) : selectedSlug}</summary
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

    <DitherFrame>
      <section class="grid {metricColumns}">
        {#if overview}
          {#each summary as row}
            <MetricCard
              label={row.label}
              value={row.value}
              caption={row.caption}
              detail={row.detail}
            />
          {/each}
        {:else}
          {#each SUMMARY_LABELS as label}
            <MetricCard {label} value="" loading />
          {/each}
        {/if}
        {#if popularityCard}
          <MetricCard
            label={popularityCard.label}
            value={popularityCard.value}
            caption={popularityCard.caption}
            detail={popularityCard.detail}
          />
        {/if}
      </section>
    </DitherFrame>

    <PixelRoom station="overview-listening-deck" shelf="right" />

    <div class="window-bar room-follow">
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
      <section class="band-region" class:is-pending={bandPending}>
        <div class="section-heading">
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
        <StatList
          rows={topArtists}
          loading={bandSkeleton}
          entityKind="artist"
          waveTop
          hrefFor={(row) => artistHref(shownBand, row)}
        />
      </div>

      <div>
        <div class="section-heading">
          <h2>Top tracks {windowLabel}</h2>
          <span class="muted">Plays</span>
        </div>
        <StatList rows={topTracks} loading={bandSkeleton} waveTop />
      </div>
    </section>

    <div class="time-row section-gap">
      <section class="calendar-panel">
        <div class="section-heading">
          <h2>Listening calendar</h2>
          <span class="muted">Plays per day</span>
        </div>
        <div class="cal-body">
          {#if overview}
            <ContributionGraph days={calendarDays} metric="plays" />
          {:else}
            <span class="skeleton calendar-skeleton" aria-hidden="true"></span>
          {/if}
        </div>
      </section>

      {#if !overview || (overview.clock && overview.clock.length > 0)}
        <section class="clock-panel">
          <div class="section-heading">
            <h2>Listening clock</h2>
            <span class="muted">Last 30 days</span>
          </div>
          {#if overview}
            <ListeningClock buckets={overview.clock ?? []} />
          {:else}
            <span class="skeleton clock-skeleton" aria-hidden="true"></span>
          {/if}
        </section>
      {/if}
    </div>

    {#if overview?.release_years && overview.release_years.length > 0}
      <section class="section-gap">
        <div class="section-heading">
          <h2>The age of your music</h2>
          <span class="muted">Plays by release year</span>
        </div>
        <ReleaseYearChart buckets={overview.release_years} />
      </section>
    {/if}

    {#if insights && hasHourTags(insights.hour_tags)}
      <section class="section-gap">
        <div class="section-heading">
          <h2>What your hours sound like</h2>
          <span class="muted">Tags you play more than usual, all time</span>
        </div>
        <HourTags buckets={insights.hour_tags} />
      </section>
    {/if}

    {#if insights && reliableMedian(insights.popularity.all_time) !== null}
      <section class="section-gap">
        <div class="section-heading">
          <h2>How mainstream</h2>
          <span class="muted">Last.fm listeners, all time</span>
        </div>
        <PopularityPanel {insights} strip={popularityStrip} artistHref={deepCutArtistHref} />
      </section>
    {/if}

    {#if overview}
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
  {/if}
</section>

<style>
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
    line-height: var(--leading-sm);
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
    line-height: var(--leading-sm);
  }


  /* Un-boxed sections need whitespace to hold the page together: major
     sections sit ~36px apart instead of the old 16px. */
  .section-gap {
    margin-top: var(--space-12);
  }

  /* Wider gutter between the two un-boxed ranking columns. */
  .band-region.cols-2 {
    column-gap: var(--space-12);
    row-gap: var(--space-8);
  }

  .window-bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-3);
  }

  .room-follow {
    margin-top: var(--space-6);
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
    line-height: var(--leading-sm);
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
    align-items: flex-start;
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
    /* Stops the dial eating the row beside the calendar. Purely a two-column
       constraint — see the media query below, where it has to come back off. */
    max-width: 300px;
  }

  /* Placeholders sized to what replaces them (measured: the calendar is 222px
     tall on desktop and 170px on a phone; the clock matches ListeningClock's
     dial), so the page does not move when the overview arrives. */
  .calendar-skeleton {
    display: block;
    flex: 1;
    height: 222px;
  }

  .clock-skeleton {
    display: block;
    width: 100%;
    max-width: 230px;
    aspect-ratio: 1;
    margin: var(--space-0-5) auto;
    border-radius: 50%;
  }

  .refresh-error {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  @media (max-width: 800px) {
    .calendar-skeleton {
      height: 170px;
    }

    .clock-skeleton {
      max-width: 280px;
    }

    /* Once .time-row wraps to one column the cap has nothing to protect, and it
       strands the panel against the left edge with dead space beside it. */
    .time-row .clock-panel {
      max-width: none;
    }

    /* A 48px gutter reads as a deliberate column break beside the calendar and
       as a hole once the two panels are stacked. */
    .time-row {
      gap: var(--space-8);
    }
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
    gap: var(--space-1) var(--space-2);
    margin: 0;
    color: var(--muted);
    font-size: var(--text-2xs);
    line-height: var(--leading-2xs);
    letter-spacing: var(--tracking-wider);
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
