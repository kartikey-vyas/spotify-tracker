import { pathToFileURL } from 'node:url';
import { createServiceClient, throwIfSupabaseError } from './lib/supabase-admin.js';

export async function main(): Promise<void> {
  const supabase = createServiceClient();
  const [{ data: progress, error: progressError }, { data: runs, error: runsError }] = await Promise.all([
    supabase.rpc('external_music_enrichment_progress'),
    supabase
      .from('external_music_enrichment_runs')
      .select('id,started_at,finished_at,requested_limit,claimed,succeeded,retried,dead,warnings,error')
      .order('started_at', { ascending: false })
      .limit(10)
  ]);
  throwIfSupabaseError(progressError, 'Loading external enrichment progress failed');
  throwIfSupabaseError(runsError, 'Loading external enrichment runs failed');
  console.log(JSON.stringify({ progress: progress ?? [], recent_runs: runs ?? [] }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
