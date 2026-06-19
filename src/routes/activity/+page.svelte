<script lang="ts">
  import { onMount } from 'svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import { qualityLabel, sourceLabel } from '$lib/metrics';
  import { getRecentActivity } from '$lib/queries/activity';
  import type { ActivityRow } from '$lib/types';

  let rows: ActivityRow[] = [];
  let loading = true;
  let error = '';

  onMount(async () => {
    try {
      rows = await getRecentActivity(100);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  });

  function duration(row: ActivityRow): string {
    const ms = row.ms_played ?? row.inferred_ms_played;
    if (ms === null || ms === undefined) return 'unknown';
    return `${Math.round(ms / 1000)}s`;
  }
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Recent activity</span>
    <h1>Latest synced plays</h1>
    <p class="lede">A safe public subset refreshed by import and sync jobs.</p>
  </div>

  {#if loading}
    <section class="panel"><p class="muted">Loading activity...</p></section>
  {:else if error}
    <section class="panel"><p class="error">{error}</p></section>
  {:else}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Track</th>
              <th>Artist</th>
              <th>Album</th>
              <th>Source</th>
              <th>Duration</th>
              <th>Quality</th>
              <th>Skipped</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row}
              <tr>
                <td>{new Date(row.played_at).toLocaleString()}</td>
                <td>{row.track_name ?? 'Unknown track'}</td>
                <td>{row.artist_name ?? 'Unknown artist'}</td>
                <td>{row.album_name ?? 'Unknown album'}</td>
                <td>{sourceLabel(row.source)}</td>
                <td>{duration(row)}</td>
                <td title={qualityLabel(row.data_quality)}>
                  <DataQualityBadge quality={row.data_quality} />
                </td>
                <td>{row.skipped === null ? 'unknown' : row.skipped ? 'yes' : 'no'}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="8" class="muted">No recent activity has been published yet.</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</section>
