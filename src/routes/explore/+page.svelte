<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
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
  import {
    buildTimelineHistogram,
    monthlyBarWidth,
    timelineBucketMode,
    type TimelineHistogramBucket
  } from '$lib/monthlyTimeline';
  import { defaultProfileSlug } from '$lib/profileDefaults';
  import {
    getProfileArtistDetail,
    getProfileDateSpan,
    getProfileEntityTimeline,
    getProfileRankings
  } from '$lib/queries/rankings';
  import { listPublicProfiles } from '$lib/queries/profile';
  import type {
    ArtistDetail,
    CalendarDay,
    EntityType,
    Metric,
    ProfileDateSpan,
    PublicProfileOption,
    RankingRow
  } from '$lib/types';

  type ExploreDateRangePreset = DateRangePreset | 'all_time';

  const entityOptions: Array<{ value: EntityType; label: string }> = [
    { value: 'artist', label: 'Artist' },
    { value: 'track', label: 'Track' },
    { value: 'album', label: 'Album' }
  ];

  const exploreDateRangeOptions: Array<{ value: ExploreDateRangePreset; label: string }> = [
    ...dateRangeOptions,
    { value: 'all_time', label: 'All time' }
  ];

  const emptyArtistDetail = (): ArtistDetail => ({
    summary: null,
    albums: [],
    tracks: [],
    monthly: []
  });

  let mounted = false;
  let syncingUrl = false;
  let preset: ExploreDateRangePreset = 'last_30_days';
  let selectedSlug = defaultProfileSlug;
  let entityType: EntityType = 'artist';
  let metric: Metric = 'plays';
  let entityId = '';
  let profiles: PublicProfileOption[] = [];
  let profileDateSpan: ProfileDateSpan | null = null;
  let rankings: RankingRow[] = [];
  let artistDetail: ArtistDetail = emptyArtistDetail();
  let artistTimeline: CalendarDay[] = [];
  let timelineMetric: 'minutes' | 'plays' = 'plays';
  let loading = false;
  let error = '';
  let detailError = '';
  let lastLoadKey = '';
  let lastSyncedSearch = '';
  let loadToken = 0;
  let profileMenu: HTMLDetailsElement | null = null;
  let rangeMenu: HTMLDetailsElement | null = null;
  let entityMenu: HTMLDetailsElement | null = null;
  let metricMenu: HTMLDetailsElement | null = null;

  $: selectedProfile = profiles.find((profile) => profile.slug === selectedSlug) ?? null;
  $: range = preset === 'all_time' ? profileDateSpan : getPresetDateRange(preset);
  $: selectedArtistName = artistDetail.summary?.entity_name ?? selectedRankingRow?.entity_name ?? '';
  $: selectedRankingRow = entityId ? rankings.find((row) => row.entity_id === entityId) ?? null : null;
  $: detailMetric = artistDetail.summary ? bestAvailableMetric([artistDetail.summary], metric) : metric;
  $: selectedMetricValue = artistDetail.summary ? metricValue(artistDetail.summary, detailMetric) : 0;
  $: timelineBuckets = range ? buildTimelineHistogram(artistTimeline, range.start, range.end) : [];
  $: histogramBucketMode = range ? timelineBucketMode(range.start, range.end) : 'day';
  $: timelineMetric = detailMetric === 'minutes' ? 'minutes' : 'plays';
  $: timelineMetricLabel = timelineMetric === 'minutes' ? 'Minutes' : 'Plays';
  $: timelineMaxValue = Math.max(0, ...timelineBuckets.map((bucket) => bucket[timelineMetric]));
  $: if (mounted && !loading && !isMetricAvailable(rankings, metric)) {
    metric = 'plays';
  }
  $: loadKey = `${selectedSlug}:${preset}:${range?.start ?? ''}:${range?.end ?? ''}:${entityType}:${metric}:${entityId}`;
  $: if (mounted && !syncingUrl && loadKey !== lastLoadKey) {
    void loadExplorer();
  }
  $: pageSearch = browser ? $page.url.search : '';
  $: if (mounted && pageSearch !== lastSyncedSearch) {
    void syncFromUrl($page.url);
  }

  onMount(async () => {
    try {
      profiles = await listPublicProfiles();
      await syncFromUrl($page.url);
      mounted = true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      mounted = true;
    }
  });

  onMount(() => {
    const closeMenusOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const menus = [profileMenu, rangeMenu, entityMenu, metricMenu].filter(
        (menu): menu is HTMLDetailsElement => menu !== null
      );
      if (menus.some((menu) => menu.contains(target))) return;
      for (const menu of menus) menu.open = false;
    };

    document.addEventListener('click', closeMenusOnOutsideClick);
    return () => document.removeEventListener('click', closeMenusOnOutsideClick);
  });

  async function syncFromUrl(url: URL): Promise<void> {
    syncingUrl = true;
    lastSyncedSearch = url.search;

    try {
      const requestedSlug = url.searchParams.get('profile') ?? defaultProfileSlug;
      const nextSlug = publicProfileSlug(requestedSlug);
      const slugChanged = nextSlug !== selectedSlug;
      selectedSlug = nextSlug;
      if (slugChanged || !profileDateSpan) {
        profileDateSpan = await getProfileDateSpan(selectedSlug);
      }

      const rangeParam = url.searchParams.get('range');
      preset = isExploreDateRangePreset(rangeParam) ? rangeParam : 'last_30_days';

      const entityParam = url.searchParams.get('entity');
      entityType = isEntityType(entityParam) ? entityParam : 'artist';
      entityId = entityType === 'artist' ? (url.searchParams.get('id') ?? '') : (url.searchParams.get('id') ?? '');
      if (requestedSlug !== nextSlug) entityId = '';
    } finally {
      syncingUrl = false;
    }
  }

  function publicProfileSlug(requestedSlug: string): string {
    if (profiles.length === 0) return requestedSlug || defaultProfileSlug;
    if (profiles.some((profile) => profile.slug === requestedSlug)) return requestedSlug;
    return profiles.find((profile) => profile.slug === defaultProfileSlug)?.slug ?? profiles[0].slug;
  }

  function isExploreDateRangePreset(value: string | null): value is ExploreDateRangePreset {
    return exploreDateRangeOptions.some((option) => option.value === value);
  }

  function isEntityType(value: string | null): value is EntityType {
    return value === 'artist' || value === 'track' || value === 'album';
  }

  async function setUrlState(changes: {
    profile?: string;
    range?: ExploreDateRangePreset;
    entity?: EntityType;
    id?: string | null;
  }): Promise<void> {
    const url = new URL($page.url);
    if (changes.profile !== undefined) {
      url.searchParams.set('profile', changes.profile);
      url.searchParams.delete('id');
    }
    if (changes.range !== undefined) {
      url.searchParams.set('range', changes.range);
    }
    if (changes.entity !== undefined) {
      url.searchParams.set('entity', changes.entity);
      url.searchParams.delete('id');
    }
    if (changes.id !== undefined) {
      if (changes.id) {
        url.searchParams.set('id', changes.id);
      } else {
        url.searchParams.delete('id');
      }
    }

    await goto(`${url.pathname}${url.search}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true
    });
  }

  function closeMenus(): void {
    for (const menu of [profileMenu, rangeMenu, entityMenu, metricMenu]) {
      if (menu) menu.open = false;
    }
  }

  async function chooseProfile(slug: string): Promise<void> {
    closeMenus();
    await setUrlState({ profile: slug });
  }

  async function chooseRange(next: ExploreDateRangePreset): Promise<void> {
    closeMenus();
    await setUrlState({ range: next });
  }

  async function chooseEntity(next: EntityType): Promise<void> {
    closeMenus();
    await setUrlState({ entity: next });
  }

  function chooseMetric(next: Metric): void {
    metric = next;
    closeMenus();
  }

  async function loadExplorer(): Promise<void> {
    const activeRange = range;
    lastLoadKey = loadKey;
    error = '';
    detailError = '';
    loading = true;
    const token = ++loadToken;

    try {
      if (!activeRange || profiles.length === 0) {
        rankings = [];
        artistDetail = emptyArtistDetail();
        artistTimeline = [];
        return;
      }

      const rows = await getProfileRankings({
        slug: selectedSlug,
        entityType,
        start: activeRange.start,
        end: activeRange.end,
        metric,
        limit: 100
      });
      if (token !== loadToken) return;
      rankings = rows;

      if (entityType === 'artist' && entityId) {
        try {
          const [detail, timeline] = await Promise.all([
            getProfileArtistDetail({
              slug: selectedSlug,
              artistId: entityId,
              start: activeRange.start,
              end: activeRange.end,
              metric,
              limit: 12
            }),
            getProfileEntityTimeline({
              slug: selectedSlug,
              entityType: 'artist',
              entityId,
              start: activeRange.start,
              end: activeRange.end
            })
          ]);
          if (token !== loadToken) return;
          artistDetail = detail;
          artistTimeline = timeline;
        } catch (caught) {
          if (token !== loadToken) return;
          artistDetail = emptyArtistDetail();
          artistTimeline = [];
          detailError = caught instanceof Error ? caught.message : String(caught);
        }
      } else {
        artistDetail = emptyArtistDetail();
        artistTimeline = [];
      }
    } catch (caught) {
      if (token !== loadToken) return;
      error = caught instanceof Error ? caught.message : String(caught);
      rankings = [];
      artistDetail = emptyArtistDetail();
      artistTimeline = [];
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  function timelineBucketTitle(bucket: TimelineHistogramBucket): string {
    const value = bucket[timelineMetric];
    return `${bucket.key}: ${formatMetric(value, timelineMetric)}`;
  }

  function rangeLabel(value: ExploreDateRangePreset): string {
    return exploreDateRangeOptions.find((option) => option.value === value)?.label ?? 'Date range';
  }

  function entityLabel(value: EntityType): string {
    return entityOptions.find((option) => option.value === value)?.label ?? 'Entity';
  }

  function metricLabel(value: Metric): string {
    return metricOptions.find((option) => option.value === value)?.label ?? 'Metric';
  }
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Explorer</span>
    <h1>Explore a public profile</h1>
    <p class="lede">Rank artists, tracks, and albums for one profile at a time.</p>
  </div>

  <div class="toolbar">
    <div class="picker-field">
      <span class="picker-label">Profile</span>
      <details bind:this={profileMenu} class="picker-menu">
        <summary>{selectedProfile?.display_name ?? 'Choose profile'}</summary>
        <div class="picker-options" role="radiogroup" aria-label="Profile">
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
          {:else}
            <button type="button" disabled>No public profiles</button>
          {/each}
        </div>
      </details>
    </div>

    <div class="picker-field">
      <span class="picker-label">Date range</span>
      <details bind:this={rangeMenu} class="picker-menu">
        <summary>{rangeLabel(preset)}</summary>
        <div class="picker-options" role="radiogroup" aria-label="Date range">
          {#each exploreDateRangeOptions as option}
            <button
              class:active={option.value === preset}
              type="button"
              role="radio"
              aria-checked={option.value === preset}
              on:click={() => chooseRange(option.value)}
            >
              <span>{option.label}</span>
            </button>
          {/each}
        </div>
      </details>
    </div>

    <div class="picker-field">
      <span class="picker-label">Entity</span>
      <details bind:this={entityMenu} class="picker-menu">
        <summary>{entityLabel(entityType)}</summary>
        <div class="picker-options" role="radiogroup" aria-label="Entity">
          {#each entityOptions as option}
            <button
              class:active={option.value === entityType}
              type="button"
              role="radio"
              aria-checked={option.value === entityType}
              on:click={() => chooseEntity(option.value)}
            >
              <span>{option.label}</span>
            </button>
          {/each}
        </div>
      </details>
    </div>

    <div class="picker-field">
      <span class="picker-label">Metric</span>
      <details bind:this={metricMenu} class="picker-menu">
        <summary>{metricLabel(metric)}</summary>
        <div class="picker-options" role="radiogroup" aria-label="Metric">
          {#each metricOptions as option}
            {@const disabled = !isMetricAvailable(rankings, option.value)}
            <button
              class:active={option.value === metric}
              type="button"
              role="radio"
              aria-checked={option.value === metric}
              {disabled}
              on:click={() => !disabled && chooseMetric(option.value)}
            >
              <span>{disabled ? disabledMetricLabel(option.value) : option.label}</span>
            </button>
          {/each}
        </div>
      </details>
    </div>
  </div>

  {#if loading && rankings.length === 0}
    <section class="panel section-gap"><p class="muted">Loading explorer data...</p></section>
  {:else if error}
    <section class="panel section-gap"><p class="error">{error}</p></section>
  {:else}
    <section class="explorer-layout section-gap">
      <div class="panel">
        <div class="section-heading">
          <h2>Ranking</h2>
          {#if selectedProfile}<span class="muted">{selectedProfile.display_name}</span>{/if}
        </div>
        <div class="ranking-scroll" class:is-artist-ranking={entityType === 'artist'}>
          <RankingTable rows={rankings} {entityType} {metric} profileSlug={selectedSlug} rangePreset={preset} />
        </div>
      </div>

      {#if entityType === 'artist'}
        <aside class="panel detail-panel">
          {#if detailError}
            <p class="error">{detailError}</p>
          {:else if !entityId}
            <div class="empty-detail">
              <h2>Artist detail</h2>
              <p class="muted">Select an artist from the ranking.</p>
            </div>
          {:else if artistDetail.summary}
            <div class="section-heading">
              <h2>{selectedArtistName}</h2>
              <span class="muted">{preset === 'all_time' ? 'All time' : range?.start + ' to ' + range?.end}</span>
            </div>

            <div class="summary-strip">
              <div class="metric compact">
                <span class="muted">{metricOptions.find((option) => option.value === detailMetric)?.label ?? 'Metric'}</span>
                <strong>{formatMetric(selectedMetricValue, detailMetric)}</strong>
              </div>
              <div class="metric compact">
                <span class="muted">Plays</span>
                <strong>{artistDetail.summary.plays.toLocaleString()}</strong>
              </div>
              <div class="metric compact">
                <span class="muted">Unique tracks</span>
                <strong>{artistDetail.summary.unique_tracks.toLocaleString()}</strong>
              </div>
            </div>

            <section class="detail-section">
              <div class="detail-subheading">
                <h3>Timeline</h3>
                <span class="muted">{timelineMetricLabel}</span>
              </div>
              <div
                class="histogram"
                class:is-daily={histogramBucketMode === 'day'}
                aria-label={`${selectedArtistName} timeline by ${timelineMetricLabel.toLowerCase()}`}
              >
                {#each timelineBuckets as bucket}
                  {@const value = bucket[timelineMetric]}
                  <div class="histogram-column" title={timelineBucketTitle(bucket)}>
                    <div
                      class="histogram-bar"
                      class:is-empty={value <= 0}
                      style:height={`${monthlyBarWidth(value, timelineMaxValue)}%`}
                    ></div>
                    {#if bucket.label}
                      <span class="histogram-label">{bucket.label}</span>
                    {/if}
                  </div>
                {:else}
                  <p class="muted">No timeline data for this range.</p>
                {/each}
              </div>
            </section>

            <section class="detail-grid">
              <div>
                <h3>Top albums</h3>
                <RankingTable
                  rows={artistDetail.albums}
                  entityType="album"
                  metric={detailMetric}
                  profileSlug={selectedSlug}
                  rangePreset={preset}
                />
              </div>
              <div>
                <h3>Top tracks</h3>
                <RankingTable
                  rows={artistDetail.tracks}
                  entityType="track"
                  metric={detailMetric}
                  profileSlug={selectedSlug}
                  rangePreset={preset}
                />
              </div>
            </section>
          {:else}
            <div class="empty-detail">
              <h2>Artist detail</h2>
              <p class="muted">No plays for this artist in the selected range.</p>
            </div>
          {/if}
        </aside>
      {/if}
    </section>
  {/if}
</section>

<style>
  .section-gap {
    margin-top: 16px;
  }

  .picker-field {
    display: grid;
    gap: 4px;
    min-width: 160px;
  }

  .picker-label {
    color: var(--muted);
  }

  .picker-menu {
    position: relative;
    min-width: 160px;
  }

  .picker-menu summary {
    min-height: 32px;
    padding: 5px 28px 5px 9px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    list-style: none;
  }

  .picker-menu summary::after {
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

  .picker-menu[open] summary::after {
    transform: rotate(180deg);
  }

  .picker-menu summary::-webkit-details-marker {
    display: none;
  }

  .picker-menu summary:hover {
    background: var(--surface-2);
  }

  .picker-options {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 10;
    display: grid;
    min-width: 100%;
    border: 1px solid var(--line);
    background: var(--surface);
  }

  .picker-options button {
    display: block;
    width: 100%;
    min-height: 32px;
    padding: 7px 9px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: nowrap;
  }

  .picker-options button:last-child {
    border-bottom: 0;
  }

  .picker-options button:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .picker-options button.active {
    background: var(--text);
    color: var(--bg);
  }

  .section-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .section-heading h2,
  .detail-section h3,
  .detail-grid h3 {
    margin: 0;
  }

  .explorer-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(320px, 0.9fr);
    gap: 16px;
    align-items: start;
  }

  .detail-panel {
    display: grid;
    gap: 16px;
  }

  .empty-detail {
    display: grid;
    align-content: center;
    min-height: 220px;
  }

  .summary-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .compact {
    min-height: 76px;
    padding: 10px;
    border: 1px solid var(--line);
  }

  .detail-section {
    display: grid;
    gap: 10px;
  }

  .ranking-scroll.is-artist-ranking {
    max-height: 876px;
    overflow: auto;
    scrollbar-gutter: stable;
  }

  .ranking-scroll.is-artist-ranking :global(.table-wrap) {
    overflow: visible;
  }

  .ranking-scroll.is-artist-ranking :global(th) {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg);
  }

  .ranking-scroll.is-artist-ranking :global(td:nth-child(2)) {
    white-space: nowrap;
  }

  .detail-subheading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .histogram {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    min-height: 118px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 0 24px;
    border-bottom: 1px solid var(--line);
    scrollbar-gutter: stable;
  }

  .histogram-column {
    position: relative;
    display: flex;
    flex: 0 0 10px;
    align-items: flex-end;
    height: 86px;
  }

  .histogram.is-daily .histogram-column {
    flex-basis: 4px;
    gap: 1px;
  }

  .histogram-bar {
    width: 100%;
    min-height: 1px;
    background: var(--text);
  }

  .histogram-bar.is-empty {
    min-height: 0;
    background: transparent;
  }

  .histogram-label {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    color: var(--muted);
    font-size: 0.74rem;
    line-height: 1;
    white-space: nowrap;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  @media (max-width: 900px) {
    .explorer-layout,
    .detail-grid,
    .summary-strip {
      grid-template-columns: 1fr;
    }
  }
</style>
