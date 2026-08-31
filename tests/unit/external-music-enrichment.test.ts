import { describe, expect, it, vi } from 'vitest';
import {
  classifyLastFmCapture,
  classifyMusicBrainzError,
  endpointDone,
  previousResult,
  shouldFallbackLastFmMbid,
  shouldOpenLastFmCircuit,
  shouldConsumeExternalRetryAttempt,
  shouldUseLastFmMbid,
  withEndpoint
} from '../../supabase/functions/_shared/external-music-enrichment.ts';
import type { LastFmCapture } from '../../supabase/functions/_shared/lastfm.ts';
import { MusicBrainzHttpError } from '../../supabase/functions/_shared/musicbrainz.ts';
import {
  normalizeIsrc as normalizeNodeIsrc,
  scoreMusicBrainzRecordings as scoreNodeRecordings
} from '../../scripts/lib/musicbrainz.js';
import {
  normalizeIsrc as normalizeEdgeIsrc,
  scoreMusicBrainzRecordings as scoreEdgeRecordings,
  type MusicBrainzRecording
} from '../../supabase/functions/_shared/musicbrainz.ts';
import {
  persistExternalMusicWrites,
  type ExternalMusicWorkItem
} from '../../supabase/functions/_shared/external-music-persistence.ts';
import {
  ProviderPacer,
  processExternalMusicItem
} from '../../supabase/functions/_shared/external-music-worker.ts';

function lastFmFailure(code: number | null, httpStatus: number | null): LastFmCapture {
  return {
    method: 'track.getInfo',
    params: { artist: 'Artist', track: 'Track' },
    fetched_at: '2026-08-27T00:00:00.000Z',
    http_status: httpStatus,
    ok: false,
    data: null,
    error: { code, message: 'provider said no' }
  };
}

describe('external music enrichment retry decisions', () => {
  it('treats successful and missing Last.fm entities as terminal', () => {
    expect(classifyLastFmCapture({ ...lastFmFailure(null, 200), ok: true, error: null })).toEqual({
      terminal: true,
      status: 'ok'
    });
    expect(classifyLastFmCapture(lastFmFailure(6, 200))).toEqual({
      terminal: true,
      status: 'not_found'
    });
  });

  it('backs off rate limits and key failures instead of completing the item', () => {
    expect(classifyLastFmCapture(lastFmFailure(29, 200))).toMatchObject({
      terminal: false,
      retryAfterSeconds: 900
    });
    expect(classifyLastFmCapture(lastFmFailure(10, 200))).toMatchObject({
      terminal: false,
      retryAfterSeconds: 86_400
    });
    expect(classifyLastFmCapture(lastFmFailure(null, null))).toMatchObject({
      terminal: false,
      retryAfterSeconds: 300
    });
  });

  it('uses artist/title for track tags while retaining MBID-first matching elsewhere', () => {
    const mbid = '11111111-1111-4111-8111-111111111111';
    expect(shouldUseLastFmMbid('track', 'tags', mbid)).toBe(false);
    expect(shouldUseLastFmMbid('track', 'info', mbid)).toBe(true);
    expect(shouldUseLastFmMbid('track', 'similar', mbid)).toBe(true);
    expect(shouldUseLastFmMbid('artist', 'tags', mbid)).toBe(false);
  });

  it('falls back from rejected MBIDs without opening the batch circuit', () => {
    const emptyHttp400 = lastFmFailure(null, 400);
    expect(classifyLastFmCapture(emptyHttp400)).toMatchObject({
      terminal: false,
      retryAfterSeconds: 3_600
    });
    expect(shouldFallbackLastFmMbid(emptyHttp400)).toBe(true);
    expect(shouldOpenLastFmCircuit(emptyHttp400)).toBe(false);
  });

  it('opens the batch circuit only for provider-wide failures', () => {
    expect(shouldOpenLastFmCircuit(lastFmFailure(29, 429))).toBe(true);
    expect(shouldOpenLastFmCircuit(lastFmFailure(8, 200))).toBe(true);
    expect(shouldOpenLastFmCircuit(lastFmFailure(null, 503))).toBe(true);
    expect(shouldOpenLastFmCircuit(lastFmFailure(null, null))).toBe(true);
    expect(shouldOpenLastFmCircuit(lastFmFailure(6, 400))).toBe(false);
  });

  it('distinguishes missing MusicBrainz matches from transient provider failures', () => {
    expect(classifyMusicBrainzError(new MusicBrainzHttpError('missing', 404, ''))).toMatchObject({
      terminal: true,
      status: 'no_match'
    });
    expect(classifyMusicBrainzError(new MusicBrainzHttpError('offline', 503, ''))).toMatchObject({
      terminal: false,
      retryAfterSeconds: 300
    });
  });

  it('spends retry budget only on item-specific failures', () => {
    expect(shouldConsumeExternalRetryAttempt(['circuit'])).toBe(false);
    expect(shouldConsumeExternalRetryAttempt(['circuit', 'circuit'])).toBe(false);
    expect(shouldConsumeExternalRetryAttempt(['provider'])).toBe(false);
    expect(shouldConsumeExternalRetryAttempt(['provider', 'circuit'])).toBe(false);
    expect(shouldConsumeExternalRetryAttempt(['request'])).toBe(true);
    expect(shouldConsumeExternalRetryAttempt(['circuit', 'request'])).toBe(true);
    expect(shouldConsumeExternalRetryAttempt(['provider', 'request'])).toBe(true);
  });

  it('preserves completed endpoints across retries', () => {
    const initial = previousResult({ endpoints: { musicbrainz: { status: 'ok', fetched_at: 'now' } } });
    const next = withEndpoint(initial, 'track.info', { status: 'not_found', fetched_at: 'later' });
    expect(endpointDone(next, 'musicbrainz')).toBe(true);
    expect(endpointDone(next, 'track.info')).toBe(true);
    expect(endpointDone(next, 'track.tags')).toBe(false);
  });

  it('does not charge an entity for a provider-wide MusicBrainz failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('temporarily unavailable', { status: 503 })
    );
    const circuit = { musicbrainz: null, lastfm: null };
    const item: ExternalMusicWorkItem = {
      queue_id: 1,
      worker_token: '11111111-1111-4111-8111-111111111111',
      attempt_count: 1,
      entity_type: 'track',
      entity_id: 11,
      entity_name: 'Track',
      last_result: {
        endpoints: {
          'track.info': { status: 'ok', fetched_at: '2026-08-27T00:00:00.000Z' },
          'track.tags': { status: 'ok', fetched_at: '2026-08-27T00:00:00.000Z' },
          'track.similar': { status: 'ok', fetched_at: '2026-08-27T00:00:00.000Z' }
        }
      },
      context_track_id: 11,
      context_track_name: 'Track',
      context_duration_ms: 180_000,
      context_isrc: 'GBAHT1600302',
      context_album_id: 22,
      context_album_name: 'Album',
      context_artists: [{ id: 33, name: 'Artist', artist_order: 0 }]
    };

    try {
      const outcome = await processExternalMusicItem(
        {} as never,
        item,
        'unused-lastfm-key',
        'musik-test/1.0',
        new ProviderPacer(0),
        new ProviderPacer(0),
        circuit
      );

      expect(outcome.succeeded).toBe(false);
      expect(outcome.consumeAttempt).toBe(false);
      expect(outcome.error).toContain('musicbrainz: MusicBrainz returned HTTP 503');
      expect(circuit.musicbrainz).toMatchObject({ terminal: false, retryAfterSeconds: 300 });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does not charge an entity for a provider-wide Last.fm failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 29, message: 'Rate limit exceeded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const circuit = { musicbrainz: null, lastfm: null };
    const item: ExternalMusicWorkItem = {
      queue_id: 2,
      worker_token: '11111111-1111-4111-8111-111111111111',
      attempt_count: 1,
      entity_type: 'artist',
      entity_id: 33,
      entity_name: 'Artist',
      last_result: {
        endpoints: {
          'artist.tags': { status: 'ok', fetched_at: '2026-08-27T00:00:00.000Z' }
        }
      },
      context_track_id: 11,
      context_track_name: 'Track',
      context_duration_ms: 180_000,
      context_isrc: 'GBAHT1600302',
      context_album_id: 22,
      context_album_name: 'Album',
      context_artists: [{ id: 33, name: 'Artist', artist_order: 0 }]
    };

    try {
      const outcome = await processExternalMusicItem(
        {} as never,
        item,
        'unused-lastfm-key',
        'musik-test/1.0',
        new ProviderPacer(0),
        new ProviderPacer(0),
        circuit
      );

      expect(outcome.succeeded).toBe(false);
      expect(outcome.consumeAttempt).toBe(false);
      expect(outcome.error).toContain('artist.info: Rate limit exceeded');
      expect(circuit.lastfm).toMatchObject({ terminal: false, retryAfterSeconds: 900 });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('Node and Edge MusicBrainz helper parity', () => {
  const recordings: MusicBrainzRecording[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Track (feat. Guest)',
      length: 180_200,
      'artist-credit': [{ artist: { id: '22222222-2222-4222-8222-222222222222', name: 'Artist' } }]
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Different Track',
      length: 240_000,
      'artist-credit': [{ artist: { name: 'Someone Else' } }]
    }
  ];

  it('normalizes ISRCs and scores candidates identically in both runtimes', () => {
    const input = { name: 'Track (feat. Guest)', durationMs: 180_000, artistNames: ['Artist'] };
    expect(normalizeEdgeIsrc('GB-AHT-16-00302')).toBe(normalizeNodeIsrc('GB-AHT-16-00302'));
    expect(scoreEdgeRecordings(input, recordings)).toEqual(scoreNodeRecordings(input, recordings));
  });
});

describe('external music persistence', () => {
  it('replaces provider evidence and refreshes the affected primary artist', async () => {
    const operations: Array<Record<string, unknown>> = [];
    class DeleteBuilder implements PromiseLike<{ error: null }> {
      private readonly filters: Array<[string, unknown]> = [];

      constructor(private readonly operation: Record<string, unknown>) {
        operation.filters = this.filters;
      }

      eq(column: string, value: unknown) {
        this.filters.push([column, value]);
        return this;
      }

      then<TResult1 = { error: null }>(
        onfulfilled?: ((value: { error: null }) => TResult1 | PromiseLike<TResult1>) | null
      ): Promise<TResult1> {
        return Promise.resolve({ error: null }).then(onfulfilled);
      }
    }

    const fakeSupabase = {
      from(table: string) {
        return {
          delete() {
            const operation = { table, action: 'delete' };
            operations.push(operation);
            return new DeleteBuilder(operation);
          },
          insert(rows: unknown) {
            operations.push({ table, action: 'insert', rows });
            return Promise.resolve({ error: null });
          },
          upsert(rows: unknown, options: unknown) {
            operations.push({ table, action: 'upsert', rows, options });
            return Promise.resolve({ error: null });
          }
        };
      },
      rpc(name: string, params: unknown) {
        operations.push({ action: 'rpc', name, params });
        if (name === 'refresh_lastfm_artist_genres_and_queue') {
          return Promise.resolve({
            data: { genres_projected: 3, rollup_dates_queued: 12, artists_changed: 1 },
            error: null
          });
        }
        return Promise.resolve({ data: 1, error: null });
      }
    };
    const item: ExternalMusicWorkItem = {
      queue_id: 1,
      worker_token: '11111111-1111-4111-8111-111111111111',
      attempt_count: 1,
      entity_type: 'track',
      entity_id: 11,
      entity_name: 'Track',
      last_result: {},
      context_track_id: 11,
      context_track_name: 'Track',
      context_duration_ms: 180_000,
      context_isrc: 'GBAHT1600302',
      context_album_id: 22,
      context_album_name: 'Album',
      context_artists: [{ id: 33, name: 'Artist', artist_order: 0 }]
    };
    const capture = (method: string, data: unknown): LastFmCapture => ({
      method,
      params: { mbid: '11111111-1111-4111-8111-111111111111' },
      fetched_at: '2026-08-27T00:00:00.000Z',
      http_status: 200,
      ok: true,
      data,
      error: null
    });

    const persistence = await persistExternalMusicWrites(fakeSupabase as never, item, {
      musicbrainz: {
        fetchedAt: '2026-08-27T00:00:00.000Z',
        candidates: scoreEdgeRecordings(
          { name: 'Track', durationMs: 180_000, artistNames: ['Artist'] },
          [{
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Track',
            length: 180_000,
            'artist-credit': [{ artist: { name: 'Artist' } }]
          }]
        ),
        selected: scoreEdgeRecordings(
          { name: 'Track', durationMs: 180_000, artistNames: ['Artist'] },
          [{
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Track',
            length: 180_000,
            'artist-credit': [{ artist: { name: 'Artist' } }]
          }]
        )[0]!
      },
      lastfm: {
        'track.info': capture('track.getInfo', {
          track: { name: 'Track', url: 'https://last.fm/track', listeners: '12', playcount: '34' }
        }),
        'track.tags': capture('track.getTopTags', {
          toptags: { tag: [{ name: 'Hip-Hop', count: '9' }, { name: 'R&B', count: '4' }] }
        }),
        'track.similar': capture('track.getSimilar', {
          similartracks: {
            track: [{ name: 'Neighbour', match: '0.9', artist: { name: 'Other' }, url: 'https://last.fm/other' }]
          }
        })
      }
    });

    expect(operations).toContainEqual(expect.objectContaining({
      table: 'musicbrainz_track_matches',
      action: 'insert'
    }));
    expect(operations).toContainEqual(expect.objectContaining({
      table: 'external_music_metadata',
      action: 'upsert',
      rows: expect.objectContaining({ track_id: 11, canonical_name: 'Track', match_method: 'mbid' })
    }));
    expect(operations).toContainEqual(expect.objectContaining({
      table: 'external_music_tags',
      action: 'insert',
      rows: expect.arrayContaining([
        expect.objectContaining({ raw_tag: 'Hip-Hop', normalized_tag: 'hip hop' }),
        expect.objectContaining({ raw_tag: 'R&B', normalized_tag: 'r and b' })
      ])
    }));
    expect(operations).toContainEqual(expect.objectContaining({
      table: 'external_track_similarities',
      action: 'insert',
      rows: [expect.objectContaining({ track_id: 11, rank: 1, match_score: 0.9 })]
    }));
    expect(operations).toContainEqual({
      action: 'rpc',
      name: 'refresh_lastfm_artist_genres_and_queue',
      params: { p_artist_ids: [33] }
    });
    expect(operations).not.toContainEqual(expect.objectContaining({
      action: 'rpc',
      name: 'queue_rollup_refresh_for_artists'
    }));
    expect(persistence).toEqual({ genresProjected: 3, rollupDatesQueued: 12 });
  });
});
