<script lang="ts">
  import { onMount } from 'svelte';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import MetricCard from '$lib/components/MetricCard.svelte';
  import { bestAvailableMetric, metricLabel, overviewSummaryCards } from '$lib/metrics';
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
  $: summaryCards = overview ? overviewSummaryCards(overview) : [];

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
      <DataQualityBadge quality={1} />
      {#if overview.sync.last_success_at}
        <span class="muted">Last sync {new Date(overview.sync.last_success_at).toLocaleString()}</span>
      {/if}
      <span class="muted">Generated {new Date(overview.generated_at).toLocaleString()}</span>
    </div>

    <section class="grid cols-2 section-gap">
      {#each summaryCards as card}
        <MetricCard label={card.label} value={card.value} caption={card.caption} detail={card.detail} />
      {/each}
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Top artists last 7 days</h2>
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

</style>
