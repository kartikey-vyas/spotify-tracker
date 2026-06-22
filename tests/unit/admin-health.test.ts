import { describe, expect, it } from 'vitest';
import {
  classifySystemHealth,
  classifyUserHealth,
  gapDiagnosticLabel,
  isUserSyncStale,
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
    total_invite_count: 0,
    pending_invite_count: 0,
    accepted_invite_count: 0,
    expired_invite_count: 0,
    exhausted_invite_count: 0,
    artist_count: 10,
    album_count: 20,
    track_count: 30,
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
