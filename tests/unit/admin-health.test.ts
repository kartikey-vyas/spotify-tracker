import { describe, expect, it } from 'vitest';
import {
  capResetAt,
  classifySystemHealth,
  classifyUserHealth,
  enrichedInWindow,
  enrichmentProgress,
  enrichmentProgressLabel,
  formatDuration,
  gapDiagnosticLabel,
  isUserSyncStale,
  projectedDaysRemaining,
  runOutcomeLabel,
  runStatus,
  type AdminEnrichmentRun,
  type AdminSystemHealth,
  type AdminUserHealth
} from '../../src/lib/adminHealth.js';

const now = new Date('2026-06-22T00:00:00.000Z');

function isoMinutesAgo(minutes: number): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

function system(overrides: Partial<AdminSystemHealth> = {}): AdminSystemHealth {
  return {
    total_profiles: 2,
    public_profile_count: 1,
    private_profile_count: 1,
    connected_user_count: 1,
    sync_enabled_user_count: 1,
    stale_sync_user_count: 0,
    sync_error_user_count: 0,
    artist_count: 10,
    album_count: 20,
    track_count: 30,
    tracks_enriched: 30,
    tracks_unenriched: 0,
    tracks_missing_duration: 0,
    albums_missing_image: 0,
    artists_stale_or_unrefreshed: 0,
    metadata_last_success_at: isoMinutesAgo(10),
    metadata_last_error_at: null,
    metadata_last_error: null,
    cron_job_active: true,
    cron_last_run_at: isoMinutesAgo(10),
    cron_last_status: 'succeeded',
    cron_last_success_at: isoMinutesAgo(10),
    cron_recent_failures: 0,
    ...overrides
  };
}

function user(overrides: Partial<AdminUserHealth> = {}): AdminUserHealth {
  return {
    user_id: '00000000-0000-4000-8000-000000000001',
    slug: 'listener',
    display_name: 'Listener',
    is_public: true,
    onboarding_completed_at: isoMinutesAgo(120),
    onboarding_state: 'complete',
    spotify_connected: true,
    spotify_user_id: 'spotify-user',
    spotify_display_name: 'Listener',
    sync_enabled: true,
    connected_at: isoMinutesAgo(120),
    connection_last_error_at: null,
    connection_last_error: null,
    recently_played_last_success_at: isoMinutesAgo(20),
    recently_played_last_error_at: null,
    recently_played_last_error: null,
    recently_played_gap_risk: false,
    latest_exact_export_event_at: isoMinutesAgo(240),
    api_only_period_start: isoMinutesAgo(200),
    latest_stored_event_at: isoMinutesAgo(90),
    exact_play_count: 100,
    api_play_count: 10,
    total_play_count: 110,
    overview_generated_at: isoMinutesAgo(20),
    latest_rollup_updated_at: isoMinutesAgo(20),
    ...overrides
  };
}

describe('admin health helpers', () => {
  it('classifies a latest failed cron run as warning', () => {
    expect(
      classifySystemHealth(
        system({
          cron_last_run_at: isoMinutesAgo(5),
          cron_last_status: 'failed',
          cron_last_success_at: isoMinutesAgo(10),
          cron_recent_failures: 1
        }),
        now
      )
    ).toBe('warning');
  });

  it('classifies a cron success older than 30 minutes as warning', () => {
    expect(classifySystemHealth(system({ cron_last_success_at: isoMinutesAgo(31) }), now)).toBe('warning');
  });

  it('classifies a sync-enabled connected user stale over 60 minutes as critical', () => {
    const row = user({ recently_played_last_success_at: isoMinutesAgo(61) });
    expect(isUserSyncStale(row, now)).toBe(true);
    expect(classifyUserHealth(row, now)).toBe('critical');
  });

  it('treats disabled sync as paused instead of stale', () => {
    const row = user({ sync_enabled: false, recently_played_last_success_at: isoMinutesAgo(180) });
    expect(isUserSyncStale(row, now)).toBe(false);
    expect(classifyUserHealth(row, now)).toBe('paused');
  });

  it('does not warn only because there are no recent listening events', () => {
    expect(classifyUserHealth(user({ latest_stored_event_at: null }), now)).toBe('healthy');
  });

  it('keeps gap risk diagnostic unless paired with an error or staleness', () => {
    const gapOnly = user({ recently_played_gap_risk: true });
    expect(gapDiagnosticLabel(gapOnly)).not.toBe('none');
    expect(classifyUserHealth(gapOnly, now)).toBe('healthy');

    expect(
      classifyUserHealth(
        user({
          recently_played_gap_risk: true,
          recently_played_last_error_at: isoMinutesAgo(5),
          recently_played_last_error: 'Spotify failed'
        }),
        now
      )
    ).toBe('warning');
  });
});

describe('enrichmentProgress', () => {
  it('reports enriched, remaining and percent over the enrichable worklist', () => {
    const progress = enrichmentProgress(system({ tracks_enriched: 3478, tracks_unenriched: 22325 }));
    expect(progress).toEqual({
      enriched: 3478,
      remaining: 22325,
      total: 25803,
      percent: (3478 / 25803) * 100
    });
  });

  it('reports 100% when nothing is left to enrich', () => {
    expect(enrichmentProgress(system({ tracks_enriched: 30, tracks_unenriched: 0 })).percent).toBe(100);
  });

  it('avoids dividing by zero when there are no enrichable tracks', () => {
    const progress = enrichmentProgress(system({ tracks_enriched: 0, tracks_unenriched: 0 }));
    expect(progress.percent).toBe(0);
    expect(enrichmentProgressLabel(system({ tracks_enriched: 0, tracks_unenriched: 0 }))).toBe(
      'no enrichable tracks'
    );
  });

  it('formats the label with thousands separators and one decimal place', () => {
    expect(enrichmentProgressLabel(system({ tracks_enriched: 3478, tracks_unenriched: 22325 }))).toBe(
      '3,478 / 25,803 (13.5%)'
    );
  });
});

function run(overrides: Partial<AdminEnrichmentRun> = {}): AdminEnrichmentRun {
  return {
    id: 1,
    started_at: isoMinutesAgo(60),
    finished_at: isoMinutesAgo(58),
    trigger: 'schedule',
    requested_limit: 40,
    concurrency: 2,
    worklist_size: 40,
    enriched: 40,
    missing: 0,
    failed: 0,
    aborted: false,
    abort_retry_after_seconds: null,
    error: null,
    duration_seconds: 120,
    ...overrides
  };
}

describe('enrichment run telemetry', () => {
  it('sums enriched tracks only within the trailing window', () => {
    const runs = [
      run({ id: 1, started_at: isoMinutesAgo(30), enriched: 40 }),
      run({ id: 2, started_at: isoMinutesAgo(60 * 23), enriched: 25 }),
      run({ id: 3, started_at: isoMinutesAgo(60 * 30), enriched: 500 })
    ];
    expect(enrichedInWindow(runs, 24, now)).toBe(65);
  });

  it('projects remaining days from the observed rate', () => {
    expect(projectedDaysRemaining(1000, 100)).toBe(10);
    expect(projectedDaysRemaining(0, 0)).toBe(0);
  });

  it('returns null rather than infinity when nothing is being enriched', () => {
    expect(projectedDaysRemaining(1000, 0)).toBeNull();
  });

  it('surfaces the retry-after on a rate-capped run', () => {
    expect(runOutcomeLabel(run({ aborted: true, enriched: 12, abort_retry_after_seconds: 82_800 }))).toBe(
      'rate capped after 12, retry-after 23h'
    );
  });

  it('flags an unfinished run as critical and a capped run as warning', () => {
    expect(runStatus(run({ finished_at: null }))).toBe('critical');
    expect(runStatus(run({ aborted: true }))).toBe('warning');
    expect(runStatus(run())).toBe('healthy');
  });

  it('derives the cap reset from the most recent aborted run', () => {
    const capped = run({
      aborted: true,
      finished_at: isoMinutesAgo(60),
      abort_retry_after_seconds: 3600
    });
    expect(capResetAt([capped])?.toISOString()).toBe(now.toISOString());
  });

  it('ignores aborted runs with no retry-after header', () => {
    expect(capResetAt([run({ aborted: true, abort_retry_after_seconds: null })])).toBeNull();
  });

  it('formats durations across the ranges it renders', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(600)).toBe('10m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(82_800)).toBe('23h');
    expect(formatDuration(null)).toBe('n/a');
  });
});
