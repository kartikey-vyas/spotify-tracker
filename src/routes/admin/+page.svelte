<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import {
    catalogTotalsLabel,
    classifySystemHealth,
    classifyUserHealth,
    coverageLabel,
    cronFreshnessLabel,
    formatCount,
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
  import { getAdminDashboard, isCurrentUserAdmin } from '$lib/queries/admin';
  import { publicSupabaseConfigured } from '$lib/supabase';

  let loading = true;
  let isAdmin = false;
  let dashboard: AdminDashboard | null = null;
  let error = '';

  $: system = dashboard?.system ?? null;
  $: users = dashboard?.users ?? [];
  $: invites = dashboard?.invites ?? [];
  $: systemStatus = system ? classifySystemHealth(system) : 'paused';

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
      <p class="lede">Read-only operational status for sync coverage, invites, and catalog freshness.</p>
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
    <section class="panel"><p class="muted">Loading admin health...</p></section>
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
        <span class="muted">Pending invites</span>
        <strong>{formatCount(system.pending_invite_count)}</strong>
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

    <section class="grid cols-2 section-gap">
      <section class="panel">
        <div class="section-heading">
          <h2>Invites</h2>
          <span class="muted">{formatCount(system.total_invite_count)} total</span>
        </div>
        <div class="table-wrap compact-table">
          <table>
            <thead>
              <tr>
                <th>Invite</th>
                <th>Status</th>
                <th>Uses</th>
                <th>Expiry</th>
                <th>Accepted email</th>
                <th>Accepted</th>
              </tr>
            </thead>
            <tbody>
              {#each invites as invite}
                <tr>
                  <td>{invite.label ?? 'unlabeled'}</td>
                  <td><span class={statusClass(invite.status)}>{invite.status}</span></td>
                  <td>{formatCount(invite.use_count)} / {formatCount(invite.max_uses)}</td>
                  <td>{formatDateTime(invite.expires_at)}</td>
                  <td>{invite.accepted_email ?? 'n/a'}</td>
                  <td>{formatDateTime(invite.accepted_at)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel catalog-panel">
        <h2>Catalog/Data quality</h2>
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
    </section>
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
    margin-bottom: 10px;
  }

  .health-strip {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
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
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }

  .status.healthy,
  .status.accepted {
    color: var(--text);
  }

  .status.warning,
  .status.pending,
  .status.expired {
    color: var(--amber);
  }

  .status.critical,
  .status.exhausted {
    color: var(--red);
  }

  .status.paused {
    color: var(--muted);
  }

  .catalog-panel {
    display: grid;
    align-content: start;
    gap: 10px;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    margin: 0;
  }

  dt {
    color: var(--muted);
    font-size: 0.86rem;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .metadata-error {
    overflow-wrap: anywhere;
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
