grant usage on schema public to anon, authenticated, service_role;

revoke all on table
  artists,
  albums,
  tracks,
  track_artists,
  artist_genres,
  listening_events,
  sync_state,
  rollup_daily_entity_stats,
  overview_cache,
  public_activity_recent
from anon, authenticated;

grant select on table
  artists,
  albums,
  tracks,
  track_artists,
  artist_genres,
  rollup_daily_entity_stats,
  overview_cache,
  public_activity_recent
to anon, authenticated;

grant select, insert, update, delete on table
  artists,
  albums,
  tracks,
  track_artists,
  artist_genres,
  listening_events,
  sync_state,
  rollup_daily_entity_stats,
  overview_cache,
  public_activity_recent
to service_role;

grant usage, select on all sequences in schema public to service_role;

alter table artists enable row level security;
alter table albums enable row level security;
alter table tracks enable row level security;
alter table track_artists enable row level security;
alter table artist_genres enable row level security;
alter table listening_events enable row level security;
alter table sync_state enable row level security;
alter table rollup_daily_entity_stats enable row level security;
alter table overview_cache enable row level security;
alter table public_activity_recent enable row level security;

drop policy if exists "Public read artists" on artists;
create policy "Public read artists"
  on artists for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read albums" on albums;
create policy "Public read albums"
  on albums for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read tracks" on tracks;
create policy "Public read tracks"
  on tracks for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read track artists" on track_artists;
create policy "Public read track artists"
  on track_artists for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read artist genres" on artist_genres;
create policy "Public read artist genres"
  on artist_genres for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read daily rollups" on rollup_daily_entity_stats;
create policy "Public read daily rollups"
  on rollup_daily_entity_stats for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read overview cache" on overview_cache;
create policy "Public read overview cache"
  on overview_cache for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read recent activity" on public_activity_recent;
create policy "Public read recent activity"
  on public_activity_recent for select
  to anon, authenticated
  using (true);

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
