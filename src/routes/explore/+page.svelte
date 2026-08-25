<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import CoverWall, { type CoverItem } from '$lib/components/CoverWall.svelte';
  import DitherFrame from '$lib/components/DitherFrame.svelte';
  import ListeningHistoryChart from '$lib/components/ListeningHistoryChart.svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import RecordMark from '$lib/components/RecordMark.svelte';
  import { dateRangeOptions, getPresetDateRange, type DateRangePreset } from '$lib/dateRanges';
  import {
    bestAvailableMetric,
    disabledMetricLabel,
    formatMetric,
    isMetricAvailable,
    metricOptions,
    metricValue
  } from '$lib/metrics';
  import { defaultProfileSlug } from '$lib/profileDefaults';
  import {
    fetchAlbumImages,
    fetchTrackAlbumImages,
    type AlbumImage
  } from '$lib/queries/images';
  import {
    getProfileAlbumTopTracks,
    getProfileArtistDetail,
    getProfileDateSpan,
    getProfileEntityHistory,
    getProfileRankings
  } from '$lib/queries/rankings';
  import { listPublicProfiles } from '$lib/queries/profile';
  import type {
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

  let mounted = false;
  let syncingUrl = false;
  let preset: ExploreDateRangePreset = 'this_month';
  let selectedSlug = defaultProfileSlug;
  let entityType: EntityType = 'artist';
  let metric: Metric = 'plays';
  let entityId = '';
  let profiles: PublicProfileOption[] = [];
  let profileDateSpan: ProfileDateSpan | null = null;
  let rankings: RankingRow[] = [];
  let detailSummary: RankingRow | null = null;
  let detailAlbums: RankingRow[] = [];
  let detailTracks: RankingRow[] = [];
  let entityTimeline: CalendarDay[] = [];
  let albumCovers: CoverItem[] = [];
  let entityArtwork: AlbumImage | null = null;
  let artworkFailed = false;
  let timelineMetric: 'minutes' | 'plays' = 'plays';
  let loading = false;
  let error = '';
  let detailError = '';
  let lastLoadKey = '';
  let lastRankingKey = '';
  let lastSyncedSearch = '';
  let loadToken = 0;
  let profileMenu: HTMLDetailsElement | null = null;
  let rangeMenu: HTMLDetailsElement | null = null;
  let entityMenu: HTMLDetailsElement | null = null;
  let metricMenu: HTMLDetailsElement | null = null;

  $: selectedProfile = profiles.find((profile) => profile.slug === selectedSlug) ?? null;
  $: range = preset === 'all_time' ? profileDateSpan : getPresetDateRange(preset);
  $: selectedRankingRow = entityId ? rankings.find((row) => row.entity_id === entityId) ?? null : null;
  $: selectedEntityName = detailSummary?.entity_name ?? selectedRankingRow?.entity_name ?? entityArtwork?.name ?? '';
  $: detailMetric = detailSummary ? bestAvailableMetric([detailSummary], metric) : metric;
  $: selectedMetricValue = detailSummary ? metricValue(detailSummary, detailMetric) : 0;
  $: timelineMetric = detailMetric === 'minutes' ? 'minutes' : 'plays';
  $: timelineMetricLabel = timelineMetric === 'minutes' ? 'Minutes' : 'Plays';
  $: if (mounted && !loading && !isMetricAvailable(rankings, metric)) {
    metric = 'plays';
  }
  $: rankingKey = `${selectedSlug}:${preset}:${range?.start ?? ''}:${range?.end ?? ''}:${entityType}:${metric}`;
  $: loadKey = `${rankingKey}:${entityId}`;
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
      preset = isExploreDateRangePreset(rangeParam) ? rangeParam : 'this_month';

      const entityParam = url.searchParams.get('entity');
      entityType = isEntityType(entityParam) ? entityParam : 'artist';
      entityId = url.searchParams.get('id') ?? '';
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
    const activeSlug = selectedSlug;
    const activeEntityType = entityType;
    const activeEntityId = entityId;
    const activeMetric = metric;
    const activePreset = preset;
    const activeRankingKey = rankingKey;
    const needsRankings = activeRankingKey !== lastRankingKey;
    lastLoadKey = loadKey;
    error = '';
    detailError = '';
    loading = true;
    const token = ++loadToken;
    resetDetail();
    if (needsRankings) rankings = [];

    try {
      if (!activeRange || profiles.length === 0) {
        rankings = [];
        return;
      }

      if (needsRankings) {
        const rows = await getProfileRankings({
          slug: activeSlug,
          entityType: activeEntityType,
          start: activeRange.start,
          end: activeRange.end,
          metric: activeMetric,
          limit: 100
        });
        if (token !== loadToken) return;
        rankings = rows;
        lastRankingKey = activeRankingKey;
      }

      if (activeEntityId) {
        await loadEntityDetail({
          slug: activeSlug,
          entityType: activeEntityType,
          entityId: activeEntityId,
          start: activeRange.start,
          end: activeRange.end,
          metric: activeMetric,
          preset: activePreset,
          token
        });
      }
    } catch (caught) {
      if (token !== loadToken) return;
      error = caught instanceof Error ? caught.message : String(caught);
      rankings = [];
      resetDetail();
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  function resetDetail(): void {
    detailSummary = null;
    detailAlbums = [];
    detailTracks = [];
    entityTimeline = [];
    albumCovers = [];
    entityArtwork = null;
    artworkFailed = false;
  }

  async function loadEntityDetail(params: {
    slug: string;
    entityType: EntityType;
    entityId: string;
    start: string;
    end: string;
    metric: Metric;
    preset: ExploreDateRangePreset;
    token: number;
  }): Promise<void> {
    try {
      if (params.entityType === 'artist') {
        const [detail, history] = await Promise.all([
          getProfileArtistDetail({
            slug: params.slug,
            artistId: params.entityId,
            start: params.start,
            end: params.end,
            metric: params.metric,
            limit: 12
          }),
          getProfileEntityHistory(params)
        ]);
        if (params.token !== loadToken) return;
        const summary = detail.summary ?? history.summary;
        detailSummary = summary;
        detailAlbums = detail.albums;
        detailTracks = detail.tracks;
        entityTimeline = history.timeline;
        await loadArtistCovers({
          ...params,
          artistName: summary?.entity_name ?? ''
        });
        return;
      }

      if (params.entityType === 'album') {
        const [history, tracks] = await Promise.all([
          getProfileEntityHistory(params),
          getProfileAlbumTopTracks({
            slug: params.slug,
            albumId: params.entityId,
            start: params.start,
            end: params.end,
            metric: params.metric,
            limit: 20
          })
        ]);
        if (params.token !== loadToken) return;
        detailSummary = history.summary;
        detailTracks = tracks;
        entityTimeline = history.timeline;
        await loadEntityArtwork(params.entityType, params.entityId, params.token);
        return;
      }

      const history = await getProfileEntityHistory(params);
      if (params.token !== loadToken) return;
      detailSummary = history.summary;
      entityTimeline = history.timeline;
      await loadEntityArtwork(params.entityType, params.entityId, params.token);
    } catch (caught) {
      if (params.token !== loadToken) return;
      resetDetail();
      detailError = caught instanceof Error ? caught.message : String(caught);
    }
  }

  async function loadArtistCovers(params: {
    slug: string;
    preset: ExploreDateRangePreset;
    metric: Metric;
    token: number;
    artistName: string;
  }): Promise<void> {
    try {
      const images = await fetchAlbumImages(detailAlbums.map((row) => Number(row.entity_id)));
      if (params.token !== loadToken) return;
      const coverMetric = detailSummary ? bestAvailableMetric([detailSummary], params.metric) : params.metric;
      albumCovers = detailAlbums.map((row) => ({
        id: row.entity_id,
        title: row.entity_name,
        subtitle: params.artistName,
        value: formatMetric(metricValue(row, coverMetric), coverMetric),
        imageUrl: images.get(Number(row.entity_id))?.image_url ?? null,
        href: `/explore/?profile=${encodeURIComponent(params.slug)}&range=${encodeURIComponent(params.preset)}&entity=album&id=${encodeURIComponent(row.entity_id)}`
      }));
    } catch {
      if (params.token !== loadToken) return;
      albumCovers = detailAlbums.map((row) => ({
        id: row.entity_id,
        title: row.entity_name,
        subtitle: params.artistName,
        value: formatMetric(metricValue(row, params.metric), params.metric),
        imageUrl: null,
        href: `/explore/?profile=${encodeURIComponent(params.slug)}&range=${encodeURIComponent(params.preset)}&entity=album&id=${encodeURIComponent(row.entity_id)}`
      }));
    }
  }

  async function loadEntityArtwork(type: EntityType, id: string, token: number): Promise<void> {
    try {
      const numericId = Number(id);
      if (type === 'album') {
        const images = await fetchAlbumImages([numericId]);
        if (token === loadToken) entityArtwork = images.get(numericId) ?? null;
      } else if (type === 'track') {
        const images = await fetchTrackAlbumImages([numericId]);
        if (token === loadToken) entityArtwork = images.get(numericId) ?? null;
      }
    } catch {
      /* Artwork is decorative metadata; keep the listening detail usable. */
    }
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

  <!-- The pickers are cards on the dither field; the field fills the gaps
       between them, same treatment as the overview page's metric cards. -->
  <DitherFrame>
    <div class="toolbar">
    <div class="picker-field">
      <span class="picker-label">Profile</span>
      <details bind:this={profileMenu} class="menu picker-menu">
        <summary class="menu-trigger is-field">{selectedProfile?.display_name ?? 'Choose profile'}</summary>
        <div class="menu-options is-field" role="radiogroup" aria-label="Profile">
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
      <details bind:this={rangeMenu} class="menu picker-menu">
        <summary class="menu-trigger is-field">{rangeLabel(preset)}</summary>
        <div class="menu-options is-field" role="radiogroup" aria-label="Date range">
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
      <details bind:this={entityMenu} class="menu picker-menu">
        <summary class="menu-trigger is-field">{entityLabel(entityType)}</summary>
        <div class="menu-options is-field" role="radiogroup" aria-label="Entity">
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
      <details bind:this={metricMenu} class="menu picker-menu">
        <summary class="menu-trigger is-field">{metricLabel(metric)}</summary>
        <div class="menu-options is-field" role="radiogroup" aria-label="Metric">
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
  </DitherFrame>

  {#if loading && rankings.length === 0}
    <section class="panel panel-loading section-gap"><RecordMark size="lg" label="Loading explorer data..." /></section>
  {:else if error}
    <section class="panel section-gap"><p class="error">{error}</p></section>
  {:else}
    <section class="explorer-layout section-gap" class:has-detail={Boolean(entityId)}>
      <div class="ranking-col">
        <div class="section-heading">
          <h2>Ranking</h2>
          {#if selectedProfile}<span class="muted">{selectedProfile.display_name}</span>{/if}
        </div>
        <div class="ranking-scroll">
          <RankingTable
            rows={rankings}
            {entityType}
            {metric}
            profileSlug={selectedSlug}
            rangePreset={preset}
            compact
            selectedEntityId={entityId || null}
          />
        </div>
      </div>

      <aside class="detail-panel" id="entity-detail">
        {#if detailError}
          <p class="error">{detailError}</p>
        {:else if !entityId}
          <div class="empty-detail">
            <h2>{entityLabel(entityType)} detail</h2>
            <p class="muted">Select {entityType === 'artist' ? 'an' : 'a'} {entityType} from the ranking.</p>
          </div>
        {:else if loading && !detailSummary}
          <div class="empty-detail"><RecordMark size="sm" label={`Loading ${entityType} detail...`} /></div>
        {:else if detailSummary}
          <div class="entity-heading" class:has-art={entityType !== 'artist'}>
            {#if entityType !== 'artist'}
              <div
                class="entity-art"
                data-pixel-collision="occluder"
                data-pixel-record={entityArtwork?.image_url && !artworkFailed ? entityArtwork.image_url : undefined}
              >
                {#if entityArtwork?.image_url && !artworkFailed}
                  <img
                    src={entityArtwork.image_url}
                    alt={`${entityArtwork.name} cover art`}
                    on:error={() => (artworkFailed = true)}
                  />
                {:else}
                  <span aria-hidden="true">♪</span>
                {/if}
              </div>
            {/if}
            <div class="entity-heading-copy">
              <span class="eyebrow">{entityLabel(entityType)}</span>
              <h2>{selectedEntityName}</h2>
              <span class="muted">{preset === 'all_time' ? 'All time' : range?.start + ' to ' + range?.end}</span>
            </div>
          </div>

          <div class="summary-strip">
            <div class="metric compact">
              <span class="muted">{metricOptions.find((option) => option.value === detailMetric)?.label ?? 'Metric'}</span>
              <strong>{formatMetric(selectedMetricValue, detailMetric)}</strong>
            </div>
            <div class="metric compact">
              <span class="muted">Plays</span>
              <strong>{detailSummary.plays.toLocaleString()}</strong>
            </div>
            <div class="metric compact">
              <span class="muted">{entityType === 'track' ? 'Qualified plays' : 'Unique tracks'}</span>
              <strong>{(entityType === 'track' ? detailSummary.qualified_plays : detailSummary.unique_tracks).toLocaleString()}</strong>
            </div>
          </div>

          <section class="detail-section">
            <div class="detail-subheading">
              <h3>Listening history</h3>
              <span class="muted">{timelineMetricLabel}</span>
            </div>
            {#if range}
              <ListeningHistoryChart
                days={entityTimeline}
                start={range.start}
                end={range.end}
                metric={timelineMetric}
                entityName={selectedEntityName}
              />
            {/if}
          </section>

          {#if entityType === 'artist'}
            <section class="detail-section">
              <h3>Top albums</h3>
              <CoverWall items={albumCovers} trimIncompleteRows={false} />
            </section>
          {/if}

          {#if entityType !== 'track'}
            <section class="detail-section">
              <h3>Top tracks</h3>
              <RankingTable
                rows={detailTracks}
                entityType="track"
                metric={detailMetric}
                profileSlug={selectedSlug}
                rangePreset={preset}
              />
            </section>
          {/if}
        {:else}
          <div class="empty-detail">
            <h2>{entityLabel(entityType)} detail</h2>
            <p class="muted">No plays for this {entityType} in the selected range.</p>
          </div>
        {/if}
      </aside>
    </section>
  {/if}
</section>

<style>
  .section-gap {
    margin-top: 32px;
  }

  /* Four equal columns across the full page width; the dither field fills
     the gaps between the boxes, homepage-metric-cards style. */
  .toolbar {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    padding: 0;
    border: 0;
  }

  /* Each picker is a card on the field, same treatment as the overview
     page's metric cards: hairline box, opaque page ground. */
  .picker-field {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--line);
    background: var(--bg);
  }

  .picker-label {
    color: var(--muted);
  }

  .picker-menu {
    width: 100%;
    min-width: 0;
  }

  /* Bigger control: the trigger fills its card and steps up from the shared
     32px field height to 40px, caret re-centred to match. */
  .picker-menu :global(.menu-trigger.is-field) {
    --menu-caret-top: 17px;
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 40px;
  }

  .picker-menu :global(.menu-options.is-field) {
    width: 100%;
  }

  @media (max-width: 800px) {
    .toolbar {
      grid-template-columns: minmax(0, 1fr);
    }
  }


  /* Heading + one hairline rule; content sits on the page background. */
  .section-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
    margin-bottom: var(--space-4);
  }

  .section-heading .muted {
    font-size: var(--text-sm);
  }

  .section-heading h2,
  .detail-section h3 {
    margin: 0;
  }

  .explorer-layout {
    display: grid;
    grid-template-columns: minmax(280px, 0.55fr) minmax(0, 1.45fr);
    gap: var(--space-8);
    align-items: start;
  }

  .ranking-col,
  .detail-panel {
    min-width: 0;
  }

  .detail-panel {
    display: grid;
    gap: var(--space-6);
  }

  .empty-detail {
    display: grid;
    align-content: center;
    gap: var(--space-1);
    min-height: 220px;
  }

  .entity-heading {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--line);
  }

  .entity-heading.has-art {
    display: grid;
    grid-template-columns: minmax(112px, 148px) minmax(0, 1fr);
    align-items: end;
    gap: var(--space-4);
  }

  .entity-heading-copy {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .entity-heading-copy h2 {
    overflow-wrap: anywhere;
    font-size: var(--text-lg);
  }

  .entity-art {
    display: grid;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    place-items: center;
    border: 1px solid var(--line);
    background: var(--surface-2);
  }

  .entity-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .entity-art span {
    color: var(--muted);
    font-size: 2rem;
  }

  .summary-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  /* Summary figures: no boxes — label over a bold tabular figure. */
  .compact {
    gap: 2px;
  }

  .compact .muted {
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .compact strong {
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }

  .detail-section {
    display: grid;
    gap: var(--space-3);
  }

  .detail-section :global(.cover-wall) {
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  }

  .ranking-scroll {
    max-height: 876px;
    overflow: auto;
    scrollbar-gutter: stable;
  }

  .ranking-scroll :global(th) {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg);
  }

  .detail-subheading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  @media (max-width: 900px) {
    .explorer-layout,
    .summary-strip {
      grid-template-columns: 1fr;
    }

    .explorer-layout.has-detail .detail-panel {
      order: -1;
    }

    .ranking-scroll {
      max-height: none;
    }
  }

  @media (max-width: 500px) {
    .entity-heading.has-art {
      grid-template-columns: 84px minmax(0, 1fr);
    }
  }
</style>
