<script lang="ts">
  import { onMount } from 'svelte';
  import DataQualityBadge from '$lib/components/DataQualityBadge.svelte';
  import PixelPromenade from '$lib/components/PixelPromenade.svelte';
  import RecordMark from '$lib/components/RecordMark.svelte';
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

  /* Day, month and time of day — no year and no seconds. The rows are the most
     recent hundred plays, so the year is never in question and the second a
     track started is not information anyone reads off a phone. */
  const shortStamp = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

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

  <PixelPromenade station="activity-arrivals" marker="centre" />

  {#if loading}
    <section class="panel panel-loading"><RecordMark label="Loading activity..." /></section>
  {:else if error}
    <section class="panel"><p class="error">{error}</p></section>
  {:else}
    <section class="activity-table">
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
                <!-- Two stamps, one shown at a time by CSS: the full locale
                     string cannot fit on the stacked row's metadata line beside
                     the source and the quality badge at phone widths. -->
                <td class="time-col">
                  <span class="stamp-full">{new Date(row.played_at).toLocaleString()}</span>
                  <span class="stamp-short">{shortStamp(row.played_at)}</span>
                </td>
                <td class="track-col">{row.track_name ?? 'Unknown track'}</td>
                <td class="artist-col">{row.artist_name ?? 'Unknown artist'}</td>
                <td class="album-col">{row.album_name ?? 'Unknown album'}</td>
                <td class="source-col">{sourceLabel(row.source)}</td>
                <td class="quality-col" title={qualityLabel(row.data_quality)}>
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
  /* Ledger treatment: the table sits directly on the page background — the
     header row's hairline and the row separators are the only chrome. */
  .activity-table {
    margin-top: var(--space-6);
  }

  :global(.pixel-promenade) + .panel {
    margin-top: var(--space-6);
  }

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
    font-size: var(--text-sm);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  /* Seven columns are unreadable on a phone, so below 800px the same table
     markup re-flows into a stacked row: art in a left gutter, then track /
     artist — album / time · source · quality. The element stays a real table,
     which is why every rule here is confined to the media query. */
  .stamp-short {
    display: none;
  }

  @media (max-width: 800px) {
    table,
    tbody {
      display: block;
    }

    /* Stacked cells lose their column headings, so the header row is hidden
       from sight rather than from assistive tech — same treatment as .sr-only,
       which cannot be reused here because thead carries no class. */
    thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }

    tbody tr {
      /* The art sits in the row's padding gutter: it has to stand beside all
         three lines, and a wrapping flex line can only ever hold one. */
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: var(--space-1);
      row-gap: var(--space-0-5);
      min-height: calc(40px + var(--space-4));
      padding: var(--space-2) 0 var(--space-2) calc(40px + var(--space-3));
      border-bottom: 1px solid var(--line);
    }

    /* Hiding the header row also hides the hairline that opens the ledger. */
    tbody tr:first-child {
      border-top: 1px solid var(--line);
    }

    tbody td {
      min-width: 0;
      padding: 0;
      border-bottom: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    tbody .art-col {
      position: absolute;
      top: var(--space-2);
      left: 0;
      width: 40px;
      overflow: visible;
    }

    .thumb {
      width: 40px;
      height: 40px;
    }

    .track-col {
      order: 1;
      flex: 0 0 100%;
    }

    .artist-col,
    .album-col {
      order: 2;
      font-size: var(--text-sm);
    }

    /* Flex breaks lines on hypothetical sizes, before any growing or
       shrinking, so the split into three lines is a width budget. Two rules
       govern it, and they pull against each other:

         artist + album + gap <= 100%   or line two splits and the em dash
                                        starts a line of its own
         album  + time  + gap  > 100%   or the time rides up onto line two
                                        whenever the artist is short

       38 / 60 / 40 satisfies both with the column gap accounted for. The album
       still grows, so its em dash sits hard against the artist name however
       short that name is. */
    .artist-col {
      max-width: 38%;
    }

    .album-col {
      flex: 1 1 60%;
    }

    .time-col,
    .source-col,
    .quality-col {
      order: 3;
      color: var(--muted);
      font-size: var(--text-xs);
    }

    /* 34% is the largest basis that still leaves the source and the whole
       quality badge room on one line: measured at 390px the badge is 147px and
       the source 36px against 306px of row, so the stamp gets 104px of budget
       and grows into whatever is left over. Growing rather than reserving is
       what makes line three read as justified — stamp left, provenance right —
       instead of looking like a layout that ran out of text. */
    .time-col {
      flex: 1 1 34%;
    }

    /* The badge has to stay whole; the time absorbs a tight line instead. */
    .source-col,
    .quality-col {
      flex: 0 0 auto;
    }

    .stamp-full {
      display: none;
    }

    .stamp-short {
      display: inline;
    }

    .album-col::before {
      content: '— ';
    }

    /* The source opens the right-hand group once the time has grown away from
       it, so unlike on one continuous line it needs no leading separator —
       that dot would hang in the gap. */
    .quality-col::before {
      content: '· ';
    }

    .album-col:empty::before,
    .quality-col:empty::before {
      content: none;
    }

    /* The empty-state row spans every column and has no art beside it. */
    td[colspan] {
      flex: 1 1 100%;
      white-space: normal;
    }
  }
</style>
