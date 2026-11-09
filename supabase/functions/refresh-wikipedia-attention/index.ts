// Links played artists to English Wikipedia articles and fetches their monthly
// page views, a bounded slice per call. pg_cron calls it every 15 minutes; the
// work lists and the multiplier formula live in the database
// (20261109120000_wikipedia_attention.sql).

import { adminClient, assertServiceRequest } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/http.ts';
import { WikimediaClient, runWikipediaAttentionBatch } from '../_shared/wikipedia-attention.ts';

const DEFAULT_BUDGET_SECONDS = 100;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });

  try {
    assertServiceRequest(req);
    const body = (await req.json().catch(() => ({}))) as { budget_seconds?: unknown };
    const requested = Number(body.budget_seconds);
    const budgetSeconds = Number.isFinite(requested) ? Math.min(Math.max(requested, 30), 300) : DEFAULT_BUDGET_SECONDS;
    const supabase = adminClient();
    const counts = await runWikipediaAttentionBatch(supabase, new WikimediaClient(), {
      deadline: Date.now() + budgetSeconds * 1000
    });
    const { data: progress } = await supabase.rpc('wikipedia_attention_progress');
    console.log(JSON.stringify({ ...counts, progress }));
    return json({ ...counts, progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return errorJson(message, message === 'Invalid service credential' ? 401 : 500);
  }
});
