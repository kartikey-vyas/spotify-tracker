import { describe, expect, it } from 'vitest';
import {
  lookupMusicBrainzByIsrc,
  normalizeIsrc,
  scoreMusicBrainzRecordings,
  type MusicBrainzRecording
} from '../../scripts/lib/musicbrainz.js';

describe('MusicBrainz ISRC lookup', () => {
  it('normalizes formatted ISRCs and rejects invalid values', () => {
    expect(normalizeIsrc('GB-AHT-16-00302')).toBe('GBAHT1600302');
    expect(normalizeIsrc('not-an-isrc')).toBeNull();
  });

  it('uses the ISRC endpoint with the required identifying User-Agent', async () => {
    const calls: Array<Parameters<typeof fetch>> = [];
    const fetchMock: typeof fetch = async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ isrc: 'GBAHT1600302', recordings: [] }));
    };

    await lookupMusicBrainzByIsrc('GB-AHT-16-00302', {
      userAgent: 'musik-test/1.0 (test@example.com)',
      fetchImpl: fetchMock
    });

    const [url, options] = calls[0]!;
    expect(String(url)).toContain('/ws/2/isrc/GBAHT1600302?');
    const requested = new URL(String(url));
    expect(requested.searchParams.get('fmt')).toBe('json');
    expect(requested.searchParams.get('inc')).toBe('artist-credits');
    expect(options?.headers).toMatchObject({ 'User-Agent': 'musik-test/1.0 (test@example.com)' });
  });
});

describe('MusicBrainz recording match scoring', () => {
  const recordings: MusicBrainzRecording[] = [
    {
      id: 'wrong-artist',
      title: 'Believe',
      length: 239_000,
      'artist-credit': [{ artist: { id: 'artist-1', name: 'Someone Else' } }]
    },
    {
      id: 'best',
      title: 'Believe',
      length: 238_500,
      'artist-credit': [{ artist: { id: 'artist-2', name: 'Chér' } }]
    }
  ];

  it('prefers matching title, artist and duration rather than the first ISRC result', () => {
    const matches = scoreMusicBrainzRecordings(
      { name: 'Believe', durationMs: 239_000, artistNames: ['Cher'] },
      recordings
    );

    expect(matches[0]).toMatchObject({ mbid: 'best', score: 100, confidence: 'high', ambiguous: false });
    expect(matches[0].artistMbids).toEqual(['artist-2']);
  });

  it('marks near-tied candidates as ambiguous', () => {
    const matches = scoreMusicBrainzRecordings(
      { name: 'Believe', durationMs: 239_000, artistNames: ['Cher'] },
      [recordings[1], { ...recordings[1], id: 'also-plausible', length: 240_500 }]
    );

    expect(matches[0].ambiguous).toBe(true);
  });

  it('matches Spotify featured-artist title decoration to MusicBrainz artist credits', () => {
    const matches = scoreMusicBrainzRecordings(
      {
        name: 'Instant Crush (feat. Julian Casablancas)',
        durationMs: 337_560,
        artistNames: ['Daft Punk', 'Julian Casablancas']
      },
      [
        {
          id: 'atmos',
          title: 'Instant Crush',
          length: 337_560,
          'artist-credit': [{ artist: { id: 'daft-punk', name: 'Daft Punk' } }]
        },
        {
          id: 'album',
          title: 'Instant Crush',
          length: 337_000,
          'artist-credit': [{ artist: { id: 'daft-punk', name: 'Daft Punk' } }]
        }
      ]
    );

    expect(matches[0]).toMatchObject({ mbid: 'atmos', confidence: 'high', ambiguous: false });
    expect(matches[0].reasons).toContain('title matches after featured-artist suffix');
  });
});
