import { setTimeout as sleep } from 'node:timers/promises';
import { requireEnv } from './env.js';

export type SpotifyImage = {
  url: string;
  height?: number | null;
  width?: number | null;
};

export type SpotifyArtist = {
  id: string;
  uri?: string;
  name: string;
  genres?: string[];
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
};

export type SpotifySimplifiedArtist = Pick<SpotifyArtist, 'id' | 'uri' | 'name' | 'external_urls'>;

export type SpotifyAlbum = {
  id: string;
  uri?: string;
  name: string;
  album_type?: string;
  release_date?: string;
  release_date_precision?: string;
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
};

export type SpotifyTrack = {
  id: string;
  uri?: string;
  name: string;
  duration_ms?: number;
  explicit?: boolean;
  external_urls?: { spotify?: string };
  external_ids?: { isrc?: string };
  album?: SpotifyAlbum;
  artists?: SpotifySimplifiedArtist[];
};

export type SpotifyRecentlyPlayedItem = {
  track: SpotifyTrack;
  played_at: string;
  context?: {
    type?: string;
    uri?: string;
  } | null;
};

export type SpotifyRecentlyPlayedResponse = {
  items: SpotifyRecentlyPlayedItem[];
};

export function spotifyUri(type: 'artist' | 'album' | 'track', id: string): string {
  return `spotify:${type}:${id}`;
}

export function spotifyIdFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const parts = uri.split(':');
  return parts.length === 3 ? parts[2] : null;
}

export async function refreshSpotifyAccessToken(): Promise<string> {
  const clientId = requireEnv('SPOTIFY_CLIENT_ID');
  const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET');
  const refreshToken = requireEnv('SPOTIFY_REFRESH_TOKEN');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error('Spotify token refresh response did not include access_token');
  }

  return payload.access_token;
}

export async function spotifyApiFetch<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  attempt = 1
): Promise<T> {
  const response = await fetch(`https://api.spotify.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...init.headers
    }
  });

  if (response.status === 429 && attempt <= 4) {
    const retryAfter = Number(response.headers.get('retry-after') ?? '1');
    await sleep(Math.max(1, retryAfter) * 1000);
    return spotifyApiFetch<T>(path, accessToken, init, attempt + 1);
  }

  if (response.status >= 500 && attempt <= 3) {
    await sleep(500 * attempt * attempt);
    return spotifyApiFetch<T>(path, accessToken, init, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(
      `Spotify API ${path} failed with HTTP ${response.status}: ${body.slice(0, 240)}`
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

/**
 * Fetch a single catalog item, returning null when Spotify reports it does not
 * exist (404) so one missing id does not abort an entire enrichment batch.
 */
async function getByIdOrNull<T>(path: string, accessToken: string): Promise<T | null> {
  try {
    return await spotifyApiFetch<T>(path, accessToken);
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

export async function getRecentlyPlayed(
  accessToken: string,
  afterMs: number
): Promise<SpotifyRecentlyPlayedResponse> {
  const params = new URLSearchParams({
    limit: '50',
    after: String(afterMs)
  });

  return spotifyApiFetch<SpotifyRecentlyPlayedResponse>(
    `/v1/me/player/recently-played?${params.toString()}`,
    accessToken
  );
}

// The batch "Get Several X" endpoints (/v1/tracks?ids=, /v1/artists?ids=,
// /v1/albums?ids=) were removed from the Spotify Web API in February 2026; only
// the single-item endpoints remain. Fetch each id individually and aggregate,
// skipping ids Spotify no longer knows about.
async function getCatalogItems<T>(prefix: string, accessToken: string, ids: string[]): Promise<T[]> {
  const items: T[] = [];
  for (const id of ids) {
    const item = await getByIdOrNull<T>(`${prefix}/${id}`, accessToken);
    if (item) items.push(item);
  }
  return items;
}

export async function getTracks(accessToken: string, ids: string[]): Promise<SpotifyTrack[]> {
  return getCatalogItems<SpotifyTrack>('/v1/tracks', accessToken, ids);
}

export async function getArtists(accessToken: string, ids: string[]): Promise<SpotifyArtist[]> {
  return getCatalogItems<SpotifyArtist>('/v1/artists', accessToken, ids);
}

export async function getAlbums(accessToken: string, ids: string[]): Promise<SpotifyAlbum[]> {
  return getCatalogItems<SpotifyAlbum>('/v1/albums', accessToken, ids);
}
