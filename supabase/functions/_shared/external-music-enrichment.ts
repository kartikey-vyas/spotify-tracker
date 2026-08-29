import { MusicBrainzHttpError } from './musicbrainz.ts';
import type { LastFmCapture } from './lastfm.ts';

export type TerminalEndpointStatus = 'ok' | 'not_found' | 'no_match';
export type EndpointState = {
  status: TerminalEndpointStatus;
  fetched_at: string;
  selected_mbid?: string | null;
};
export type EnrichmentResult = { endpoints: Record<string, EndpointState> };
export type ProviderDecision = {
  terminal: boolean;
  status?: TerminalEndpointStatus;
  retryAfterSeconds?: number;
  message?: string;
};

export function previousResult(value: unknown): EnrichmentResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { endpoints: {} };
  const endpoints = (value as { endpoints?: unknown }).endpoints;
  if (!endpoints || typeof endpoints !== 'object' || Array.isArray(endpoints)) return { endpoints: {} };
  return { endpoints: endpoints as Record<string, EndpointState> };
}

export function endpointDone(result: EnrichmentResult, endpoint: string): boolean {
  return ['ok', 'not_found', 'no_match'].includes(result.endpoints[endpoint]?.status);
}

export function withEndpoint(
  result: EnrichmentResult,
  endpoint: string,
  state: EndpointState
): EnrichmentResult {
  return { endpoints: { ...result.endpoints, [endpoint]: state } };
}

export function classifyLastFmCapture(capture: LastFmCapture): ProviderDecision {
  if (capture.ok) return { terminal: true, status: 'ok' };
  const code = capture.error?.code;
  if (code === 6 || code === 7) return { terminal: true, status: 'not_found' };
  const message = capture.error?.message ?? 'Unknown Last.fm failure';
  if (code === 29 || capture.http_status === 429) {
    return { terminal: false, retryAfterSeconds: 900, message };
  }
  if (code === 10 || code === 26) {
    return { terminal: false, retryAfterSeconds: 86_400, message };
  }
  if (code === 8 || code === 11 || code === 16 || capture.http_status === null || (capture.http_status ?? 0) >= 500) {
    return { terminal: false, retryAfterSeconds: 300, message };
  }
  return { terminal: false, retryAfterSeconds: 3_600, message };
}

/**
 * Last.fm documents MBID support for track endpoints, but getTopTags returns
 * an empty HTTP 400 for some valid recording MBIDs. Use the stable
 * artist/title identity for tags and retain MBID-first matching for the other
 * track endpoints.
 */
export function shouldUseLastFmMbid(
  entityType: 'track' | 'artist' | 'album',
  endpointSuffix: 'info' | 'tags' | 'similar',
  selectedMbid: string | null | undefined
): boolean {
  return entityType === 'track' && endpointSuffix !== 'tags' && Boolean(selectedMbid);
}

/** A rejected MBID identifies a bad lookup, not a provider outage. */
export function shouldFallbackLastFmMbid(capture: LastFmCapture): boolean {
  if (capture.ok) return false;
  return capture.http_status === 400 || capture.error?.code === 6 || capture.error?.code === 7;
}

/**
 * Only failures that can affect every request should stop further Last.fm
 * calls in the current batch. Request-specific 4xx failures must remain local
 * to their queue item.
 */
export function shouldOpenLastFmCircuit(capture: LastFmCapture): boolean {
  if (capture.ok) return false;
  if (capture.http_status === null || capture.http_status === 429 || (capture.http_status ?? 0) >= 500) {
    return true;
  }

  return [2, 3, 4, 5, 8, 10, 11, 13, 16, 26, 27, 29].includes(capture.error?.code ?? -1);
}

export function classifyMusicBrainzError(error: unknown): ProviderDecision {
  if (error instanceof MusicBrainzHttpError) {
    if (error.status === 400 || error.status === 404) {
      return { terminal: true, status: 'no_match', message: error.message };
    }
    if (error.status === 429 || error.status >= 500) {
      return { terminal: false, retryAfterSeconds: error.status === 429 ? 900 : 300, message: error.message };
    }
    return { terminal: false, retryAfterSeconds: 3_600, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('Invalid ISRC:')) return { terminal: true, status: 'no_match', message };
  return { terminal: false, retryAfterSeconds: 300, message };
}

export function normalizeLastFmTag(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}
