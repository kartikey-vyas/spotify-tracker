import { describe, expect, it } from 'vitest';
import {
  bandFor,
  bandTicks,
  buildStrip,
  buildYearSeries,
  formatLift,
  formatListeners,
  hasHourTags,
  hourRange,
  MIN_COVERAGE,
  MIN_COVERED_PLAYS,
  POPULARITY_BANDS,
  reliableMedian,
  scalePosition,
  SCALE_MAX,
  SCALE_MIN
} from '../../src/lib/insights.js';
import type { HourTagBucket, PopularitySummary } from '../../src/lib/types.js';

const summary = (median: number | null, covered = 1000, plays = covered): PopularitySummary => ({
  median_artist_listeners: median,
  plays,
  covered_plays: covered
});

describe('bandFor', () => {
  it('puts each boundary in the band above it and the value below it in the band below', () => {
    for (let index = 0; index < POPULARITY_BANDS.length - 1; index += 1) {
      const band = POPULARITY_BANDS[index];
      expect(bandFor(band.below - 1)).toBe(band.label);
      expect(bandFor(band.below)).toBe(POPULARITY_BANDS[index + 1].label);
    }
  });

  it('covers zero and very large counts', () => {
    expect(bandFor(0)).toBe(POPULARITY_BANDS[0].label);
    expect(bandFor(Number.MAX_SAFE_INTEGER)).toBe(POPULARITY_BANDS[POPULARITY_BANDS.length - 1].label);
  });
});

describe('reliableMedian', () => {
  it('returns the median when coverage and volume are enough', () => {
    expect(reliableMedian(summary(1234, MIN_COVERED_PLAYS))).toBe(1234);
  });

  it('hides a median backed by too few plays', () => {
    expect(reliableMedian(summary(1234, MIN_COVERED_PLAYS - 1))).toBeNull();
  });

  it('hides a median when too small a share of plays is covered', () => {
    const plays = 1000;
    const justEnough = Math.ceil(plays * MIN_COVERAGE);
    expect(reliableMedian(summary(1234, justEnough, plays))).toBe(1234);
    expect(reliableMedian(summary(1234, justEnough - 1, plays))).toBeNull();
  });

  it('handles a missing window or median', () => {
    expect(reliableMedian(null)).toBeNull();
    expect(reliableMedian(undefined)).toBeNull();
    expect(reliableMedian(summary(null))).toBeNull();
    expect(reliableMedian(summary(1234, 0, 0))).toBeNull();
  });
});

describe('formatListeners', () => {
  it.each([
    [950, '950'],
    [1_288, '1.3k'],
    [18_964, '19k'],
    [136_076, '136k'],
    [999_950, '1M'],
    [1_289_568, '1.3M'],
    [2_000_000, '2M'],
    [13_400_000, '13M']
  ])('%d → %s', (count, text) => {
    expect(formatListeners(count)).toBe(text);
  });
});

describe('scalePosition', () => {
  it('maps the axis ends to 0 and 1 and clamps outside them', () => {
    expect(scalePosition(SCALE_MIN)).toBe(0);
    expect(scalePosition(SCALE_MAX)).toBe(1);
    expect(scalePosition(SCALE_MIN / 10)).toBe(0);
    expect(scalePosition(SCALE_MAX * 10)).toBe(1);
  });

  it('is logarithmic: equal ratios are equal distances', () => {
    const a = scalePosition(SCALE_MIN * 10) - scalePosition(SCALE_MIN);
    const b = scalePosition(SCALE_MIN * 100) - scalePosition(SCALE_MIN * 10);
    expect(a).toBeCloseTo(b, 10);
  });

  it('places a tick at every band boundary inside the axis', () => {
    const inside = POPULARITY_BANDS.filter((band) => band.below > SCALE_MIN && band.below < SCALE_MAX);
    expect(bandTicks().map((tick) => tick.listeners)).toEqual(inside.map((band) => band.below));
  });
});

describe('buildStrip', () => {
  it('drops unreliable profiles, sorts most underground first and marks the selection', () => {
    const strip = buildStrip(
      [
        { slug: 'b', display_name: 'B', all_time: summary(2_000_000) },
        { slug: 'a', display_name: 'A', all_time: summary(100_000) },
        { slug: 'c', display_name: 'C', all_time: summary(500_000, MIN_COVERED_PLAYS - 1) },
        { slug: 'd', display_name: 'D', all_time: null }
      ],
      'b'
    );
    expect(strip.map((entry) => entry.slug)).toEqual(['a', 'b']);
    expect(strip.map((entry) => entry.selected)).toEqual([false, true]);
    expect(strip[0].band).toBe(bandFor(100_000));
  });
});

describe('buildYearSeries', () => {
  it('keeps reliable years in order with heights relative to the highest year', () => {
    const series = buildYearSeries([
      { year: 2020, ...summary(1_000_000) },
      { year: 2018, ...summary(2_000_000) },
      { year: 2014, ...summary(4_000_000, MIN_COVERED_PLAYS - 1) }
    ]);
    expect(series.map((bar) => bar.year)).toEqual([2018, 2020]);
    expect(series.map((bar) => bar.fraction)).toEqual([1, 0.5]);
  });

  it('marks exactly one lowest year, the earliest on a tie', () => {
    const series = buildYearSeries([
      { year: 2019, ...summary(500_000) },
      { year: 2021, ...summary(500_000) },
      { year: 2020, ...summary(900_000) }
    ]);
    expect(series.filter((bar) => bar.lowest).map((bar) => bar.year)).toEqual([2019]);
  });

  it('returns nothing when no year is reliable', () => {
    expect(buildYearSeries([{ year: 2020, ...summary(null) }])).toEqual([]);
  });
});

describe('hour tag helpers', () => {
  const bucket = (labels: HourTagBucket['labels']): HourTagBucket => ({
    part: 'night',
    first_hour: 21,
    last_hour: 23,
    plays: 500,
    labels
  });

  it('formats the part as a half-open clock range', () => {
    expect(hourRange({ first_hour: 5, last_hour: 8 })).toBe('05–09');
    expect(hourRange({ first_hour: 21, last_hour: 23 })).toBe('21–24');
  });

  it('formats lift to one decimal', () => {
    expect(formatLift(1.97)).toBe('2.0×');
    expect(formatLift(1.34)).toBe('1.3×');
  });

  it('knows when any part has something to show', () => {
    expect(hasHourTags(null)).toBe(false);
    expect(hasHourTags([bucket([])])).toBe(false);
    expect(hasHourTags([bucket([]), bucket([{ label: 'jazz hop', plays: 40, lift: 1.8 }])])).toBe(true);
  });
});
