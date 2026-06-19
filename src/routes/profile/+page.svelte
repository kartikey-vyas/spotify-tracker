<script lang="ts">
  import { onMount } from 'svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import { bestAvailableMetric, formatMinutes, metricLabel } from '$lib/metrics';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import { getPublicProfileOverview } from '$lib/queries/overview';
  import { getPublicProfile } from '$lib/queries/profile';
  import type { OverviewPayload, Profile } from '$lib/types';

  let slug = '';
  let profile: Profile | null = null;
  let overview: OverviewPayload | null = null;
  let loading = true;
  let error = '';

  $: artistMetric = overview ? bestAvailableMetric(overview.this_week.top_artists) : 'plays';

  onMount(async () => {
    slug = new URLSearchParams(window.location.search).get('slug') ?? '';
    if (!slug) {
      loading = false;
      return;
    }

    try {
      profile = await getPublicProfile(slug);
      overview = profile ? await getPublicProfileOverview(slug) : null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  });
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">public profile</span>
    <h1>{profile?.display_name ?? 'Spotify history'}</h1>
    <p class="lede">{slug ? `@${slug}` : 'Missing profile slug.'}</p>
  </div>

  {#if !publicSupabaseConfigured}
    <section class="panel">
      <h2>Supabase is not configured</h2>
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.</p>
    </section>
  {:else if loading}
    <section class="panel"><p class="muted">Loading profile...</p></section>
  {:else if error}
    <section class="panel"><p class="error">{error}</p></section>
  {:else if !slug}
    <section class="panel"><p class="muted">Use /profile/?slug=name.</p></section>
  {:else if !profile}
    <section class="panel"><p class="muted">No public profile found.</p></section>
  {:else if !overview}
    <section class="panel"><p class="muted">This profile has no public stats yet.</p></section>
  {:else}
    <div class="status-row">
      <DataQualityBadge quality={1} gapRisk={overview.sync.gap_risk} />
      {#if overview.sync.last_success_at}
        <span class="muted">Last sync {new Date(overview.sync.last_success_at).toLocaleString()}</span>
      {/if}
      <span class="muted">Generated {new Date(overview.generated_at).toLocaleString()}</span>
    </div>

    <section class="grid cols-3 section-gap">
      <section class="panel metric-card">
        <span class="metric-label">This week</span>
        <strong>
          {overview.this_week.minutes > 0
            ? formatMinutes(overview.this_week.minutes)
            : `${overview.this_week.top_artists.reduce((total, row) => total + row.plays, 0)} plays`}
        </strong>
        <p>{overview.this_week.top_artists[0]?.entity_name ?? 'No plays yet'}</p>
      </section>
      <section class="panel metric-card">
        <span class="metric-label">Top genre</span>
        <strong>{overview.today.top_genre ?? 'Unknown'}</strong>
        <p>today</p>
      </section>
      <section class="panel metric-card">
        <span class="metric-label">Last 30 days</span>
        <strong>
          {overview.last_30_days.minutes > 0
            ? formatMinutes(overview.last_30_days.minutes)
            : `${overview.last_30_days.top_artists.reduce((total, row) => total + row.plays, 0)} plays`}
        </strong>
        <p>{overview.last_30_days.top_artists[0]?.entity_name ?? 'No plays yet'}</p>
      </section>
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Top artists this week</h2>
        <span class="muted">{metricLabel(artistMetric)}</span>
      </div>
      <RankingTable rows={overview.this_week.top_artists} entityType="artist" metric={artistMetric} />
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
</style>

