import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_ENTITY_TYPES,
  requiredEndpoints,
  statsEndpoint,
  type EnrichmentResult,
  type ExternalEntityType
} from '../../supabase/functions/_shared/external-music-enrichment.ts';
import type { ExternalMusicWorkItem } from '../../supabase/functions/_shared/external-music-persistence.ts';
import {
  ProviderPacer,
  processExternalMusicItem
} from '../../supabase/functions/_shared/external-music-worker.ts';

const migration = readFileSync(
  resolve('supabase/migrations/20261109100000_monthly_lastfm_stats_snapshot.sql'),
  'utf8'
);

/** The endpoints the snapshot SQL requires to be terminal, per entity type. */
function sqlKeptEndpoints(): Map<string, string[]> {
  const kept = new Map<string, string[]>();
  for (const match of migration.matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)) {
    kept.set(match[1], [...match[2].matchAll(/'([^']+)'/g)].map((value) => value[1]));
  }
  return kept;
}

/** The state the snapshot SQL leaves behind: first pass done, stats endpoint cleared. */
function snapshotResult(entityType: ExternalEntityType): EnrichmentResult {
  const endpoints: EnrichmentResult['endpoints'] = {};
  for (const endpoint of requiredEndpoints(entityType)) {
    if (endpoint === statsEndpoint(entityType)) continue;
    endpoints[endpoint] = {
      status: 'ok',
      fetched_at: '2026-08-27T00:00:00.000Z',
      ...(endpoint === 'musicbrainz' ? { selected_mbid: null } : {})
    };
  }
  return { endpoints };
}

function workItem(entityType: ExternalEntityType): ExternalMusicWorkItem {
  return {
    queue_id: 1,
    worker_token: '11111111-1111-4111-8111-111111111111',
    attempt_count: 1,
    entity_type: entityType,
    entity_id: 42,
    entity_name: `Some ${entityType}`,
    last_result: snapshotResult(entityType),
    context_track_id: 11,
    context_track_name: 'Track',
    context_duration_ms: 180_000,
    context_isrc: 'GBAHT1600302',
    context_album_id: 22,
    context_album_name: 'Album',
    context_artists: [{ id: 33, name: 'Artist', artist_order: 0 }]
  };
}

function recordingSupabase(operations: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      return {
        upsert(rows: unknown, options: unknown) {
          operations.push({ table, action: 'upsert', rows, options });
          return Promise.resolve({ error: null });
        },
        insert(rows: unknown) {
          operations.push({ table, action: 'insert', rows });
          return Promise.resolve({ error: null });
        },
        delete() {
          operations.push({ table, action: 'delete' });
          const builder = {
            eq: () => builder,
            then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve)
          };
          return builder;
        }
      };
    },
    rpc(name: string, params: unknown) {
      operations.push({ action: 'rpc', name, params });
      return Promise.resolve({ data: {}, error: null });
    }
  };
}

describe('monthly Last.fm stats snapshot SQL', () => {
  it('keeps every required endpoint except the stats one, for every entity type', () => {
    const kept = sqlKeptEndpoints();
    for (const entityType of EXTERNAL_ENTITY_TYPES) {
      const expected = requiredEndpoints(entityType).filter(
        (endpoint) => endpoint !== statsEndpoint(entityType)
      );
      expect(kept.get(entityType), entityType).toEqual(expected);
    }
  });

  it('clears exactly the stats endpoint from the stored result', () => {
    const cleared = migration.match(/#- array\['endpoints', p_entity_type \|\| '([^']+)'\]/);
    expect(cleared).not.toBeNull();
    for (const entityType of EXTERNAL_ENTITY_TYPES) {
      expect(`${entityType}${cleared![1]}`).toBe(statsEndpoint(entityType));
    }
  });

  it('claims snapshot rows only after first-pass rows', () => {
    expect(migration).toContain(
      'order by ready.snapshot_rank, ready.provider_blocked_rank, ready.priority_plays desc, ready.id'
    );
    expect(migration).toContain(
      'case when q.stats_snapshot_on is not null then 1 else 0 end as snapshot_rank'
    );
  });

  it('returns a track reset to a full first pass to first-pass priority', () => {
    const triggerReset = migration.match(/on conflict \(entity_type, entity_id\) do update[\s\S]*?;/);
    expect(triggerReset?.[0]).toContain('stats_snapshot_on = null');
  });

  it('schedules artists monthly through cron.schedule', () => {
    expect(migration).toMatch(
      /select cron\.schedule\(\s*'snapshot-lastfm-artist-stats',\s*'\d+ \d+ 1 \* \*',\s*\$\$ select public\.enqueue_external_music_stats_snapshot\('artist'\); \$\$\s*\);/
    );
  });
});

describe('monthly Last.fm stats snapshot worker pass', () => {
  const methods: string[] = [];

  beforeEach(() => {
    methods.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T00:11:00.000Z'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      const method = url.searchParams.get('method') ?? '';
      methods.push(method);
      const entityType = method.split('.')[0];
      if (!method.endsWith('.getInfo') || url.hostname !== 'ws.audioscrobbler.com') {
        return new Response('unexpected request', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          [entityType]: { name: 'Canonical', url: 'https://last.fm/x', listeners: '1234', playcount: '5678' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  for (const entityType of EXTERNAL_ENTITY_TYPES) {
    it(`makes one getInfo call and records a dated ${entityType} stats row`, async () => {
      const operations: Array<Record<string, unknown>> = [];
      const outcome = await processExternalMusicItem(
        recordingSupabase(operations) as never,
        workItem(entityType),
        'test-lastfm-key',
        'musik-test/1.0',
        new ProviderPacer(0),
        new ProviderPacer(0),
        { musicbrainz: null, lastfm: null }
      );

      expect(outcome.succeeded).toBe(true);
      expect(methods).toEqual([`${entityType}.getInfo`]);
      expect(outcome.result.endpoints[statsEndpoint(entityType)]).toMatchObject({ status: 'ok' });

      const statsWrites = operations.filter((operation) => operation.table === 'external_music_stats');
      expect(statsWrites).toEqual([
        expect.objectContaining({
          action: 'upsert',
          rows: expect.objectContaining({
            [`${entityType}_id`]: 42,
            observed_on: '2026-12-01',
            listeners: 1234,
            playcount: 5678
          }),
          options: { onConflict: 'source,entity_type,entity_id,observed_on' }
        })
      ]);
      // No tags, similarities, MusicBrainz matches or genre/rollup refresh.
      const touched = new Set(operations.map((operation) => operation.table ?? operation.name));
      expect([...touched].sort()).toEqual(['external_music_metadata', 'external_music_stats']);
    });
  }
});
