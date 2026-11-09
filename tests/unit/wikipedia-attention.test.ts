import { describe, expect, it } from 'vitest';
import {
  PAGEVIEWS_START,
  addMonths,
  buildMonthlySeries,
  isSameSubjectTitle,
  lastCompleteMonth,
  monthRange,
  pageviewTimestamp,
  parsePageviewItems,
  pickWikidataMatches,
  retryAfterMs
} from '../../supabase/functions/_shared/wikipedia-attention.ts';

describe('months', () => {
  it('adds months across year ends in both directions', () => {
    expect(addMonths('2025-12-01', 1)).toBe('2026-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonths('2015-07-01', 24)).toBe('2017-07-01');
  });

  it('takes the month before the current one as the last complete month', () => {
    expect(lastCompleteMonth(new Date('2026-11-01T00:00:00Z'))).toBe('2026-10-01');
    expect(lastCompleteMonth(new Date('2026-01-31T23:59:59Z'))).toBe('2025-12-01');
  });

  it('lists months inclusively and returns nothing for a reversed range', () => {
    expect(monthRange('2025-11-01', '2026-02-01')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
    expect(monthRange('2026-02-01', '2026-01-01')).toEqual([]);
  });

  it('formats API timestamps for the first and last day of the month', () => {
    expect(pageviewTimestamp(PAGEVIEWS_START, 'start')).toBe('2015070100');
    expect(pageviewTimestamp('2026-10-01', 'end')).toBe('2026103100');
    expect(pageviewTimestamp('2024-02-01', 'end')).toBe('2024022900');
  });
});

describe('parsePageviewItems', () => {
  it('reads monthly items and treats a missing body as no data', () => {
    expect(
      parsePageviewItems({ items: [{ timestamp: '2015070100', views: 12 }, { timestamp: '2015080100', views: 0 }] })
    ).toEqual([
      { month: '2015-07-01', views: 12 },
      { month: '2015-08-01', views: 0 }
    ]);
    expect(parsePageviewItems(null)).toEqual([]);
  });
});

describe('buildMonthlySeries', () => {
  it('adds a former title to the current one and fills gaps with zeros', () => {
    const current = [{ month: '2016-03-01', views: 5 }, { month: '2016-05-01', views: 7 }];
    const former = [{ month: '2016-01-01', views: 100 }, { month: '2016-03-01', views: 1 }];
    expect(buildMonthlySeries([current, former], PAGEVIEWS_START, '2016-05-01', true)).toEqual({
      from: '2016-01-01',
      views: [100, 0, 6, 0, 7]
    });
  });

  it('starts at the requested month when appending, even with leading zeros', () => {
    expect(buildMonthlySeries([[{ month: '2026-10-01', views: 3 }]], '2026-09-01', '2026-10-01', false)).toEqual({
      from: '2026-09-01',
      views: [0, 3]
    });
  });

  it('is empty when no title has data, and ignores months outside the range', () => {
    expect(buildMonthlySeries([[], []], PAGEVIEWS_START, '2026-10-01', true)).toEqual({ from: null, views: [] });
    expect(
      buildMonthlySeries([[{ month: '2026-11-01', views: 9 }]], '2026-10-01', '2026-10-01', false)
    ).toEqual({ from: '2026-10-01', views: [0] });
  });
});

describe('pickWikidataMatches', () => {
  it('prefers an item with an English article, then the lowest Q number', () => {
    const picked = pickWikidataMatches([
      { spotifyId: 'a', qid: 'Q10', title: null },
      { spotifyId: 'a', qid: 'Q500', title: 'Artist A' },
      { spotifyId: 'b', qid: 'Q900', title: 'B (band)' },
      { spotifyId: 'b', qid: 'Q90', title: 'B (musician)' },
      { spotifyId: 'c', qid: 'Q7', title: null }
    ]);
    expect(picked.get('a')).toEqual({ qid: 'Q500', title: 'Artist A' });
    expect(picked.get('b')).toEqual({ qid: 'Q90', title: 'B (musician)' });
    expect(picked.get('c')).toEqual({ qid: 'Q7', title: null });
    expect(picked.has('d')).toBe(false);
  });
});

describe('isSameSubjectTitle', () => {
  it('accepts former titles and spellings of the same name', () => {
    expect(isSameSubjectTitle('Drake (rapper)', 'Drake (musician)')).toBe(true);
    expect(isSameSubjectTitle('SZA (singer)', 'SZA')).toBe(true);
    expect(isSameSubjectTitle('Tyler the Creator', 'Tyler, the Creator')).toBe(true);
    expect(isSameSubjectTitle('Beyonce', 'Beyoncé')).toBe(true);
    expect(isSameSubjectTitle('King gizzard & the lizard wizard', 'King Gizzard & the Lizard Wizard')).toBe(true);
  });

  it('rejects merged pages about something else, the article itself, and empty names', () => {
    expect(isSameSubjectTitle('Drake single discography', 'Drake (musician)')).toBe(false);
    expect(isSameSubjectTitle('Live in Praha (Radiohead album)', 'Radiohead')).toBe(false);
    expect(isSameSubjectTitle('Filthy Frank', 'Joji (musician)')).toBe(false);
    expect(isSameSubjectTitle('SZA', 'SZA')).toBe(false);
    expect(isSameSubjectTitle('$$', '¥$')).toBe(false);
  });
});

describe('retryAfterMs', () => {
  it('reads seconds and HTTP dates', () => {
    expect(retryAfterMs('6')).toBe(6000);
    expect(retryAfterMs('Mon, 09 Nov 2026 00:00:10 GMT', Date.parse('2026-11-09T00:00:00Z'))).toBe(10_000);
    expect(retryAfterMs(null)).toBeNull();
  });
});
