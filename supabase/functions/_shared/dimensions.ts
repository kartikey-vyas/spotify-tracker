import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { SpotifyAlbum, SpotifyArtist, SpotifySimplifiedArtist, SpotifyTrack } from './spotify.ts';

type IdRow = { id: number };

function firstImageUrl(images: Array<{ url: string }> | undefined): string | null {
  return images?.[0]?.url ?? null;
}

function spotifyUri(type: 'artist' | 'album' | 'track', id: string): string {
  return `spotify:${type}:${id}`;
}

async function singleId(
  query: PromiseLike<{ data: IdRow | null; error: { message: string } | null }>,
  context: string
): Promise<number> {
  const { data, error } = await query;
  if (error) throw new Error(`${context}: ${error.message}`);
  if (!data) throw new Error(`${context}: no id returned`);
  return data.id;
}

export async function upsertArtistFromSpotify(
  supabase: SupabaseClient,
  artist: SpotifyArtist | SpotifySimplifiedArtist
): Promise<number> {
  const payload: Record<string, unknown> = {
    spotify_artist_uri: artist.uri ?? spotifyUri('artist', artist.id),
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

  const artistId = await singleId(
    supabase
      .from('artists')
      .upsert(payload, { onConflict: 'spotify_artist_id' })
      .select('id')
      .single<IdRow>(),
    'Upserting artist'
  );

  if ('genres' in artist && artist.genres) {
    const { error: deleteError } = await supabase.from('artist_genres').delete().eq('artist_id', artistId);
    if (deleteError) throw new Error(`Deleting artist genres: ${deleteError.message}`);

    if (artist.genres.length > 0) {
      const { error: insertError } = await supabase.from('artist_genres').insert(
        artist.genres.map((genre) => ({
          artist_id: artistId,
          genre
        }))
      );
      if (insertError) throw new Error(`Inserting artist genres: ${insertError.message}`);
    }
  }

  return artistId;
}

export async function upsertAlbumFromSpotify(
  supabase: SupabaseClient,
  album: SpotifyAlbum
): Promise<number> {
  const payload = {
    spotify_album_uri: album.uri ?? spotifyUri('album', album.id),
    spotify_album_id: album.id,
    name: album.name,
    album_type: album.album_type ?? null,
    release_date: album.release_date ?? null,
    release_date_precision: album.release_date_precision ?? null,
    image_url: firstImageUrl(album.images),
    spotify_url: album.external_urls?.spotify ?? null,
    last_refreshed_at: new Date().toISOString()
  };

  return singleId(
    supabase
      .from('albums')
      .upsert(payload, { onConflict: 'spotify_album_id' })
      .select('id')
      .single<IdRow>(),
    'Upserting album'
  );
}

export async function upsertTrackFromSpotify(
  supabase: SupabaseClient,
  track: SpotifyTrack
): Promise<{ trackId: number; primaryArtistId: number | null; albumId: number | null }> {
  const albumId = track.album ? await upsertAlbumFromSpotify(supabase, track.album) : null;
  const artistIds = [];

  for (const artist of track.artists ?? []) {
    artistIds.push(await upsertArtistFromSpotify(supabase, artist));
  }

  const payload = {
    spotify_track_uri: track.uri ?? spotifyUri('track', track.id),
    spotify_track_id: track.id,
    name: track.name,
    album_id: albumId,
    duration_ms: track.duration_ms ?? null,
    explicit: track.explicit ?? null,
    isrc: track.external_ids?.isrc ?? null,
    spotify_url: track.external_urls?.spotify ?? null,
    last_refreshed_at: new Date().toISOString()
  };

  const trackId = await singleId(
    supabase
      .from('tracks')
      .upsert(payload, { onConflict: 'spotify_track_id' })
      .select('id')
      .single<IdRow>(),
    'Upserting track'
  );

  if (artistIds.length > 0) {
    const { error } = await supabase.from('track_artists').upsert(
      artistIds.map((artistId, index) => ({
        track_id: trackId,
        artist_id: artistId,
        artist_order: index
      })),
      { onConflict: 'track_id,artist_id' }
    );
    if (error) throw new Error(`Upserting track artists: ${error.message}`);
  }

  return {
    trackId,
    primaryArtistId: artistIds[0] ?? null,
    albumId
  };
}

