<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { Session } from '@supabase/supabase-js';
  import RankingTable from '$lib/components/RankingTable.svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import MetricCard from '$lib/components/MetricCard.svelte';
  import { bestAvailableMetric, metricLabel, overviewSummaryCards } from '$lib/metrics';
  import { publicSupabaseConfigured, supabase } from '$lib/supabase';
  import { getUserOverview } from '$lib/queries/overview';
  import {
    getCurrentProfile,
    getSpotifyConnectionStatus,
    updateProfilePublicFlag,
    updateSpotifySyncEnabled
  } from '$lib/queries/profile';
  import type { OverviewPayload, Profile, SpotifyConnectionStatus } from '$lib/types';

  let session: Session | null = null;
  let profile: Profile | null = null;
  let connection: SpotifyConnectionStatus | null = null;
  let overview: OverviewPayload | null = null;
  let loading = true;
  let message = '';
  let error = '';

  let email = '';
  let inviteCode = '';
  let slug = '';
  let displayName = '';
  let isPublic = false;
  const slugPattern = '[a-z0-9][a-z0-9-]{1,38}[a-z0-9]';

  $: artistMetric = overview ? bestAvailableMetric(overview.this_week.top_artists) : 'plays';
  $: summaryCards = overview ? overviewSummaryCards(overview) : [];
  $: publicUrl = profile ? `${locationOrigin()}${base}/profile/?slug=${profile.slug}` : '';

  onMount(() => {
    if (!supabase) {
      loading = false;
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('spotify') === 'connected') message = 'Spotify connected.';
    if (params.get('spotify') === 'error') error = params.get('message') ?? 'Spotify connection failed.';
    if (hashParams.get('error')) {
      error = hashParams.get('error_description') ?? hashParams.get('error') ?? 'Authentication failed.';
    }

    supabase.auth.getSession().then(async ({ data }) => {
      session = data.session;
      await loadUserData();
      loading = false;
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      await loadUserData();
    });

    return () => subscription.unsubscribe();
  });

  function locationOrigin(): string {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }

  function appUrl(): string {
    return `${locationOrigin()}${base}/app/`;
  }

  async function loadUserData(): Promise<void> {
    if (!supabase || !session?.user) {
      profile = null;
      connection = null;
      overview = null;
      return;
    }

    profile = await getCurrentProfile(session.user.id);
    connection = profile ? await getSpotifyConnectionStatus() : null;
    overview = profile ? await getUserOverview(session.user.id) : null;
  }

  async function submitAuth(): Promise<void> {
    if (!supabase) return;
    error = '';
    message = '';

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: appUrl()
      }
    });

    if (authError) {
      error = authError.message;
      return;
    }

    message = 'Check your email for a sign-in link.';
  }

  async function completeOnboarding(): Promise<void> {
    if (!supabase) return;
    error = '';
    message = '';

    const { data, error: invokeError } = await supabase.functions.invoke('complete-onboarding', {
      body: {
        inviteCode,
        slug,
        displayName,
        isPublic
      }
    });

    if (invokeError) {
      error = invokeError.message;
      return;
    }

    profile = data.profile;
    message = 'Onboarding complete.';
    await loadUserData();
  }

  async function connectSpotify(): Promise<void> {
    if (!supabase) return;
    error = '';
    message = '';

    const { data, error: invokeError } = await supabase.functions.invoke('spotify-connect', {
      body: {
        redirectTo: appUrl()
      }
    });

    if (invokeError) {
      error = invokeError.message;
      return;
    }

    window.location.href = data.url;
  }

  async function togglePublic(): Promise<void> {
    if (!profile) return;
    const nextValue = !profile.is_public;
    await updateProfilePublicFlag(nextValue);
    profile = { ...profile, is_public: nextValue };
  }

  async function toggleSync(): Promise<void> {
    if (!connection) return;
    const nextValue = !connection.sync_enabled;
    await updateSpotifySyncEnabled(nextValue);
    connection = { ...connection, sync_enabled: nextValue };
  }

  async function signOut(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
    session = null;
    profile = null;
    connection = null;
    overview = null;
  }
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">invite-only</span>
    <h1>Your dashboard</h1>
    <p class="lede">Private write path. Public profile only if you turn it on.</p>
  </div>

  {#if !publicSupabaseConfigured}
    <section class="panel">
      <h2>Supabase is not configured</h2>
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.</p>
    </section>
  {:else if loading}
    <section class="panel"><p class="muted">Loading session...</p></section>
  {:else}
    {#if message}<p class="notice">{message}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}

    {#if !session}
      <section class="panel auth-panel">
        <h2>Sign in</h2>
        <p class="muted">Invite-only access.</p>

        <form on:submit|preventDefault={submitAuth}>
          <label>
            email
            <input bind:value={email} type="email" autocomplete="email" required />
          </label>
          <button type="submit">send sign-in link</button>
        </form>
      </section>
    {:else if !profile}
      <section class="panel auth-panel">
        <h2>Complete onboarding</h2>
        <form on:submit|preventDefault={completeOnboarding}>
          <label>
            invite code
            <input bind:value={inviteCode} autocomplete="one-time-code" required />
          </label>
          <label>
            display name
            <input bind:value={displayName} required />
          </label>
          <label>
            profile slug
            <input bind:value={slug} pattern={slugPattern} required />
          </label>
          <label class="check-row">
            <input bind:checked={isPublic} type="checkbox" />
            public profile
          </label>
          <button type="submit">finish onboarding</button>
        </form>
      </section>
    {:else}
      <section class="panel">
        <div class="account-row">
          <div>
            <h2>{profile.display_name}</h2>
            <p class="muted">@{profile.slug}</p>
            {#if profile.is_public}
              <p><a href={publicUrl}>{publicUrl}</a></p>
            {/if}
          </div>
          <div class="actions">
            <button type="button" on:click={togglePublic}>
              {profile.is_public ? 'make private' : 'make public'}
            </button>
            <button type="button" on:click={signOut}>sign out</button>
          </div>
        </div>
      </section>

      <section class="panel section-gap">
        <div class="account-row">
          <div>
            <h2>Spotify</h2>
            {#if connection}
              <p class="muted">
                connected as {connection.spotify_display_name ?? connection.spotify_user_id ?? 'Spotify user'}
              </p>
              {#if connection.last_error}
                <p class="error">{connection.last_error}</p>
              {/if}
            {:else}
              <p class="muted">not connected</p>
            {/if}
          </div>
          <div class="actions">
            {#if connection}
              <button type="button" on:click={toggleSync}>
                {connection.sync_enabled ? 'pause sync' : 'resume sync'}
              </button>
            {/if}
            <button type="button" on:click={connectSpotify}>connect spotify</button>
          </div>
        </div>
      </section>

      {#if !overview}
        <section class="panel section-gap">
          <h2>No stats yet</h2>
          <p class="muted">Connect Spotify, then run the sync workflow or wait for the next scheduled sync.</p>
        </section>
      {:else}
        <div class="status-row section-gap">
          <DataQualityBadge quality={1} gapRisk={overview.sync.gap_risk} />
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
            <h2>Top artists this week</h2>
            <span class="muted">{metricLabel(artistMetric)}</span>
          </div>
          <RankingTable rows={overview.this_week.top_artists} entityType="artist" metric={artistMetric} />
        </section>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .auth-panel {
    max-width: 460px;
  }

  form,
  .actions {
    display: grid;
    gap: 10px;
  }

  label {
    display: grid;
    gap: 4px;
  }

  input {
    max-width: 360px;
  }

  .account-row,
  .status-row,
  .section-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .actions {
    justify-items: end;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .check-row input {
    width: auto;
  }

  .section-gap {
    margin-top: 16px;
  }

  .notice {
    margin-bottom: 16px;
    color: var(--muted);
  }
</style>
