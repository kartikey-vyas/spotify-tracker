import type { AdminClient } from './supabase-admin.js';
import { throwIfSupabaseError } from './supabase-admin.js';
import {
  spotifyUri,
  type SpotifyAlbum,
  type SpotifyArtist,
  type SpotifySimplifiedArtist,
  type SpotifyTrack
} from './spotify.js';

type IdRow = { id: number };

function firstImageUrl(images: Array<{ url: string }> | undefined): string | null {
  return images?.[0]?.url ?? null;
}

export async function upsertArtistFromSpotify(
  supabase: AdminClient,
  artist: SpotifyArtist | SpotifySimplifiedArtist
): Promise<number> {
  const uri = artist.uri ?? spotifyUri('artist', artist.id);
  const payload: Record<string, unknown> = {
    spotify_artist_uri: uri,
    spotify_artist_id: artist.id,
    name: artist.name,
    spotify_url: artist.external_urls?.spotify ?? null
  };

  if ('images' in artist) {
    payload.image_url = firstImageUrl(artist.images);
  }

  if ('images' in artist || 'genres' in artist) {
    payload.last_refreshed_at = new Date().toISOString();
  }

  const { data: byId, error: byIdError } = await supabase
    .from('artists')
    .select('id')
    .eq('spotify_artist_id', artist.id)
    .maybeSingle<IdRow>();
  throwIfSupabaseError(byIdError, 'Looking up artist by Spotify ID failed');

  if (byId) {
    const { data, error } = await supabase
      .from('artists')
      .update(payload)
      .eq('id', byId.id)
    .select('id')
    .single<IdRow>();
    throwIfSupabaseError(error, 'Updating Spotify artist failed');
    if (!data) throw new Error('Updating Spotify artist returned no data');
    await replaceArtistGenres(supabase, data.id, 'genres' in artist ? artist.genres : undefined);
    return data.id;
  }

  const { data: fallback, error: fallbackError } = await supabase
    .from('artists')
    .select('id')
    .is('spotify_artist_id', null)
    .is('spotify_artist_uri', null)
    .eq('name', artist.name)
    .maybeSingle<IdRow>();
  throwIfSupabaseError(fallbackError, 'Looking up fallback artist failed');

  if (fallback) {
    const { data, error } = await supabase
      .from('artists')
      .update(payload)
      .eq('id', fallback.id)
    .select('id')
    .single<IdRow>();
    throwIfSupabaseError(error, 'Promoting fallback artist failed');
    if (!data) throw new Error('Promoting fallback artist returned no data');
    await replaceArtistGenres(supabase, data.id, 'genres' in artist ? artist.genres : undefined);
    return data.id;
  }

  const { data, error } = await supabase
    .from('artists')
    .insert(payload)
    .select('id')
    .single<IdRow>();
  throwIfSupabaseError(error, 'Inserting Spotify artist failed');
  if (!data) throw new Error('Inserting Spotify artist returned no data');
  await replaceArtistGenres(supabase, data.id, 'genres' in artist ? artist.genres : undefined);
  return data.id;
}

async function replaceArtistGenres(
  supabase: AdminClient,
  artistId: number,
  genres: string[] | undefined
): Promise<void> {
  if (!genres) return;

  const { error: deleteError } = await supabase.from('artist_genres').delete().eq('artist_id', artistId);
  throwIfSupabaseError(deleteError, 'Deleting old artist genres failed');

  if (genres.length === 0) return;

  const { error: insertError } = await supabase.from('artist_genres').insert(
    genres.map((genre) => ({
      artist_id: artistId,
      genre
    }))
  );
  throwIfSupabaseError(insertError, 'Inserting artist genres failed');
}

export async function upsertAlbumFromSpotify(
  supabase: AdminClient,
  album: SpotifyAlbum
): Promise<number> {
  const uri = album.uri ?? spotifyUri('album', album.id);
  const payload = {
    spotify_album_uri: uri,
    spotify_album_id: album.id,
    name: album.name,
    album_type: album.album_type ?? null,
    release_date: album.release_date ?? null,
    release_date_precision: album.release_date_precision ?? null,
    image_url: firstImageUrl(album.images),
    spotify_url: album.external_urls?.spotify ?? null,
    last_refreshed_at: new Date().toISOString()
  };

  const { data: byId, error: byIdError } = await supabase
    .from('albums')
    .select('id')
    .eq('spotify_album_id', album.id)
    .maybeSingle<IdRow>();
  throwIfSupabaseError(byIdError, 'Looking up album by Spotify ID failed');

  if (byId) {
    const { data, error } = await supabase
      .from('albums')
      .update(payload)
      .eq('id', byId.id)
    .select('id')
    .single<IdRow>();
    throwIfSupabaseError(error, 'Updating Spotify album failed');
    if (!data) throw new Error('Updating Spotify album returned no data');
    return data.id;
  }

  const { data: fallback, error: fallbackError } = await supabase
    .from('albums')
    .select('id')
    .is('spotify_album_id', null)
    .is('spotify_album_uri', null)
    .eq('name', album.name)
    .maybeSingle<IdRow>();
  throwIfSupabaseError(fallbackError, 'Looking up fallback album failed');

  if (fallback) {
    const { data, error } = await supabase
      .from('albums')
      .update(payload)
      .eq('id', fallback.id)
    .select('id')
    .single<IdRow>();
    throwIfSupabaseError(error, 'Promoting fallback album failed');
    if (!data) throw new Error('Promoting fallback album returned no data');
    return data.id;
  }

  const { data, error } = await supabase.from('albums').insert(payload).select('id').single<IdRow>();
  throwIfSupabaseError(error, 'Inserting Spotify album failed');
  if (!data) throw new Error('Inserting Spotify album returned no data');
  return data.id;
}

export async function upsertTrackFromSpotify(
  supabase: AdminClient,
  track: SpotifyTrack
): Promise<{ trackId: number; primaryArtistId: number | null; albumId: number | null }> {
  const albumId = track.album ? await upsertAlbumFromSpotify(supabase, track.album) : null;
  const artistIds = [];

  for (const artist of track.artists ?? []) {
    artistIds.push(await upsertArtistFromSpotify(supabase, artist));
  }

  const uri = track.uri ?? spotifyUri('track', track.id);
  const payload = {
    spotify_track_uri: uri,
    spotify_track_id: track.id,
    name: track.name,
    album_id: albumId,
    duration_ms: track.duration_ms ?? null,
    explicit: track.explicit ?? null,
    isrc: track.external_ids?.isrc ?? null,
    spotify_url: track.external_urls?.spotify ?? null,
    last_refreshed_at: new Date().toISOString()
  };

  const { data: existing, error: existingError } = await supabase
    .from('tracks')
    .select('id')
    .eq('spotify_track_id', track.id)
    .maybeSingle<IdRow>();
  throwIfSupabaseError(existingError, 'Looking up track by Spotify ID failed');

  const trackId = existing
    ? await updateTrack(supabase, existing.id, payload)
    : await insertTrack(supabase, payload);

  if (artistIds.length > 0) {
    const { error } = await supabase.from('track_artists').upsert(
      artistIds.map((artistId, index) => ({
        track_id: trackId,
        artist_id: artistId,
        artist_order: index
      })),
      { onConflict: 'track_id,artist_id' }
    );
    throwIfSupabaseError(error, 'Upserting track artists failed');
  }

  return {
    trackId,
    primaryArtistId: artistIds[0] ?? null,
    albumId
  };
}

async function updateTrack(
  supabase: AdminClient,
  id: number,
  payload: Record<string, unknown>
): Promise<number> {
  const { data, error } = await supabase.from('tracks').update(payload).eq('id', id).select('id').single<IdRow>();
  throwIfSupabaseError(error, 'Updating Spotify track failed');
  if (!data) throw new Error('Updating Spotify track returned no data');
  return data.id;
}

async function insertTrack(supabase: AdminClient, payload: Record<string, unknown>): Promise<number> {
  const { data, error } = await supabase.from('tracks').insert(payload).select('id').single<IdRow>();
  throwIfSupabaseError(error, 'Inserting Spotify track failed');
  if (!data) throw new Error('Inserting Spotify track returned no data');
  return data.id;
}
