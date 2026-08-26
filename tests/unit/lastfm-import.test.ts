import { describe, expect, it } from 'vitest';
import {
  buildLastFmImportBatch,
  MAX_SIMILAR_TRACKS,
  normalizeLastFmTag
} from '../../scripts/lib/lastfm-import.js';

const RECORDING_MBID = '11111111-1111-4111-8111-111111111111';
const ARTIST_MBID = '22222222-2222-4222-8222-222222222222';

function capture(method: string, data: unknown, fetchedAt = '2026-08-26T03:00:00.000Z') {
  return {
    method,
    params: {},
    fetched_at: fetchedAt,
    http_status: 200,
    ok: true,
    data,
    error: null
  };
}

function reportFixture(): unknown {
  return {
    generated_at: '2026-08-26T02:00:00.000Z',
    tracks: [
      {
        source: {
          id: 11,
          name: 'Source title',
          duration_ms: 210_000,
          album: { id: 31, name: 'Source album' },
          artists: [{ id: 21, name: 'Source artist', artist_order: 0 }]
        },
        musicbrainz: {
          fetched_at: '2026-08-26T02:30:00.000Z',
          ok: true,
          candidates: [
            {
              mbid: RECORDING_MBID,
              title: 'Source title',
              artistMbids: [ARTIST_MBID],
              artistNames: ['Source artist'],
              durationMs: 209_900,
              durationDeltaMs: 100,
              score: 105,
              confidence: 'high',
              ambiguous: false,
              reasons: ['exact title']
            }
          ],
          selected: {
            mbid: RECORDING_MBID,
            artistMbids: [ARTIST_MBID],
            artistNames: ['Source artist']
          }
        },
        lastfm: {
          // These deliberately disagree with the name lookup. The spike proved
          // Last.fm recording-MBID routing unreliable, so imports ignore them.
          by_mbid: [capture('track.getInfo', { track: { name: 'Wrong MBID result' } })],
          by_name: [
            capture('track.getInfo', {
              track: {
                name: 'Canonical title',
                mbid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                duration: '999999',
                url: 'https://www.last.fm/music/Source+artist/_/Canonical+title',
                listeners: '1234',
                playcount: '5678',
                artist: { name: 'Source artist' },
                wiki: { published: '1 Jan 2020, 00:00', summary: '<p>Summary</p>' }
              }
            }),
            capture('track.getTopTags', {
              toptags: { tag: [{ name: 'Hip-Hop', count: '100' }, { name: 'hip hop', count: '80' }] }
            }),
            capture('track.getSimilar', {
              similartracks: {
                track: Array.from({ length: MAX_SIMILAR_TRACKS + 5 }, (_, index) => ({
                  name: `Related ${index + 1}`,
                  mbid: `ignored-${index + 1}`,
                  duration: 999,
                  playcount: String(1000 - index),
                  match: 1 - index / 100,
                  url: `https://last.fm/related-${index + 1}`,
                  artist: { name: `Artist ${index + 1}` }
                }))
              }
            })
          ]
        }
      }
    ],
    artists: [
      {
        identity: { mbid: ARTIST_MBID, name: 'Source artist' },
        calls: [
          capture('artist.getInfo', {
            artist: {
              name: 'Source artist',
              url: 'https://last.fm/source-artist',
              stats: { listeners: '100', playcount: '900' },
              bio: { summary: '<p>Artist bio</p>' }
            }
          }),
          capture('artist.getTopTags', { toptags: { tag: [{ name: 'R&B', count: 100 }] } })
        ]
      }
    ],
    albums: [
      {
        identity: { artist: 'Source artist', album: 'Source album' },
        calls: [
          capture('album.getInfo', {
            album: {
              name: 'Source album',
              artist: 'Source artist',
              url: 'https://last.fm/source-album',
              listeners: '50',
              playcount: '300'
            }
          }),
          capture('album.getTopTags', { toptags: { tag: [{ name: 'Neo-Soul', count: 75 }] } })
        ]
      }
    ]
  };
}

describe('Last.fm report projection', () => {
  it('normalizes punctuation variants without treating arbitrary raw tags as genres', () => {
    expect(normalizeLastFmTag('  Expérimental Hip-Hop ')).toBe('experimental hip hop');
    expect(normalizeLastFmTag('R&B')).toBe('r and b');
  });

  it('keeps selected fields from name lookups and caps similar tracks', () => {
    const batch = buildLastFmImportBatch(reportFixture());

    expect(batch).toMatchObject({
      trackIds: [11],
      artistIds: [21],
      albumIds: [31],
      musicbrainzTrackIds: [11],
      tagTrackIds: [11],
      tagArtistIds: [21],
      tagAlbumIds: [31],
      similarityTrackIds: [11],
      genreArtistIds: [21],
      warnings: []
    });
    expect(batch.musicbrainzMatches).toEqual([
      expect.objectContaining({ track_id: 11, recording_mbid: RECORDING_MBID, is_selected: true })
    ]);

    const trackMetadata = batch.metadata.find((row) => row.track_id === 11);
    expect(trackMetadata).toMatchObject({
      canonical_name: 'Canonical title',
      canonical_artist_name: 'Source artist',
      source_url: 'https://www.last.fm/music/Source+artist/_/Canonical+title',
      summary_html: '<p>Summary</p>',
      match_method: 'name'
    });
    expect(trackMetadata).not.toHaveProperty('duration');
    expect(trackMetadata).not.toHaveProperty('duration_ms');
    expect(trackMetadata).not.toHaveProperty('mbid');
    expect(batch.stats.find((row) => row.track_id === 11)).toMatchObject({ listeners: 1234, playcount: 5678 });

    expect(batch.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ track_id: 11, raw_tag: 'Hip-Hop', normalized_tag: 'hip hop', weight: 100 }),
        expect.objectContaining({ artist_id: 21, raw_tag: 'R&B', normalized_tag: 'r and b' }),
        expect.objectContaining({ album_id: 31, raw_tag: 'Neo-Soul', normalized_tag: 'neo soul' })
      ])
    );

    expect(MAX_SIMILAR_TRACKS).toBe(20);
    expect(batch.similarities).toHaveLength(20);
    expect(batch.similarities[0]).toMatchObject({
      rank: 1,
      related_artist_name: 'Artist 1',
      related_track_name: 'Related 1',
      source_playcount: 1000
    });
    expect(batch.similarities[19]?.rank).toBe(20);
    expect(batch.similarities[0]).not.toHaveProperty('mbid');
    expect(batch.similarities[0]).not.toHaveProperty('duration');
  });

  it('does not mark failed provider calls for destructive replacement', () => {
    const report = reportFixture() as {
      tracks: Array<{
        musicbrainz: { ok: boolean; candidates: unknown[] };
        lastfm: { by_name: Array<{ method: string; ok: boolean }> };
      }>;
      artists: Array<{ calls: Array<{ method: string; ok: boolean }> }>;
      albums: Array<{ calls: Array<{ method: string; ok: boolean }> }>;
    };
    report.tracks[0]!.musicbrainz.ok = false;
    report.tracks[0]!.musicbrainz.candidates = [];
    for (const call of report.tracks[0]!.lastfm.by_name) {
      if (call.method === 'track.getTopTags' || call.method === 'track.getSimilar') call.ok = false;
    }
    report.artists[0]!.calls.find((call) => call.method === 'artist.getTopTags')!.ok = false;
    report.albums[0]!.calls.find((call) => call.method === 'album.getTopTags')!.ok = false;

    const batch = buildLastFmImportBatch(report);

    expect(batch.trackIds).toEqual([11]);
    expect(batch.musicbrainzTrackIds).toEqual([]);
    expect(batch.tagTrackIds).toEqual([]);
    expect(batch.tagArtistIds).toEqual([]);
    expect(batch.tagAlbumIds).toEqual([]);
    expect(batch.similarityTrackIds).toEqual([]);
    expect(batch.genreArtistIds).toEqual([]);
  });
});
