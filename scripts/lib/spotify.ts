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
    throw new Error(`Spotify API ${path} failed with HTTP ${response.status}: ${body.slice(0, 240)}`);
  }

  return (await response.json()) as T;
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

export async function getTracks(accessToken: string, ids: string[]): Promise<SpotifyTrack[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ ids: ids.join(',') });
  const response = await spotifyApiFetch<{ tracks: Array<SpotifyTrack | null> }>(
    `/v1/tracks?${params.toString()}`,
    accessToken
  );
  return response.tracks.filter((track): track is SpotifyTrack => Boolean(track));
}

export async function getArtists(accessToken: string, ids: string[]): Promise<SpotifyArtist[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ ids: ids.join(',') });
  const response = await spotifyApiFetch<{ artists: Array<SpotifyArtist | null> }>(
    `/v1/artists?${params.toString()}`,
    accessToken
  );
  return response.artists.filter((artist): artist is SpotifyArtist => Boolean(artist));
}

export async function getAlbums(accessToken: string, ids: string[]): Promise<SpotifyAlbum[]> {
  if (ids.length === 0) return [];
  // Spotify allows at most 20 album ids per request.
  const params = new URLSearchParams({ ids: ids.slice(0, 20).join(',') });
  const response = await spotifyApiFetch<{ albums: Array<SpotifyAlbum | null> }>(
    `/v1/albums?${params.toString()}`,
    accessToken
  );
  return response.albums.filter((album): album is SpotifyAlbum => Boolean(album));
}
