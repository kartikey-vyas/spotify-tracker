// Runtime-neutral MusicBrainz + Last.fm item processor shared by the hosted
// Edge Function and the resumable laptop drain. Queue claiming and telemetry
// stay in each runtime's thin orchestration layer; provider and persistence
// semantics must remain identical.

// The Edge runtime resolves `npm:` specifiers; Node erases this type-only
// import before execution.
// @ts-expect-error Deno-specific npm specifier.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureLastFm } from './lastfm.ts';
import {
  lookupMusicBrainzByIsrc,
  scoreMusicBrainzRecordings
} from './musicbrainz.ts';
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
} from './external-music-enrichment.ts';
import {
  persistExternalMusicWrites,
  type ExternalMusicWorkItem,
  type ProviderWrites
} from './external-music-persistence.ts';

export const DEFAULT_EXTERNAL_BATCH_SIZE = 10;
export const DEFAULT_EXTERNAL_LEASE_SECONDS = 240;
export const MUSICBRAINZ_DELAY_MS = 1_100;
export const LASTFM_DELAY_MS = 500;
export const DEFAULT_MUSICBRAINZ_USER_AGENT =
  'musik/0.1.0 (https://github.com/kartikey-vyas/spotify-tracker)';

export type ExternalMusicItemOutcome = {
  result: EnrichmentResult;
  succeeded: boolean;
  error: string | null;
  retryAfterSeconds: number | null;
  consumeAttempt: boolean;
  warnings: number;
};

export type ExternalMusicProviderCircuit = {
  musicbrainz: ProviderDecision | null;
  lastfm: ProviderDecision | null;
};

export class ProviderPacer {
  private lastAt = 0;

  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    const remaining = this.lastAt + this.intervalMs - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    this.lastAt = Date.now();
  }
}

export function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
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

export async function processExternalMusicItem(
  supabase: SupabaseClient,
  item: ExternalMusicWorkItem,
  lastFmApiKey: string,
  musicBrainzUserAgent: string,
  musicBrainzPacer: ProviderPacer,
  lastFmPacer: ProviderPacer,
  circuit: ExternalMusicProviderCircuit
): Promise<ExternalMusicItemOutcome> {
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
