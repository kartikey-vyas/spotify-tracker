import { createServiceClient, throwIfSupabaseError } from './lib/supabase-admin.js';

type DbSizeReport = {
  database_size_pretty: string;
  database_size_bytes: number;
  largest_tables: Array<{
    table_name: string;
    total_size: string;
    table_size: string;
    index_size: string;
  }>;
  largest_indexes: Array<{
    table_name: string;
    index_name: string;
    idx_scan: number;
    index_size: string;
  }>;
  unused_indexes: Array<{
    table_name: string;
    index_name: string;
    index_size: string;
  }>;
};

function statusForBytes(bytes: number): 'ok' | 'warning' | 'concern' {
  const mb = bytes / 1024 / 1024;
  if (mb >= 425) return 'concern';
  if (mb >= 350) return 'warning';
  return 'ok';
}

async function main(): Promise<void> {
  const { data, error } = await createServiceClient().rpc('db_size_report');
  throwIfSupabaseError(error, 'Loading DB size report failed');
  const report = data as DbSizeReport;

  console.log(`Database size: ${report.database_size_pretty} (${statusForBytes(report.database_size_bytes)})`);
  console.log('\nLargest tables');
  for (const table of report.largest_tables) {
    console.log(`- ${table.table_name}: ${table.total_size} total, ${table.table_size} table, ${table.index_size} indexes`);
  }

  console.log('\nLargest indexes');
  for (const index of report.largest_indexes) {
    console.log(`- ${index.table_name}.${index.index_name}: ${index.index_size}, scans=${index.idx_scan}`);
  }

  console.log('\nUnused indexes');
  for (const index of report.unused_indexes) {
    console.log(`- ${index.table_name}.${index.index_name}: ${index.index_size}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
