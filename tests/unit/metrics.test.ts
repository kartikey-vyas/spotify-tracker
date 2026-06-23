import { describe, expect, it } from 'vitest';
import { bestAvailableMetric, overviewSummaryCards, summaryValue } from '../../src/lib/metrics.js';
import type { OverviewPayload, RankingRow } from '../../src/lib/types.js';

function row(partial: Partial<RankingRow> & Pick<RankingRow, 'entity_id' | 'entity_name'>): RankingRow {
  return {
    minutes: 0,
    plays: 0,
    qualified_plays: 0,
    unique_tracks: 0,
    skipped_count: 0,
    known_skip_count: 0,
    unknown_duration_plays: 0,
    ...partial
  };
}

describe('summaryValue', () => {
  it('always reports plays, never minutes', () => {
    expect(summaryValue(0)).toBe('0 plays');
    expect(summaryValue(1234)).toBe('1,234 plays');
  });
});

describe('bestAvailableMetric', () => {
  it("returns plays when asked, even if some rows carry minutes", () => {
    // The recent-window case: backfilled rows have minutes, API rows do not.
    const rows = [
      row({ entity_id: '1', entity_name: 'MGMT', plays: 10, unknown_duration_plays: 10 }),
      row({ entity_id: '2', entity_name: 'Denzel Curry', plays: 5, minutes: 11.2 })
    ];
    expect(bestAvailableMetric(rows, 'plays')).toBe('plays');
  });
});

describe('overviewSummaryCards', () => {
  it('sums plays across top artists for each window', () => {
    const overview = {
      this_week: {
        minutes: 999,
        top_artists: [
          row({ entity_id: '1', entity_name: 'Radiohead', plays: 25 }),
          row({ entity_id: '2', entity_name: 'MGMT', plays: 10 })
        ]
      },
      last_30_days: {
        minutes: 999,
        top_artists: [row({ entity_id: '1', entity_name: 'Radiohead', plays: 40 })]
      }
    } as unknown as OverviewPayload;

    const cards = overviewSummaryCards(overview);
    expect(cards[0]).toMatchObject({ label: 'Last 7 days', value: '35 plays', detail: 'Radiohead' });
    expect(cards[1]).toMatchObject({ label: 'Last 30 days', value: '40 plays' });
  });
});
