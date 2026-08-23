<script lang="ts">
  import { base } from '$app/paths';
  import { dev } from '$app/environment';
  import { onMount } from 'svelte';
  import {
    catalogTotalsLabel,
    classifySystemHealth,
    classifyUserHealth,
    coverageLabel,
    cronFreshnessLabel,
    capResetAt,
    enrichedInWindow,
    enrichmentProgress,
    enrichmentProgressLabel,
    formatCount,
    formatDuration,
    isCapPending,
    projectedDaysRemaining,
    runOutcomeLabel,
    runStatus,
    formatDateTime,
    gapDiagnosticLabel,
    latestPlayLabel,
    overviewFreshnessLabel,
    statusClass,
    syncFreshnessLabel,
    userErrorLabel,
    visibilityLabel,
    type AdminDashboard
  } from '$lib/adminHealth';
  import SpotifyLoader from '$lib/components/SpotifyLoader.svelte';
  import { getAdminDashboard, isCurrentUserAdmin } from '$lib/queries/admin';
  import { publicSupabaseConfigured } from '$lib/supabase';

  let loading = true;
  let isAdmin = false;
  let dashboard: AdminDashboard | null = null;
  let error = '';

  $: system = dashboard?.system ?? null;
  $: users = dashboard?.users ?? [];
  $: systemStatus = system ? classifySystemHealth(system) : 'paused';
  $: enrichment = enrichmentProgress(system ?? { tracks_enriched: 0, tracks_unenriched: 0 });
  $: enrichmentRuns = dashboard?.enrichmentRuns ?? [];
  $: enrichedLast24h = enrichedInWindow(enrichmentRuns, 24);
  $: projectedDays = projectedDaysRemaining(enrichment.remaining, enrichedLast24h);
  $: capResets = capResetAt(enrichmentRuns);
  $: capPending = isCapPending(enrichmentRuns);

  onMount(async () => {
    await loadDashboard();
  });

  async function loadDashboard(): Promise<void> {
    loading = true;
    error = '';

    try {
      isAdmin = await isCurrentUserAdmin();
      dashboard = isAdmin ? await getAdminDashboard() : null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      dashboard = null;
    } finally {
      loading = false;
    }
  }
</script>

<section class="page">
  <div class="page-header admin-header">
    <div>
      <span class="eyebrow">admin</span>
      <h1>Data health</h1>
      <p class="lede">Read-only operational status for sync coverage and catalog freshness.</p>
    </div>
    {#if isAdmin}
      <button type="button" on:click={loadDashboard}>refresh</button>
    {/if}
  </div>

  {#if !publicSupabaseConfigured}
    <section class="panel">
      <h2>Supabase is not configured</h2>
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.</p>
    </section>
  {:else if loading}
    <section class="panel panel-loading"><SpotifyLoader label="Loading admin health..." /></section>
  {:else if !isAdmin}
    <section class="panel auth-panel">
      <h2>Admin sign-in required</h2>
      <p class="muted">Sign in from the app page with an account listed in admin_users.</p>
      <a href="{base}/app/">go to login</a>
    </section>
  {:else if error}
    <section class="panel">
      <h2>Unable to load admin health</h2>
      <p class="error">{error}</p>
    </section>
  {:else if !dashboard || !system}
    <section class="panel">
      <h2>No admin rows returned</h2>
      <p class="muted">Confirm this account is present in admin_users.</p>
    </section>
  {:else}
    <section class="health-strip section-gap">
      <article class="panel metric">
        <span class="muted">Overall</span>
        <strong class={statusClass(systemStatus)}>{systemStatus}</strong>
      </article>
      <article class="panel metric">
        <span class="muted">Last cron run</span>
        <strong>{cronFreshnessLabel(system)}</strong>
      </article>
      <article class="panel metric">
        <span class="muted">Stale sync users</span>
        <strong>{formatCount(system.stale_sync_user_count)}</strong>
      </article>
      <article class="panel metric">
        <span class="muted">Sync errors</span>
        <strong>{formatCount(system.sync_error_user_count)}</strong>
      </article>
      <article class="panel metric">
        <span class="muted">Catalog</span>
        <strong>{catalogTotalsLabel(system)}</strong>
      </article>
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Users</h2>
        <span class="muted">{formatCount(users.length)} profiles</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Profile</th>
              <th>Visibility</th>
              <th>Spotify</th>
              <th>Sync</th>
              <th>Last sync</th>
              <th>Latest play</th>
              <th>Coverage</th>
              <th>Overview</th>
            </tr>
          </thead>
          <tbody>
            {#each users as user}
              {@const health = classifyUserHealth(user)}
              {@const errorLabel = userErrorLabel(user)}
              <tr>
                <td><span class={statusClass(health)}>{health}</span></td>
                <td>
                  <strong>{user.display_name}</strong>
                  <span class="cell-note">/{user.slug}</span>
                </td>
                <td>{visibilityLabel(user)}</td>
                <td>
                  {user.spotify_connected ? 'connected' : 'not connected'}
                  {#if user.spotify_display_name}
                    <span class="cell-note">{user.spotify_display_name}</span>
                  {/if}
                </td>
                <td>
                  {user.sync_enabled ? 'enabled' : 'paused'}
                  <span class="cell-note">gap: {gapDiagnosticLabel(user)}</span>
                  {#if errorLabel}
                    <span class="cell-note error">{errorLabel}</span>
                  {/if}
                </td>
                <td title={formatDateTime(user.recently_played_last_success_at)}>
                  {syncFreshnessLabel(user)}
                </td>
                <td title={formatDateTime(user.latest_stored_event_at)}>{latestPlayLabel(user)}</td>
                <td>
                  {coverageLabel(user)}
                  <span class="cell-note">exact through {formatDateTime(user.latest_exact_export_event_at)}</span>
                  <span class="cell-note">API from {formatDateTime(user.api_only_period_start)}</span>
                </td>
                <td title={formatDateTime(user.overview_generated_at)}>
                  {overviewFreshnessLabel(user)}
                  <span class="cell-note">rollup {formatDateTime(user.latest_rollup_updated_at)}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel catalog-panel section-gap">
      <h2>Catalog/Data quality</h2>
      <div class="enrichment">
        <div class="enrichment-head">
          <span class="enrichment-title">Metadata enrichment</span>
          <strong>{enrichmentProgressLabel(system)}</strong>
        </div>
        <div
          class="meter"
          role="progressbar"
          aria-label="Metadata enrichment progress"
          aria-valuemin="0"
          aria-valuemax={enrichment.total}
          aria-valuenow={enrichment.enriched}
        >
          <span class="meter-fill" style="width: {enrichment.percent}%"></span>
        </div>
        <p class="muted enrichment-note">
          {formatCount(enrichment.remaining)} left · {formatCount(enrichedLast24h)} in the last 24h ·
          {projectedDays === null ? 'no recent throughput' : `~${Math.ceil(projectedDays)}d at that rate`}
        </p>
        {#if capPending}
          <p class="muted enrichment-note">
            Spotify cap lifts {formatDateTime(capResets!.toISOString())}
          </p>
        {/if}
      </div>
      <dl>
        <div>
          <dt>Artists</dt>
          <dd>{formatCount(system.artist_count)}</dd>
        </div>
        <div>
          <dt>Albums</dt>
          <dd>{formatCount(system.album_count)}</dd>
        </div>
        <div>
          <dt>Tracks</dt>
          <dd>{formatCount(system.track_count)}</dd>
        </div>
        <div>
          <dt>Tracks missing duration</dt>
          <dd>{formatCount(system.tracks_missing_duration)}</dd>
        </div>
        <div>
          <dt>Albums missing image</dt>
          <dd>{formatCount(system.albums_missing_image)}</dd>
        </div>
        <div>
          <dt>Stale/unrefreshed artists</dt>
          <dd>{formatCount(system.artists_stale_or_unrefreshed)}</dd>
        </div>
        <div>
          <dt>Metadata last success</dt>
          <dd>{formatDateTime(system.metadata_last_success_at)}</dd>
        </div>
        <div>
          <dt>Metadata last error</dt>
          <dd>{formatDateTime(system.metadata_last_error_at)}</dd>
        </div>
      </dl>
      {#if system.metadata_last_error}
        <p class="error metadata-error">{system.metadata_last_error}</p>
      {/if}
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Enrichment runs</h2>
        <span class="muted">{formatCount(enrichmentRuns.length)} most recent</span>
      </div>

      {#if enrichmentRuns.length === 0}
        <p class="muted">
          No runs recorded yet. The scheduled workflow writes one row per attempt.
        </p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Started</th>
                <th>Trigger</th>
                <th>Batch</th>
                <th>Outcome</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {#each enrichmentRuns as run}
                {@const status = runStatus(run)}
                <tr>
                  <td><span class={statusClass(status)}>{status}</span></td>
                  <td>{formatDateTime(run.started_at)}</td>
                  <td>{run.trigger}</td>
                  <td>
                    {run.requested_limit === null ? 'all' : formatCount(run.requested_limit)}
                    <span class="cell-note">×{run.concurrency}</span>
                  </td>
                  <td>
                    {runOutcomeLabel(run)}
                    {#if run.error}
                      <span class="cell-note error">{run.error}</span>
                    {/if}
                  </td>
                  <td>{formatDuration(run.duration_seconds)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    {#if dev}
      <section class="panel section-gap">
        <h2>Dev tools</h2>
        <p class="muted">Development-only previews. These are stripped from production builds.</p>
        <ul class="dev-links">
          <li><a href="{base}/sprites/">Sprite explorer</a></li>
          <li><a href="{base}/sprites/edit/">Sprite editor</a></li>
          <li><a href="{base}/loader/">SpotifyLoader preview</a></li>
        </ul>
      </section>
    {/if}
  {/if}
</section>

<style>
  .admin-header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
  }

  .section-gap {
    margin-top: 12px;
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: var(--space-3);
  }

  .health-strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
  }

  .metric strong {
    display: block;
    overflow-wrap: anywhere;
  }

  .cell-note {
    display: block;
    margin-top: 2px;
    color: var(--muted);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .status.healthy {
    color: var(--text);
  }

  .status.warning {
    color: var(--amber);
  }

  .status.critical {
    color: var(--red);
  }

  .status.paused {
    color: var(--muted);
  }

  .catalog-panel {
    display: grid;
    align-content: start;
    gap: var(--space-3);
  }

  .enrichment {
    display: grid;
    gap: var(--space-2);
  }

  .enrichment-head {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    justify-content: space-between;
    align-items: baseline;
  }

  .enrichment-title {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .meter {
    background: var(--accent-soft);
    border: 1px solid var(--line);
    height: 10px;
    overflow: hidden;
  }

  .meter-fill {
    background: var(--accent);
    display: block;
    height: 100%;
  }

  .enrichment-note {
    font-size: var(--text-sm);
    margin: 0;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2) var(--space-3);
    margin: 0;
  }

  dt {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .metadata-error {
    overflow-wrap: anywhere;
  }

  .dev-links {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
  }

  @media (max-width: 1100px) {
    .health-strip {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 800px) {
    .admin-header {
      align-items: stretch;
      flex-direction: column;
    }

    .health-strip,
    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
