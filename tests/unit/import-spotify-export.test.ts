import { describe, expect, it } from 'vitest';
import {
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

