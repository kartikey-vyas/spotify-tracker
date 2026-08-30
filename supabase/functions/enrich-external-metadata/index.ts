// Resumable MusicBrainz + Last.fm enrichment, normally driven by pg_cron.
// The database owns claiming, leases, retries and telemetry; this function
// performs a small serial batch with bounded provider pacing.

import { adminClient, assertServiceRequest } from '../_shared/supabase.ts';
import { requireEnv } from '../_shared/env.ts';
import { errorJson, json } from '../_shared/http.ts';
import { previousResult } from '../_shared/external-music-enrichment.ts';
import type { ExternalMusicWorkItem } from '../_shared/external-music-persistence.ts';
import {
  DEFAULT_EXTERNAL_BATCH_SIZE,
  DEFAULT_EXTERNAL_LEASE_SECONDS,
  DEFAULT_MUSICBRAINZ_USER_AGENT,
  LASTFM_DELAY_MS,
  MUSICBRAINZ_DELAY_MS,
  ProviderPacer,
  clampInteger,
  processExternalMusicItem,
  type ExternalMusicItemOutcome,
  type ExternalMusicProviderCircuit
} from '../_shared/external-music-worker.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });

  let workerToken: string | null = null;
  let runId: number | null = null;
  let supabase: ReturnType<typeof adminClient> | null = null;
  const counts = { claimed: 0, succeeded: 0, retried: 0, dead: 0, warnings: 0 };
  let runError: string | null = null;

  try {
    assertServiceRequest(req);
    const body = (await req.json().catch(() => ({}))) as { batch_size?: unknown; lease_seconds?: unknown };
    const batchSize = clampInteger(body.batch_size, DEFAULT_EXTERNAL_BATCH_SIZE, 1, 20);
    const leaseSeconds = clampInteger(body.lease_seconds, DEFAULT_EXTERNAL_LEASE_SECONDS, 60, 600);
    const lastFmApiKey = requireEnv('LASTFM_API_KEY');
    const musicBrainzUserAgent = Deno.env.get('MUSICBRAINZ_USER_AGENT') || DEFAULT_MUSICBRAINZ_USER_AGENT;
    supabase = adminClient();

    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_external_music_enrichment_batch', {
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds
    });
    if (claimError) throw new Error(`Claiming external enrichment work failed: ${claimError.message}`);
    const items = (claimedRows ?? []) as ExternalMusicWorkItem[];
    if (items.length === 0) {
      const { data: progress } = await supabase.rpc('external_music_enrichment_progress');
      return json({ ...counts, busy_or_empty: true, progress: progress ?? [] });
    }

    workerToken = items[0].worker_token;
    counts.claimed = items.length;
    const { data: runRow, error: runInsertError } = await supabase
      .from('external_music_enrichment_runs')
      .insert({ requested_limit: batchSize, claimed: items.length })
      .select('id')
      .single();
    if (runInsertError) console.warn(`Creating external enrichment run failed: ${runInsertError.message}`);
    runId = (runRow as { id: number } | null)?.id ?? null;

    const musicBrainzPacer = new ProviderPacer(MUSICBRAINZ_DELAY_MS);
    const lastFmPacer = new ProviderPacer(LASTFM_DELAY_MS);
    const circuit: ExternalMusicProviderCircuit = { musicbrainz: null, lastfm: null };
    for (const item of items) {
      let outcome: ExternalMusicItemOutcome;
      try {
        outcome = await processExternalMusicItem(
          supabase,
          item,
          lastFmApiKey,
          musicBrainzUserAgent,
          musicBrainzPacer,
          lastFmPacer,
          circuit
        );
      } catch (error) {
        outcome = {
          result: previousResult(item.last_result),
          succeeded: false,
          error: error instanceof Error ? error.message : String(error),
          retryAfterSeconds: 300,
          consumeAttempt: true,
          warnings: 1
        };
      }

      const { data: finishStatus, error: finishError } = await supabase.rpc(
        'finish_external_music_enrichment_item',
        {
          p_queue_id: item.queue_id,
          p_worker_token: item.worker_token,
          p_succeeded: outcome.succeeded,
          p_error: outcome.error,
          p_retry_after_seconds: outcome.retryAfterSeconds,
          p_result: outcome.result,
          p_consume_attempt: outcome.consumeAttempt
        }
      );
      if (finishError) {
        counts.warnings += 1;
        console.warn(`Finishing queue item ${item.queue_id} failed: ${finishError.message}`);
      } else if (finishStatus === 'succeeded') {
        counts.succeeded += 1;
      } else if (finishStatus === 'dead') {
        counts.dead += 1;
      } else {
        counts.retried += 1;
      }
      counts.warnings += outcome.warnings;
    }

    const { data: progress } = await supabase.rpc('external_music_enrichment_progress');
    return json({ ...counts, busy_or_empty: false, progress: progress ?? [] });
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    return errorJson(runError, runError === 'Invalid service credential' ? 401 : 500);
  } finally {
    if (workerToken && supabase) {
      const { error } = await supabase.rpc('release_external_music_enrichment_worker', {
        p_worker_token: workerToken
      });
      if (error) console.warn(`Releasing external enrichment worker failed: ${error.message}`);
    }
    if (runId !== null && supabase) {
      const { error } = await supabase
        .from('external_music_enrichment_runs')
        .update({
          finished_at: new Date().toISOString(),
          succeeded: counts.succeeded,
          retried: counts.retried,
          dead: counts.dead,
          warnings: counts.warnings,
          error: runError
        })
        .eq('id', runId);
      if (error) console.warn(`Finishing external enrichment run failed: ${error.message}`);
    }
  }
});
