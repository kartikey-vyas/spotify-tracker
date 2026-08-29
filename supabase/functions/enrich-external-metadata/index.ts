// Resumable MusicBrainz + Last.fm enrichment, driven by pg_cron. The database
// owns claiming, leases, retries and telemetry; this function only performs a
// small serial batch so provider pacing and Edge Function wall time stay bounded.

import { adminClient, assertServiceRequest } from '../_shared/supabase.ts';
import { requireEnv } from '../_shared/env.ts';
import { errorJson, json } from '../_shared/http.ts';
import { captureLastFm } from '../_shared/lastfm.ts';
import {
  lookupMusicBrainzByIsrc,
  scoreMusicBrainzRecordings
} from '../_shared/musicbrainz.ts';
import {
  classifyLastFmCapture,
  classifyMusicBrainzError,
  endpointDone,
  previousResult,
  shouldFallbackLastFmMbid,
  shouldOpenLastFmCircuit,
  shouldConsumeExternalRetryAttempt,
  shouldUseLastFmMbid,
  withEndpoint,
  type EnrichmentResult,
  type ProviderDecision,
  type ProviderFailureOrigin
} from '../_shared/external-music-enrichment.ts';
import {
  persistExternalMusicWrites,
  type ExternalMusicWorkItem,
  type ProviderWrites
} from '../_shared/external-music-persistence.ts';

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_SECONDS = 240;
const MUSICBRAINZ_DELAY_MS = 1_100;
const LASTFM_DELAY_MS = 500;
const DEFAULT_USER_AGENT = 'musik/0.1.0 (https://github.com/kartikey-vyas/spotify-tracker)';

type ItemOutcome = {
  result: EnrichmentResult;
  succeeded: boolean;
  error: string | null;
  retryAfterSeconds: number | null;
  consumeAttempt: boolean;
  warnings: number;
};

type ProviderCircuit = {
  musicbrainz: ProviderDecision | null;
  lastfm: ProviderDecision | null;
};

class ProviderPacer {
  private lastAt = 0;

  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    const remaining = this.lastAt + this.intervalMs - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    this.lastAt = Date.now();
  }
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(Math.trunc(value), maximum))
    : fallback;
}

function primaryArtist(item: ExternalMusicWorkItem): { id: number; name: string } | null {
  return item.context_artists.find((artist) => artist.artist_order === 0) ?? item.context_artists[0] ?? null;
}

function requiredEndpoints(item: ExternalMusicWorkItem): string[] {
  return item.entity_type === 'track'
    ? ['musicbrainz', 'track.info', 'track.tags', 'track.similar']
    : [`${item.entity_type}.info`, `${item.entity_type}.tags`];
}

function lastFmMethod(item: ExternalMusicWorkItem, suffix: 'info' | 'tags' | 'similar'): string {
  const methodSuffix = suffix === 'info' ? 'getInfo' : suffix === 'tags' ? 'getTopTags' : 'getSimilar';
  return `${item.entity_type}.${methodSuffix}`;
}

function lastFmNameParams(
  item: ExternalMusicWorkItem
): Record<string, string | number> | null {
  const artist = primaryArtist(item);
  if (item.entity_type === 'track') {
    return artist
      ? { artist: artist.name, track: item.entity_name, autocorrect: 1 }
      : null;
  }
  if (item.entity_type === 'artist') return { artist: item.entity_name, autocorrect: 1 };
  return artist
    ? { artist: artist.name, album: item.entity_name, autocorrect: 1 }
    : null;
}

function recordDecision(
  result: EnrichmentResult,
  endpoint: string,
  decision: ProviderDecision,
  fetchedAt: string,
  selectedMbid?: string | null
): EnrichmentResult {
  if (!decision.terminal || !decision.status) return result;
  return withEndpoint(result, endpoint, {
    status: decision.status,
    fetched_at: fetchedAt,
    ...(endpoint === 'musicbrainz' ? { selected_mbid: selectedMbid ?? null } : {})
  });
}

async function processItem(
  supabase: ReturnType<typeof adminClient>,
  item: ExternalMusicWorkItem,
  lastFmApiKey: string,
  musicBrainzUserAgent: string,
  musicBrainzPacer: ProviderPacer,
  lastFmPacer: ProviderPacer,
  circuit: ProviderCircuit
): Promise<ItemOutcome> {
  const originalResult = previousResult(item.last_result);
  let result = originalResult;
  const writes: ProviderWrites = { lastfm: {} };
  const failures: string[] = [];
  const failureOrigins: ProviderFailureOrigin[] = [];
  let retryAfterSeconds: number | null = null;
  let warnings = 0;

  const addFailure = (
    endpoint: string,
    decision: ProviderDecision,
    origin: ProviderFailureOrigin
  ) => {
    failures.push(`${endpoint}: ${decision.message ?? 'provider request failed'}`);
    failureOrigins.push(origin);
    retryAfterSeconds = Math.max(retryAfterSeconds ?? 0, decision.retryAfterSeconds ?? 60);
  };

  if (item.entity_type === 'track' && !endpointDone(result, 'musicbrainz')) {
    const fetchedAt = new Date().toISOString();
    if (circuit.musicbrainz) {
      addFailure('musicbrainz', circuit.musicbrainz, 'circuit');
    } else {
      try {
        await musicBrainzPacer.wait();
        const response = await lookupMusicBrainzByIsrc(item.context_isrc, { userAgent: musicBrainzUserAgent });
        const candidates = scoreMusicBrainzRecordings(
          {
            name: item.context_track_name,
            durationMs: item.context_duration_ms,
            artistNames: item.context_artists.map((artist) => artist.name)
          },
          response.recordings ?? []
        );
        const best = candidates[0] ?? null;
        const selected = best && best.confidence !== 'low' && !best.ambiguous ? best : null;
        writes.musicbrainz = { fetchedAt, candidates, selected };
        result = withEndpoint(result, 'musicbrainz', {
          status: candidates.length > 0 ? 'ok' : 'no_match',
          fetched_at: fetchedAt,
          selected_mbid: selected?.mbid ?? null
        });
      } catch (error) {
        const decision = classifyMusicBrainzError(error);
        if (decision.terminal) {
          writes.musicbrainz = { fetchedAt, candidates: [], selected: null };
          result = recordDecision(result, 'musicbrainz', decision, fetchedAt, null);
        } else {
          addFailure('musicbrainz', decision, 'request');
          circuit.musicbrainz = decision;
        }
      }
    }
  }

  const suffixes: Array<'info' | 'tags' | 'similar'> = item.entity_type === 'track'
    ? ['info', 'tags', 'similar']
    : ['info', 'tags'];
  for (const suffix of suffixes) {
    const endpoint = `${item.entity_type}.${suffix}`;
    if (endpointDone(result, endpoint)) continue;
    const method = lastFmMethod(item, suffix);
    const nameParams = lastFmNameParams(item);
    if (!nameParams) {
      warnings += 1;
      result = withEndpoint(result, endpoint, {
        status: 'no_match',
        fetched_at: new Date().toISOString()
      });
      continue;
    }
    if (circuit.lastfm) {
      addFailure(endpoint, circuit.lastfm, 'circuit');
      continue;
    }

    const selectedMbid = result.endpoints.musicbrainz?.selected_mbid;
    const mbidParams = shouldUseLastFmMbid(item.entity_type, suffix, selectedMbid)
      ? { mbid: selectedMbid! }
      : null;
    await lastFmPacer.wait();
    let capture = await captureLastFm(lastFmApiKey, method, mbidParams ?? nameParams);
    let decision = classifyLastFmCapture(capture);

    // Last.fm does not always index a valid MusicBrainz recording MBID. Keep
    // the MBID-first path, then fall back to the Spotify artist/title identity.
    if (mbidParams && shouldFallbackLastFmMbid(capture)) {
      await lastFmPacer.wait();
      capture = await captureLastFm(lastFmApiKey, method, nameParams);
      decision = classifyLastFmCapture(capture);
    }

    if (decision.terminal) {
      result = recordDecision(result, endpoint, decision, capture.fetched_at);
      if (decision.status === 'ok') writes.lastfm[endpoint] = capture;
    } else {
      addFailure(endpoint, decision, 'request');
      if (shouldOpenLastFmCircuit(capture)) circuit.lastfm = decision;
    }
  }

  try {
    await persistExternalMusicWrites(supabase, item, writes);
  } catch (error) {
    return {
      result: originalResult,
      succeeded: false,
      error: `database persistence: ${error instanceof Error ? error.message : String(error)}`,
      retryAfterSeconds: 300,
      consumeAttempt: true,
      warnings: warnings + 1
    };
  }

  const succeeded = requiredEndpoints(item).every((endpoint) => endpointDone(result, endpoint));
  return {
    result,
    succeeded,
    error: succeeded ? null : failures.join('; ') || 'One or more endpoints remain incomplete',
    retryAfterSeconds: succeeded ? null : retryAfterSeconds,
    consumeAttempt:
      succeeded || failureOrigins.length === 0 || shouldConsumeExternalRetryAttempt(failureOrigins),
    warnings
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });

  let workerToken: string | null = null;
  let runId: number | null = null;
  let supabase: ReturnType<typeof adminClient> | null = null;
  const counts = { claimed: 0, succeeded: 0, retried: 0, dead: 0, warnings: 0 };
  let runError: string | null = null;

  try {
    assertServiceRequest(req);
    const body = (await req.json().catch(() => ({}))) as { batch_size?: unknown; lease_seconds?: unknown };
    const batchSize = clampInteger(body.batch_size, DEFAULT_BATCH_SIZE, 1, 20);
    const leaseSeconds = clampInteger(body.lease_seconds, DEFAULT_LEASE_SECONDS, 60, 600);
    const lastFmApiKey = requireEnv('LASTFM_API_KEY');
    const musicBrainzUserAgent = Deno.env.get('MUSICBRAINZ_USER_AGENT') || DEFAULT_USER_AGENT;
    supabase = adminClient();

    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_external_music_enrichment_batch', {
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds
    });
    if (claimError) throw new Error(`Claiming external enrichment work failed: ${claimError.message}`);
    const items = (claimedRows ?? []) as ExternalMusicWorkItem[];
    if (items.length === 0) {
      const { data: progress } = await supabase.rpc('external_music_enrichment_progress');
      return json({ ...counts, busy_or_empty: true, progress: progress ?? [] });
    }

    workerToken = items[0].worker_token;
    counts.claimed = items.length;
    const { data: runRow, error: runInsertError } = await supabase
      .from('external_music_enrichment_runs')
      .insert({ requested_limit: batchSize, claimed: items.length })
      .select('id')
      .single();
    if (runInsertError) console.warn(`Creating external enrichment run failed: ${runInsertError.message}`);
    runId = (runRow as { id: number } | null)?.id ?? null;

    const musicBrainzPacer = new ProviderPacer(MUSICBRAINZ_DELAY_MS);
    const lastFmPacer = new ProviderPacer(LASTFM_DELAY_MS);
    const circuit: ProviderCircuit = { musicbrainz: null, lastfm: null };
    for (const item of items) {
      let outcome: ItemOutcome;
      try {
        outcome = await processItem(
          supabase,
          item,
          lastFmApiKey,
          musicBrainzUserAgent,
          musicBrainzPacer,
          lastFmPacer,
          circuit
        );
      } catch (error) {
        outcome = {
          result: previousResult(item.last_result),
          succeeded: false,
          error: error instanceof Error ? error.message : String(error),
          retryAfterSeconds: 300,
          consumeAttempt: true,
          warnings: 1
        };
      }

      const { data: finishStatus, error: finishError } = await supabase.rpc(
        'finish_external_music_enrichment_item',
        {
          p_queue_id: item.queue_id,
          p_worker_token: item.worker_token,
          p_succeeded: outcome.succeeded,
          p_error: outcome.error,
          p_retry_after_seconds: outcome.retryAfterSeconds,
          p_result: outcome.result,
          p_consume_attempt: outcome.consumeAttempt
        }
      );
      if (finishError) {
        counts.warnings += 1;
        console.warn(`Finishing queue item ${item.queue_id} failed: ${finishError.message}`);
      } else if (finishStatus === 'succeeded') {
        counts.succeeded += 1;
      } else if (finishStatus === 'dead') {
        counts.dead += 1;
      } else {
        counts.retried += 1;
      }
      counts.warnings += outcome.warnings;
    }

    const { data: progress } = await supabase.rpc('external_music_enrichment_progress');
    return json({ ...counts, busy_or_empty: false, progress: progress ?? [] });
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    return errorJson(runError, runError === 'Invalid service credential' ? 401 : 500);
  } finally {
    if (workerToken && supabase) {
      const { error } = await supabase.rpc('release_external_music_enrichment_worker', {
        p_worker_token: workerToken
      });
      if (error) console.warn(`Releasing external enrichment worker failed: ${error.message}`);
    }
    if (runId !== null && supabase) {
      const { error } = await supabase
        .from('external_music_enrichment_runs')
        .update({
          finished_at: new Date().toISOString(),
          succeeded: counts.succeeded,
          retried: counts.retried,
          dead: counts.dead,
          warnings: counts.warnings,
          error: runError
        })
        .eq('id', runId);
      if (error) console.warn(`Finishing external enrichment run failed: ${error.message}`);
    }
  }
});
