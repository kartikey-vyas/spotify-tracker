<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { Session, SupabaseClient } from '@supabase/supabase-js';
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
  import { authView } from '$lib/auth/view';
  import { friendlyAuthError, friendlyLinkError } from '$lib/auth/errors';

  let session: Session | null = null;
  let profile: Profile | null = null;
  let connection: SpotifyConnectionStatus | null = null;
  let overview: OverviewPayload | null = null;
  let loading = true;
  let message = '';
  let error = '';
  let recovery = false;
  let resolvingUser = false;

  type AuthAction = 'login' | 'reset' | 'setup' | 'recover' | 'change';
  let authSubmitting = false;
  let authAction: AuthAction | null = null;

  let email = '';
  let password = '';
  let confirmPassword = '';
  let slug = '';
  let displayName = '';
  let isPublic = false;
  const slugPattern = '[a-z0-9][a-z0-9-]{1,38}[a-z0-9]';
  const MIN_PASSWORD = 8;

  let showChangePassword = false;
  let newPassword = '';
  let newPasswordConfirm = '';

  $: view = authView({ hasSession: Boolean(session), hasProfile: Boolean(profile), recovery });
  $: artistMetric = overview ? bestAvailableMetric(overview.this_week.top_artists, 'plays') : 'plays';
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

    const linkError = friendlyLinkError(hashParams.get('error'), hashParams.get('error_description'));

    supabase.auth.getSession().then(async ({ data }) => {
      session = data.session;
      if (linkError && !session) error = linkError;
      await loadUserData();
      loading = false;
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      session = nextSession;
      if (event === 'PASSWORD_RECOVERY') {
        recovery = true;
        error = '';
        message = 'Set a new password below.';
      }
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
      resolvingUser = false;
      return;
    }

    resolvingUser = true;
    try {
      profile = await getCurrentProfile(session.user.id);
      connection = profile ? await getSpotifyConnectionStatus() : null;
      overview = profile ? await getUserOverview(session.user.id) : null;
    } finally {
      resolvingUser = false;
    }
  }

  // Owns the in-flight guard and reset; the callback runs the actual auth call
  // and returns an error message (or null on success) after setting `message`.
  async function runAuth(
    action: AuthAction,
    run: (client: SupabaseClient, trimmedEmail: string) => Promise<string | null>
  ): Promise<void> {
    if (!supabase) return;
    if (authSubmitting) return;

    error = '';
    authSubmitting = true;
    authAction = action;

    try {
      const authError = await run(supabase, email.trim());
      if (authError) {
        error = authError;
        message = '';
      }
    } finally {
      authSubmitting = false;
      authAction = null;
    }
  }

  function passwordProblem(pw: string, confirm: string): string | null {
    if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
    if (pw !== confirm) return 'Passwords do not match.';
    return null;
  }

  function submitLogin(): Promise<void> {
    return runAuth('login', async (client, trimmedEmail) => {
      message = '';
      const { data, error: authError } = await client.auth.signInWithPassword({
        email: trimmedEmail,
        password
      });
      if (authError) return friendlyAuthError(authError.message);

      session = data.session;
      await loadUserData();
      message = 'Signed in.';
      return null;
    });
  }

  function sendResetLink(): Promise<void> {
    return runAuth('reset', async (client, trimmedEmail) => {
      message = `Sending a reset link to ${trimmedEmail}...`;
      const { error: authError } = await client.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: appUrl()
      });
      if (authError) return friendlyAuthError(authError.message);

      message = `Password reset link sent to ${trimmedEmail}. Check your email.`;
      return null;
    });
  }

  function submitSetup(): Promise<void> {
    return runAuth('setup', async (client) => {
      const problem = passwordProblem(password, confirmPassword);
      if (problem) return problem;

      message = '';
      const { error: pwError } = await client.auth.updateUser({ password });
      if (pwError) return friendlyAuthError(pwError.message);

      const { data, error: invokeError } = await client.functions.invoke('complete-onboarding', {
        body: { slug, displayName, isPublic }
      });
      if (invokeError) return invokeError.message;

      profile = data.profile;
      password = '';
      confirmPassword = '';
      message = 'Account ready.';
      await loadUserData();
      return null;
    });
  }

  function submitRecovery(): Promise<void> {
    return runAuth('recover', async (client) => {
      const problem = passwordProblem(password, confirmPassword);
      if (problem) return problem;

      const { error: pwError } = await client.auth.updateUser({ password });
      if (pwError) return friendlyAuthError(pwError.message);

      recovery = false;
      password = '';
      confirmPassword = '';
      message = 'Password updated.';
      await loadUserData();
      return null;
    });
  }

  function submitChangePassword(): Promise<void> {
    return runAuth('change', async (client) => {
      const problem = passwordProblem(newPassword, newPasswordConfirm);
      if (problem) return problem;

      const { error: pwError } = await client.auth.updateUser({ password: newPassword });
      if (pwError) return friendlyAuthError(pwError.message);

      newPassword = '';
      newPasswordConfirm = '';
      showChangePassword = false;
      message = 'Password updated.';
      return null;
    });
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
    recovery = false;
    password = '';
    confirmPassword = '';
    showChangePassword = false;
    newPassword = '';
    newPasswordConfirm = '';
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

    {#if view === 'recovery'}
      <section class="panel auth-panel">
        <h2>Set a new password</h2>
        <form on:submit|preventDefault={submitRecovery}>
          <label>
            new password
            <input bind:value={password} type="password" autocomplete="new-password" disabled={authSubmitting} required />
          </label>
          <label>
            confirm password
            <input bind:value={confirmPassword} type="password" autocomplete="new-password" disabled={authSubmitting} required />
          </label>
          <button type="submit" disabled={authSubmitting}>
            {authSubmitting && authAction === 'recover' ? 'saving...' : 'save password'}
          </button>
        </form>
      </section>
    {:else if view === 'login'}
      <section class="panel auth-panel">
        <h2>Sign in</h2>
        <p class="muted">Invite-only access.</p>

        <form on:submit|preventDefault={submitLogin}>
          <label>
            email
            <input bind:value={email} type="email" autocomplete="email" disabled={authSubmitting} required />
          </label>
          <label>
            password
            <input
              bind:value={password}
              type="password"
              autocomplete="current-password"
              disabled={authSubmitting}
              required
            />
          </label>
          <button type="submit" disabled={authSubmitting}>
            {authSubmitting && authAction === 'login' ? 'signing in...' : 'sign in'}
          </button>
          <button
            type="button"
            class="link-button"
            disabled={authSubmitting || !email.trim()}
            on:click={sendResetLink}
          >
            {authSubmitting && authAction === 'reset' ? 'sending...' : 'forgot password?'}
          </button>
        </form>
      </section>
    {:else if resolvingUser && !profile}
      <section class="panel"><p class="muted">Loading...</p></section>
    {:else if view === 'setup'}
      <section class="panel auth-panel">
        <h2>Set up your account</h2>
        <p class="muted">Choose a password and your profile details.</p>
        <form on:submit|preventDefault={submitSetup}>
          <label>
            password
            <input bind:value={password} type="password" autocomplete="new-password" disabled={authSubmitting} required />
          </label>
          <label>
            confirm password
            <input bind:value={confirmPassword} type="password" autocomplete="new-password" disabled={authSubmitting} required />
          </label>
          <label>
            display name
            <input bind:value={displayName} disabled={authSubmitting} required />
          </label>
          <label>
            profile slug
            <input bind:value={slug} pattern={slugPattern} disabled={authSubmitting} required />
          </label>
          <label class="check-row">
            <input bind:checked={isPublic} type="checkbox" disabled={authSubmitting} />
            public profile
          </label>
          <button type="submit" disabled={authSubmitting}>
            {authSubmitting && authAction === 'setup' ? 'creating...' : 'create account'}
          </button>
        </form>
      </section>
    {:else if profile}
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
          <div><h2>Password</h2></div>
          <div class="actions">
            <button type="button" on:click={() => (showChangePassword = !showChangePassword)}>
              {showChangePassword ? 'cancel' : 'change password'}
            </button>
          </div>
        </div>
        {#if showChangePassword}
          <form class="change-password-form" on:submit|preventDefault={submitChangePassword}>
            <label>
              new password
              <input bind:value={newPassword} type="password" autocomplete="new-password" disabled={authSubmitting} required />
            </label>
            <label>
              confirm password
              <input bind:value={newPasswordConfirm} type="password" autocomplete="new-password" disabled={authSubmitting} required />
            </label>
            <button type="submit" disabled={authSubmitting}>
              {authSubmitting && authAction === 'change' ? 'saving...' : 'save password'}
            </button>
          </form>
        {/if}
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
    {/if}
  {/if}
</section>

<style>
  .auth-panel {
    max-width: 460px;
  }

  .link-button {
    justify-self: start;
    padding: 0;
    background: none;
    border: none;
    color: var(--muted);
    text-decoration: underline;
    cursor: pointer;
  }

  .link-button:disabled {
    cursor: default;
    opacity: 0.6;
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

  .change-password-form {
    margin-top: 12px;
  }

  .notice {
    margin-bottom: 16px;
    color: var(--muted);
  }
</style>
