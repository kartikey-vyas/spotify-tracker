import { createServiceClient } from './lib/supabase-admin.js';

const EXECUTE = process.argv.includes('--execute');
const s = createServiceClient();

async function fetchAll<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  let head = s.from(table).select('*', { count: 'exact', head: true });
  if (filter) head = filter(head);
  const total = (await head).count ?? 0;
  const out: T[] = [];
  for (let from = 0; from < total; from += 1000) {
    let q = s.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

async function referencedIds(table: string, column: string): Promise<Set<number>> {
  const rows = await fetchAll<Record<string, number | null>>(table, column, (q) => q.not(column, 'is', null));
  return new Set(rows.map((r) => r[column]).filter((v): v is number => v != null));
}

async function deleteIds(table: string, ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await s.from(table).delete().in('id', ids.slice(i, i + 200));
    if (error) throw new Error(`delete ${table}: ${error.message}`);
  }
}

async function main() {
  // Fallback rows = never enriched (no Spotify id/uri).
  const fbArtists = await fetchAll<{ id: number }>('artists', 'id', (q) =>
    q.is('spotify_artist_uri', null).is('spotify_artist_id', null)
  );
  const fbAlbums = await fetchAll<{ id: number }>('albums', 'id', (q) =>
    q.is('spotify_album_uri', null).is('spotify_album_id', null)
  );

  // Artists: track_artists references cascade on delete, so only listening_events
  // (RESTRICT) must be clear. Albums: both listening_events and tracks (RESTRICT).
  const artistEventRefs = await referencedIds('listening_events', 'primary_artist_id');
  const albumEventRefs = await referencedIds('listening_events', 'album_id');
  const albumTrackRefs = await referencedIds('tracks', 'album_id');

  const orphanArtists = fbArtists.filter((r) => !artistEventRefs.has(r.id)).map((r) => r.id);
  const orphanAlbums = fbAlbums
    .filter((r) => !albumEventRefs.has(r.id) && !albumTrackRefs.has(r.id))
    .map((r) => r.id);

  console.log(
    JSON.stringify(
      {
        fallback_artists: fbArtists.length,
        orphan_artists: orphanArtists.length,
        still_referenced_artists: fbArtists.length - orphanArtists.length,
        fallback_albums: fbAlbums.length,
        orphan_albums: orphanAlbums.length,
        still_referenced_albums: fbAlbums.length - orphanAlbums.length
      },
      null,
      2
    )
  );

  if (!EXECUTE) {
    console.log('\nDRY RUN — re-run with --execute to delete orphans.');
    return;
  }

  await deleteIds('artists', orphanArtists);
  await deleteIds('albums', orphanAlbums);
  console.log(`Deleted ${orphanArtists.length} orphan artists + ${orphanAlbums.length} orphan albums.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
