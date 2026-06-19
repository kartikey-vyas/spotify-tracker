import { createServiceClient, refreshPublicStats } from './lib/supabase-admin.js';

function parseDates(args: string[]): string[] | null {
  if (args.length === 0) return null;

  for (const arg of args) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      throw new Error(`Invalid date "${arg}". Expected YYYY-MM-DD.`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const targetDates = parseDates(process.argv.slice(2));
  await refreshPublicStats(createServiceClient(), targetDates);
  console.log(
    JSON.stringify(
      {
        refreshed: targetDates ?? 'all'
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
