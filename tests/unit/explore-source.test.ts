import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('/explore source', () => {
  it('does not render the old ASCII distribution chart', () => {
    const source = readFileSync(resolve('src/routes/explore/+page.svelte'), 'utf8');

    expect(source).not.toContain('Distribution');
    expect(source).not.toContain('asciiBarRows');
    expect(source).not.toContain('glyphTimeline');
  });

  it('wires artist, album, and track details through the shared history view', () => {
    const source = readFileSync(resolve('src/routes/explore/+page.svelte'), 'utf8');

    expect(source).toContain('getProfileEntityHistory');
    expect(source).toContain('getProfileAlbumTopTracks');
    expect(source).toContain('<ListeningHistoryChart');
    expect(source).toContain('<CoverWall items={albumCovers} trimIncompleteRows={false} />');
    expect(source).not.toContain("if (entityType === 'artist' && entityId)");
  });

  it('keeps album aggregation on the safe public read surface', () => {
    const migration = readFileSync(
      resolve('supabase/migrations/20260825004633_public_profile_album_top_tracks.sql'),
      'utf8'
    );

    expect(migration).toContain('security invoker');
    expect(migration).toContain('public.public_profile_rollup_daily_entity_stats');
    expect(migration).toContain('revoke all on function public.public_profile_album_top_tracks');
    expect(migration).toContain('to anon, authenticated');
    expect(migration).not.toContain('listening_events');
  });
});
