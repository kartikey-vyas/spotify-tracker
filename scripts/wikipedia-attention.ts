// Runs the Wikipedia page-view fetcher from a laptop until nothing is left.
// Use it for the first backfill (about 3k articles, close to an hour at the
// paced rate); the refresh-wikipedia-attention Edge Function keeps it current
// after that. Do not run it while a large hosted backlog is in progress.
//
//   pnpm wikipedia:attention            # run until done
//   pnpm wikipedia:attention --status   # print progress only

import { pathToFileURL } from 'node:url';
import { createServiceClient, throwIfSupabaseError } from './lib/supabase-admin.js';
import {
  WikimediaClient,
  runWikipediaAttentionBatch
} from '../supabase/functions/_shared/wikipedia-attention.ts';

const BATCH_SECONDS = 600;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const supabase = createServiceClient();
  const printProgress = async () => {
    const { data, error } = await supabase.rpc('wikipedia_attention_progress');
    throwIfSupabaseError(error, 'Loading Wikipedia progress failed');
    console.log(JSON.stringify({ progress: data }));
    return data as Record<string, number | string | null>;
  };

  if (argv.includes('--status')) {
    await printProgress();
    return;
  }

  const client = new WikimediaClient();
  for (let batch = 1; ; batch += 1) {
    const counts = await runWikipediaAttentionBatch(supabase, client, {
      deadline: Date.now() + BATCH_SECONDS * 1000,
      linkLimit: 2000,
      redirectLimit: 1000,
      pageviewLimit: 1000
    });
    console.log(JSON.stringify({ batch, ...counts }));
    const progress = await printProgress();
    const pending =
      Number(progress.artists_to_link) +
      Number(progress.articles_to_check_redirects) +
      Number(progress.articles_to_fetch) +
      Number(progress.articles_with_stale_multipliers);
    if (pending === 0) break;
    if (!counts.stopped_for_time && counts.artists_linked + counts.articles_checked_for_moves + counts.articles_fetched === 0 && counts.multipliers_refreshed === null) {
      throw new Error('No progress made while work is pending; stopping.');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
