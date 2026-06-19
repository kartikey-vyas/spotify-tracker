select
  pg_size_pretty(pg_database_size(current_database())) as database_size;

select
  schemaname,
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)) as total_size,
  pg_size_pretty(pg_relation_size(format('%I.%I', schemaname, relname)::regclass)) as table_size,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) - pg_relation_size(format('%I.%I', schemaname, relname)::regclass)) as index_size
from pg_stat_user_tables
order by pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) desc
limit 20;

select
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
order by pg_relation_size(indexrelid) desc
limit 20;
