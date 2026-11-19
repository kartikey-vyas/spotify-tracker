import { pathToFileURL } from 'node:url';
import { createServiceClient, throwIfSupabaseError } from './lib/supabase-admin.js';

export async function main(): Promise<void> {
  const supabase = createServiceClient();
  const [
    { data: progress, error: progressError },
    { data: snapshots, error: snapshotsError },
    { data: runs, error: runsError }
  ] = await Promise.all([
    supabase.rpc('external_music_enrichment_progress'),
    // Monthly Last.fm stats snapshots: queue status per requested month.
    supabase.rpc('external_music_stats_snapshot_progress'),
    supabase
      .from('external_music_enrichment_runs')
      .select('id,started_at,finished_at,requested_limit,claimed,succeeded,retried,dead,warnings,error')
      .order('started_at', { ascending: false })
      .limit(10)
  ]);
  throwIfSupabaseError(progressError, 'Loading external enrichment progress failed');
  throwIfSupabaseError(snapshotsError, 'Loading Last.fm stats snapshot progress failed');
  throwIfSupabaseError(runsError, 'Loading external enrichment runs failed');
  console.log(JSON.stringify({
    progress: progress ?? [],
    stats_snapshots: snapshots ?? [],
    recent_runs: runs ?? []
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
