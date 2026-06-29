import { describe, expect, it } from 'vitest';
import {
  assembleEvents,
  buildImportPlan,
  parseImportArgs,
  refreshImportedDates,
  sourceEventKey
} from '../../scripts/import-spotify-export.js';
import { sha256 } from '../../scripts/lib/hash.js';
import type { AdminClient } from '../../scripts/lib/supabase-admin.js';

function fakeSupabase() {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  return {
    rpcCalls,
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ error: null });
    }
  };
}

describe('Spotify export importer', () => {
  const userId = '123e4567-e89b-42d3-a456-426614174000';

  it('requires --user-id', () => {
    expect(() => parseImportArgs(['analysis/out/cleaned_2020.json'])).toThrow(/--user-id/);
    expect(() => parseImportArgs(['--user-id=', 'analysis/out/cleaned_2020.json'])).toThrow(/--user-id/);
  });

  it('parses user id and cleaned files', () => {
    expect(parseImportArgs([`--user-id=${userId}`, 'analysis/out/cleaned_2020.json'])).toEqual({
      targetUserId: userId,
      files: ['analysis/out/cleaned_2020.json']
    });
  });

  it('refreshes target user stats for affected dates', async () => {
    const sb = fakeSupabase();

    await refreshImportedDates(
      sb as unknown as AdminClient,
      userId,
      new Set(['2020-01-02', '2020-01-01', '2020-01-02'])
    );

    expect(sb.rpcCalls).toEqual([
      {
        name: 'refresh_user_public_stats',
        args: {
          p_user_id: userId,
          target_dates: ['2020-01-01', '2020-01-02']
        }
      }
    ]);
  });

  describe('buildImportPlan', () => {
    it('skips podcast and track-less rows, and counts them', () => {
      const plan = buildImportPlan([
        { ts: '2020-01-01T00:00:00Z', spotify_track_uri: 'spotify:track:a' },
        { ts: '2020-01-02T00:00:00Z', spotify_episode_uri: 'spotify:episode:x' },
        { ts: '2020-01-03T00:00:00Z', episode_show_name: 'Some Show' },
        { ts: '2020-01-04T00:00:00Z', spotify_track_uri: null }
      ]);

      expect(plan.rowsRead).toBe(4);
      expect(plan.skippedPodcastRows).toBe(2);
      expect(plan.skippedRowsWithoutTrackUri).toBe(1);
      expect(plan.pending).toHaveLength(1);
    });

    it('dedupes dimensions case-insensitively and keeps a track album from first occurrence', () => {
      const plan = buildImportPlan([
        {
          ts: '2020-01-01T00:00:00Z',
          spotify_track_uri: 'spotify:track:a',
          master_metadata_album_artist_name: 'Radiohead',
          master_metadata_album_album_name: 'OK Computer',
          master_metadata_track_name: 'Airbag'
        },
        {
          ts: '2020-01-02T00:00:00Z',
          spotify_track_uri: 'spotify:track:a',
          master_metadata_album_artist_name: 'radiohead',
          master_metadata_album_album_name: 'OK Computer (Remaster)',
          master_metadata_track_name: 'Airbag'
        }
      ]);

      expect([...plan.artistNames.keys()]).toEqual(['radiohead']);
      expect(plan.artistNames.get('radiohead')).toBe('Radiohead');
      expect(plan.tracks.get('spotify:track:a')).toEqual({ name: 'Airbag', albumKey: 'ok computer' });
      expect(plan.pending).toHaveLength(2);
    });

    it('falls back to Unknown names when metadata is missing', () => {
      const plan = buildImportPlan([
        { ts: '2020-01-01T00:00:00Z', spotify_track_uri: 'spotify:track:a' }
      ]);
      expect(plan.artistNames.get('unknown artist')).toBe('Unknown Artist');
      expect(plan.albumNames.get('unknown album')).toBe('Unknown Album');
      expect(plan.tracks.get('spotify:track:a')?.name).toBe('Unknown Track');
    });
  });

  describe('assembleEvents', () => {
    const ids = {
      artistIdByName: new Map([['radiohead', 10]]),
      albumIdByName: new Map([['ok computer', 20]]),
      trackIdByUri: new Map([['spotify:track:a', 30]])
    };

    it('maps fields, dedupes track_artists, and tracks affected dates + latest ms', () => {
      const plan = buildImportPlan([
        {
          ts: '2020-01-01T08:00:00Z',
          spotify_track_uri: 'spotify:track:a',
          master_metadata_album_artist_name: 'Radiohead',
          master_metadata_album_album_name: 'OK Computer',
          master_metadata_track_name: 'Airbag',
          ms_played: 1000,
          skipped: false,
          incognito_mode: true
        },
        {
          ts: '2020-01-02T08:00:00Z',
          spotify_track_uri: 'spotify:track:a',
          master_metadata_album_artist_name: 'Radiohead',
          master_metadata_album_album_name: 'OK Computer',
          master_metadata_track_name: 'Airbag'
        }
      ]);

      const { events, trackArtists, affectedDates, latestExactMs } = assembleEvents(
        plan.pending,
        userId,
        ids
      );

      expect(trackArtists).toEqual([{ track_id: 30, artist_id: 10, artist_order: 0 }]);
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        user_id: userId,
        source: 1,
        data_quality: 1,
        track_id: 30,
        primary_artist_id: 10,
        album_id: 20,
        ms_played: 1000,
        private_session: true,
        source_event_key: sourceEventKey(plan.pending[0]!.row)
      });
      expect(events[1]!.ms_played).toBe(0);
      expect(affectedDates.size).toBe(2);
      expect(latestExactMs).toBe(new Date('2020-01-02T08:00:00Z').getTime());
    });

    it('throws if an id is unresolved', () => {
      const plan = buildImportPlan([
        { ts: '2020-01-01T00:00:00Z', spotify_track_uri: 'spotify:track:missing' }
      ]);
      expect(() => assembleEvents(plan.pending, userId, ids)).toThrow(/Missing resolved id/);
    });
  });

  it('keeps source event hash field order unchanged', () => {
    const row = {
      ts: '2020-01-01T00:00:00Z',
      spotify_track_uri: 'spotify:track:abc',
      spotify_episode_uri: null,
      ms_played: 12345,
      platform: 'ios',
      reason_start: 'trackdone',
      reason_end: 'fwdbtn'
    };

    expect(sourceEventKey(row)).toBe(
      sha256([
        'export',
        row.ts,
        row.spotify_track_uri,
        row.spotify_episode_uri,
        row.ms_played,
        row.platform,
        row.reason_start,
        row.reason_end
      ])
    );
  });
});

