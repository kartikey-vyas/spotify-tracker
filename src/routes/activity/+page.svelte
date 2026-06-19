<script lang="ts">
  import { onMount } from 'svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import { qualityLabel, sourceLabel } from '$lib/metrics';
  import { getRecentActivity } from '$lib/queries/activity';
  import type { ActivityRow } from '$lib/types';

  let rows: ActivityRow[] = [];
  let loading = true;
  let error = '';
  let failed: Record<number, boolean> = {};

  function markFailed(id: number): void {
    failed = { ...failed, [id]: true };
  }

  onMount(async () => {
    try {
      rows = await getRecentActivity(100);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  });

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
              <th class="art-col"><span class="sr-only">Art</span></th>
              <th>Time</th>
              <th>Track</th>
              <th>Artist</th>
              <th>Album</th>
              <th>Source</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row}
              <tr>
                <td class="art-col">
                  {#if row.album_image_url && !failed[row.id]}
                    <img
                      class="thumb"
                      src={row.album_image_url}
                      alt={row.album_name ?? 'Album art'}
                      loading="lazy"
                      on:error={() => markFailed(row.id)}
                    />
                  {:else}
                    <span class="thumb placeholder" aria-hidden="true">♪</span>
                  {/if}
                </td>
                <td>{new Date(row.played_at).toLocaleString()}</td>
                <td>{row.track_name ?? 'Unknown track'}</td>
                <td>{row.artist_name ?? 'Unknown artist'}</td>
                <td>{row.album_name ?? 'Unknown album'}</td>
                <td>{sourceLabel(row.source)}</td>
                <td title={qualityLabel(row.data_quality)}>
                  <DataQualityBadge quality={row.data_quality} />
                </td>
              </tr>
            {:else}
              <tr>
                <td colspan="7" class="muted">No recent activity has been published yet.</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</section>

<style>
  .art-col {
    width: 40px;
    padding-right: 0;
  }

  .thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    object-fit: cover;
    border: 1px solid var(--line);
    background: var(--surface-2);
  }

  .placeholder {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
</style>
