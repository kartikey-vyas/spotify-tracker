<script lang="ts">
  import { dev } from '$app/environment';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import {
    formatDateTime,
    gapReasonLabel,
    gapWindowLabel,
    type SyncDiagnosticsRow
  } from '$lib/adminDiagnostics';
  import {
    getAdminSyncDiagnostics,
    getPublicSyncDiagnostics,
    isCurrentUserAdmin
  } from '$lib/queries/admin';
  import { publicSupabaseConfigured, supabase } from '$lib/supabase';

  let loading = true;
  let isAdmin = false;
  let rows: SyncDiagnosticsRow[] = [];
  let error = '';
  let message = '';

  $: gapRows = rows.filter((row) => row.gap_risk);
  $: continuousRows = rows.filter((row) => !row.gap_risk);

  onMount(async () => {
    await loadDiagnostics();
  });

  async function loadDiagnostics(): Promise<void> {
    loading = true;
    error = '';
    message = '';

    try {
      isAdmin = await isCurrentUserAdmin();
      if (!isAdmin && !dev) {
        rows = [];
        return;
      }

      rows = isAdmin && supabase ? await getAdminSyncDiagnostics() : await getPublicSyncDiagnostics();
      if (dev && !supabase) {
        message = 'Supabase is not configured, so diagnostics cannot load.';
      } else if (dev && !isAdmin) {
        message = 'Local public preview: sign in as an admin to see private sync rows.';
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  }
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">admin</span>
    <h1>Sync diagnostics</h1>
    <p class="lede">Gap-risk details stay here so the public pages only show listener-facing stats.</p>
  </div>

  {#if !publicSupabaseConfigured}
    <section class="panel">
      <h2>Supabase is not configured</h2>
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.</p>
    </section>
  {:else if loading}
    <section class="panel"><p class="muted">Loading diagnostics...</p></section>
  {:else if !isAdmin && !dev}
    <section class="panel auth-panel">
      <h2>Admin sign-in required</h2>
      <p class="muted">Sign in from the app page with an account listed in admin_users.</p>
      <a href="{base}/app/">go to login</a>
    </section>
  {:else}
    {#if message}<p class="notice">{message}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}

    <section class="grid cols-3 section-gap">
      <article class="panel metric">
        <span class="muted">Flagged profiles</span>
        <strong>{gapRows.length.toLocaleString()}</strong>
      </article>
      <article class="panel metric">
        <span class="muted">Continuous profiles</span>
        <strong>{continuousRows.length.toLocaleString()}</strong>
      </article>
      <article class="panel metric">
        <span class="muted">Access mode</span>
        <strong>{isAdmin ? 'admin' : 'local preview'}</strong>
      </article>
    </section>

    <section class="panel section-gap">
      <div class="section-heading">
        <h2>Gap risk</h2>
        <button type="button" on:click={loadDiagnostics}>refresh</button>
      </div>

      {#if gapRows.length === 0}
        <p class="muted">No profiles have a stored gap-risk flag.</p>
      {:else}
        <div class="diagnostic-list">
          {#each gapRows as row}
            <article class="diagnostic-item">
              <div class="diagnostic-head">
                <h3>{row.display_name}</h3>
                <span class="status warn">gap-risk</span>
              </div>
              <p>{gapWindowLabel(row)}</p>
              <dl>
                <div>
                  <dt>Reason</dt>
                  <dd>{gapReasonLabel(row)}</dd>
                </div>
                <div>
                  <dt>Last API sync</dt>
                  <dd>{formatDateTime(row.recently_played_last_success_at)}</dd>
                </div>
                <div>
                  <dt>Exact export through</dt>
                  <dd>{formatDateTime(row.latest_exact_export_event_at)}</dd>
                </div>
                <div>
                  <dt>API-only starts</dt>
                  <dd>{formatDateTime(row.api_only_period_start)}</dd>
                </div>
                {#if row.recently_played_last_error}
                  <div>
                    <dt>Last error</dt>
                    <dd>{row.recently_played_last_error}</dd>
                  </div>
                {/if}
              </dl>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="panel section-gap">
      <h2>All sync states</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Status</th>
              <th>Last API sync</th>
              <th>Exact export through</th>
              <th>API-only starts</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row}
              <tr>
                <td>{row.display_name}</td>
                <td>{row.gap_risk ? 'gap-risk' : 'continuous'}</td>
                <td>{formatDateTime(row.recently_played_last_success_at)}</td>
                <td>{formatDateTime(row.latest_exact_export_event_at)}</td>
                <td>{formatDateTime(row.api_only_period_start)}</td>
                <td>{formatDateTime(row.updated_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</section>

<style>
  .section-gap {
    margin-top: 12px;
  }

  .section-heading,
  .diagnostic-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .diagnostic-list {
    display: grid;
    gap: 12px;
    margin-top: 12px;
  }

  .diagnostic-item {
    display: grid;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  .diagnostic-item:first-child {
    padding-top: 0;
    border-top: 0;
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

  .status.warn {
    color: var(--amber);
  }

  @media (max-width: 800px) {
    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
