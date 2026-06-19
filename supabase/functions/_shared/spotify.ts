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

export type SpotifyMe = {
  id: string;
  display_name?: string;
};

export type SpotifyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
};

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

async function tokenRequest(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: basicAuth(requireEnv('SPOTIFY_CLIENT_ID'), requireEnv('SPOTIFY_CLIENT_SECRET')),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Spotify token request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SpotifyTokenResponse;
  if (!payload.access_token) throw new Error('Spotify token response did not include access_token');
  return payload;
}

export function spotifyCallbackUrl(): string {
  return `${requireEnv('SUPABASE_URL')}/functions/v1/spotify-callback`;
}

export function spotifyScopes(): string[] {
  return ['user-read-recently-played', 'user-read-playback-state', 'user-read-currently-playing'];
}

export function spotifyAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('SPOTIFY_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: spotifyCallbackUrl(),
    scope: spotifyScopes().join(' '),
    state,
    show_dialog: 'true'
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeSpotifyCode(code: string): Promise<SpotifyTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: spotifyCallbackUrl()
    })
  );
}

export async function refreshSpotifyAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  );
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
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryAfter) * 1000));
    return spotifyApiFetch<T>(path, accessToken, init, attempt + 1);
  }

  if (response.status >= 500 && attempt <= 3) {
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt * attempt));
    return spotifyApiFetch<T>(path, accessToken, init, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`Spotify API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getSpotifyMe(accessToken: string): Promise<SpotifyMe> {
  return spotifyApiFetch<SpotifyMe>('/v1/me', accessToken);
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
import { requireEnv } from './env.ts';

