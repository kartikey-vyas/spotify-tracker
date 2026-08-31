import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/20260831094058_resume_external_metadata_enrichment_cron.sql'),
  'utf8'
);

describe('hosted external enrichment schedule', () => {
  it('runs a bounded batch every five minutes', () => {
    expect(migration).toContain('body := \'{"batch_size":20,"lease_seconds":600}\'::jsonb');
    expect(migration).toContain("'2,7,12,17,22,27,32,37,42,47,52,57 * * * *'");
  });

  it('prioritizes provider-actionable work before play count', () => {
    expect(migration).toContain(
      'order by ready.provider_blocked_rank, ready.priority_plays desc, ready.id'
    );
    expect(migration).toContain("last_result #>> '{endpoints,track.similar,status}'");
  });

  it('requeues only MusicBrainz outage dead letters while preserving partial results', () => {
    expect(migration).toContain("where status = 'dead'\n  and last_error like 'musicbrainz:%'");
    expect(migration).not.toContain("last_result = '{}'::jsonb");
  });
});
