# AGENTS.md

This file provides guidance to coding agents working in this repository.

## What this is

A static SvelteKit dashboard (deployed to GitHub Pages) for exploring public, read-only Spotify listening history across invited users. The governing rule is **public read, private write**: the browser only ever gets `PUBLIC_SUPABASE_URL` and a public Supabase key. Every write and every Spotify secret lives behind Supabase RLS or Edge Functions.

## Commands

Package manager is **pnpm** (Node >= 22). Scripts run under `tsx`. Python tooling uses **uv** for the Marimo/Polars backfill utilities.

```bash
pnpm dev          # local dev server
pnpm build        # static build into build/ (adapter-static)
pnpm check        # svelte-kit sync + svelte-check (app type checking)
pnpm typecheck    # tsc on scripts/ via tsconfig.scripts.json
pnpm test         # vitest run (tests/unit/*.test.ts)
pnpm verify       # all four of the above, fastest first — the pre-commit gate
uv run pytest     # Python tests for the backfill package
```

Run a single test: `pnpm vitest run tests/unit/dates.test.ts` (or `pnpm vitest -t "<name>"`).

`check` and `typecheck` cover **different** tsconfigs: `check` is the app (`src/`) and excludes `scripts/`, `typecheck` is only `scripts/`. A broken import in `scripts/` passes `check` and fails `typecheck`, so run both — that is what `pnpm verify` is for. `build` is in the gate too, because it runs the dev-route stripping step that `check` knows nothing about.

Beware piping a gate into `head`/`tail`: the pipeline's exit status is the last command's, so a failing run reads as success. Redirect to a file and check `$?` instead.

Operational CLIs (require `.env.local` with `SUPABASE_URL` + `SUPABASE_SECRET_KEY`):

```bash
pnpm invite friend@example.com --site-url=https://kartikey-vyas.github.io/spotify-tracker/app/
uv run marimo edit notebooks/spotify_extended_history_explore.py
uv run python -m backfill.clean --input my_spotify_data.zip --out analysis/out --cutoff-iso '<timestamp>'
pnpm import:spotify-export --user-id=<auth-user-uuid> analysis/out/cleaned_*.json
pnpm db:size
```

`spotify:auth` and `sync:recently-played` are **legacy single-user / manual** commands. Do not use them for the current public homepage — current sync is the `sync-due-users` Edge Function. `enrich:metadata` remains useful after large imports to backfill Spotify metadata and refresh affected user rollups.

## Four separate runtimes — do not mix them

This repo has three TypeScript environments plus local Python tooling with different module systems and env access. Code does not cross between them.

1. **Browser app** (`src/`) — SvelteKit + Svelte 5, prerendered. Reads env via `$env/dynamic/public`, talks to Supabase only through the public client in `src/lib/supabase.ts` (nullable — every query guards `if (!supabase) return null`). Type checked with `pnpm check`.
2. **Node scripts** (`scripts/`) — `tsx`, ESM, service-key access. Env loaded from `.env.local`/`.env` via `scripts/lib/env.ts`; Supabase admin client in `scripts/lib/supabase-admin.ts`. Type checked with `pnpm typecheck` (`tsconfig.scripts.json`).
3. **Supabase Edge Functions** (`supabase/functions/`) — **Deno**, `npm:`/URL imports, `Deno.env`. Shared helpers in `supabase/functions/_shared/`. Not covered by either tsconfig.
4. **Python backfill tools** (`backfill/`, `notebooks/`) — `uv`, Marimo, Polars, DuckDB. These are local-only tools for PII-sensitive Spotify export exploration and cleaning; generated data belongs under gitignored `analysis/`.

There is intentional duplication of helpers (dates, hashing, Spotify dimensions, env) across `scripts/lib/` and `supabase/functions/_shared/` because Node and Deno cannot share modules. When changing logic in one, check whether the parallel copy needs the same change.

Edge functions bundle `_shared/` at deploy time, so **editing a `_shared/` file changes nothing in production until every function importing it is redeployed**. `grep -l '_shared/<file>' supabase/functions/*/index.ts` finds them; `_shared/spotify.ts` currently backs `enrich-backfill`, `spotify-callback`, `spotify-connect` and `sync-due-users`.

## Pixel people and sprites

An ambient pixel character walks the dashboard chrome, driven off the rendered DOM. It lives in `src/lib/pixel-person/`; the traps are in [docs/pixel-people.md](docs/pixel-people.md), which is worth reading before touching it.

Worth knowing from outside the subsystem: **components opt in by tagging elements** (`data-pixel-collision`, `data-pixel-record`, `data-pixel-artist`), never by importing the pixel world. Adding a behaviour to a list means tagging it, not wiring it.

## Paper Shaders — the record mark and the dither fields

`@paper-design/shaders` (WebGL2) started as `RecordMark.svelte` — the spinning dithered record that replaced the old braille Spotify loader — and its dithering shader has since become the app's ambient design layer:

- **`DitherField.svelte`** renders the shader as an absolute-fill layer (accent cells on a transparent ground) inside its nearest positioned ancestor. **`DitherFrame.svelte`** wraps it as a padded band behind slotted content and owns the rule that slotted `.panel`s get an opaque page ground. The overview metric cards, the explore selector row, and the #1 rows of the homepage stat lists all sit on these fields.
- The cover wall runs a hover-only dither **wave** (`HOVER_OVERLAYS.ditherWave` in `src/lib/effects/hoverOverlays.ts`): ONE shared `ShaderMount`, created lazily on first hover and parked over the hovered tile — never one per tile. The covers themselves stay untouched; decoration goes on the chrome around the art, which is a standing taste rule, not an accident.
- Shared plumbing lives in **`src/lib/effects/webgl.ts`**: `readThemeVar`/`readThemeColors` (hex CSS-var → RGBA) and `disposeShaderMount` (capture the canvas before `dispose()`, then force `WEBGL_lose_context`). Use these; there were once four hand-rolled copies.
- Context budget as shipped: the homepage holds 3 persistent contexts (cards frame + two rank waves) plus 1 lazy hover wave; explore holds 1. `ShaderMount` pauses itself off-viewport and on hidden tabs, and speed 0 stops its rAF loop outright.

`/admin/mark` is the admin-gated tuning surface: the record mark, the **Dither frame** and **Rank wave** benches — their sliders seed from the exported `DITHER_FIELD_DEFAULTS` / `RANK_WAVE_DEFAULTS` objects, so they always open on what ships — plus the nine image filters in `src/lib/effects/coverEffects.ts` against real album covers and the hover overlays. The image filters remain experiments: none is applied to production covers.

Three things about this library are not discoverable from its types, and each one cost real time:

1. **Browsers cap live WebGL2 contexts at 16.** Measured. A cover wall renders up to 36 tiles, so one `ShaderMount` per tile is not viable and never will be — bake the effect through a single reused offscreen mount, or move one shared mount to whichever tile needs it. Going over silently kills the *oldest* contexts, which are usually something else on the page. Chromium also frees contexts lazily, so re-mounting overlaps old and new; release explicitly with `WEBGL_lose_context`, capturing the canvas **before** `dispose()` detaches it.
2. **Every `u_size` is a 0..1 dial, not a size in any unit.** Each is the `t` of a `mix()` choosing how many pattern cells span the tile, running high-to-low, so a larger value means *fewer, coarser* cells. Feed one a value above 1 and the mix extrapolates into negative cell counts and the tile renders blank — which is why halftone CMYK looked broken until the range was fixed.
3. **The image filters end with the image mixed back in**, so the cover's own colours are the output and `colorFront`/`colorBack` only show outside it. Pushing the overlay terms up saturates the blend until the image contribution reaches zero and the tile washes out to flat colour. Keep them low and move the structural terms instead.

## Paper — the design tool

The musik design system lives in a Paper file ("musik — design system", https://app.paper.design/file/01M0QBA624ZJWSP2ANA2V8GN87): ~49 tokens plus artboards for Foundations, Components, the desktop and mobile screens, and an "Ambient motion — pitches" board of unbuilt directions. Work against it through the paper-desktop MCP plugin. Three things cost time:

- **Token names diverge deliberately.** The Paper file's `--color-data-*` shipped in `src/styles.css` as `--data-1`…`--data-4` / `--data-bar` / `--data-empty`, because nothing else in `styles.css` carries a `--color-` prefix. The code is the authority on names; the Paper file is the authority on intent.
- **A Paper flexbox rebuild of a CSS layout invents bugs that are not in the app.** Of four layout "kinks" the Paper screens appeared to expose, only one was real (the others were artifacts of rebuilding tables and overflow rules as flexbox). Verify any Paper-surfaced bug against the actual CSS before changing code.
- **The MCP write quota is weekly** and has been exhausted mid-session; reads keep working after writes stop.

## Svelte 5 in legacy mode — two traps

The app compiles Svelte 5 but the components use Svelte 4 syntax (`$:`, `export let`). Two behaviours cost real debugging time:

1. **A `$:` statement that assigns state other `$:` statements read has no ordering guarantee.** The compiler sorts reactive statements by the variables they reference, and cannot see through a function call. Loading data into a variable from inside a reactive statement crashed a component because a later `$:` had not run yet. Prefer an explicit call from the event handler, passing what it needs as arguments.
2. **A derived `$:` value is stale inside the handler that triggered it.** Assigning `characterId` and then reading a `$: frames = ...` in the same tick gets the *previous* value. Pass the newly selected thing explicitly rather than re-reading the derived value.

Also: `safe_not_equal` treats an unchanged primitive as clean, so `x = x` does not invalidate. Snapping a `<select>` back after a cancelled confirm has to touch the DOM element.

## Testing conventions

- **Do not hardcode collection sizes in assertions.** Tests that pinned "4 generic characters at weight 1.0 each" and asserted literal roll boundaries broke the moment the registry changed. Derive the boundary from the registry so the test pins the rule, not a snapshot of today's data.
- **Mutation-test a new test before trusting it.** Break the implementation deliberately and confirm the test fails. Several turned out to pass under a broken implementation — including one whose fixture was too forgiving to tell the two versions apart.
- **Seed anything that simulates a trajectory.** `Math.random` drives the pixel world, so a test that walks someone around for a few minutes and asserts on what happened is a die roll — one failed more often than it passed. Pin `Math.random` to a seeded generator and pool a fixed set of seeds (`TRAJECTORY_SEEDS` in `pixel-person-routines.test.ts`).
- Vitest runs in the **node** environment with no jsdom, so anything under test must be free of DOM types. That is why `artist-presence.ts` and `sprite-source.ts` take plain values rather than elements.

## Data architecture

- **Per-user rows** are keyed by `user_id`: `profiles`, `spotify_connections`, `listening_events`, `rollup_daily_entity_stats`, `sync_state`, `overview_cache`, `public_activity_recent`.
- **Shared Spotify metadata** is global (no `user_id`): `artists`, `albums`, `tracks`, `track_artists`, `artist_genres`.
- **External music evidence** is global and service-only: MusicBrainz matches,
  Last.fm metadata/stats/tags/similarities, plus the resumable
  `external_music_enrichment_queue` and run telemetry. Only the curated
  `artist_genres` projection is public.
- Event uniqueness is `(user_id, source_event_key)` so two users can play the same track at the same instant without colliding.
- Legacy single-user data lives as `user_id = null` rows, now **archived** (`archived_at` set) and hidden from the public read path — recoverable, not deleted.

The browser's read surface is restricted to safe views/tables: `public_profile_overview`, `overview_cache`, `rollup_daily_entity_stats`, the metadata tables, and `public_activity_recent`. It never gets direct access to `listening_events` or `sync_state`. A profile only appears publicly when `profiles.is_public = true` and a user-scoped overview cache exists. The public homepage default slug is `defaultProfileSlug` in `src/lib/profileDefaults.ts`.

### Data quality / metrics semantics

- `source/data_quality = 1` (`exact`): Spotify export rows with `ms_played`.
- `source/data_quality = 2` (`api_unknown_duration`): recently-played API rows, no duration.
- `source/data_quality = 3` (`inferred`): reserved.
- **Minute totals** count exact + inferred durations only; **play totals** include API-only plays. See `src/lib/metrics.ts`.
- Dates bucket in `Australia/Melbourne`, weeks start Monday (`src/lib/dateRanges.ts`, `scripts/lib/dates.ts`).

## Auth & sync flow (invite-only)

1. Owner runs `pnpm invite <email>`; the script admin-invites the user and stamps `app_metadata.invited = true` on the account, and Supabase (custom SMTP via Resend on `krtky.dev`) emails an invite link. Accounts are only ever created server-side, so hosted signups stay disabled — invite-only holds.
2. Invitee clicks the link, lands signed-in at `/app/` with no profile yet, and sets a password + display name/slug/visibility. The client calls `auth.updateUser({ password })` then the `complete-onboarding` Edge Function (authenticated; the session is the gate — no invite code). As defense-in-depth, `complete-onboarding` also requires `app_metadata.invited` before creating a new profile, so invite-only is enforced in code and not only by the disabled-signups dashboard toggle. An account without the marker (e.g. invited via the Supabase dashboard button instead of `pnpm invite`) gets a 403 — resolve by re-inviting via `pnpm invite`. (Existing users who already have a profile are unaffected: they short-circuit as `alreadyOnboarded` before the check.)
3. Returning users sign in with email + password. "Forgot password?" uses `resetPasswordForEmail`; a `PASSWORD_RECOVERY` session shows the set-new-password form. Logged-in users can change their password in-app.
4. After sign-in at `/app/`, the user connects Spotify. `spotify-connect` (requires logged-in user) returns an auth URL; `spotify-callback` (public — Spotify redirects to it) exchanges the code, encrypts the refresh token with `SPOTIFY_TOKEN_ENCRYPTION_KEY`, stores it in `spotify_connections`.
5. **`sync-due-users`** (public at JWT layer but gates itself via `assertServiceRequest` checking the `apikey` header) finds stale enabled users, decrypts each token, fetches recently played, inserts `listening_events`, and refreshes that user's rollups + overview cache.

### What drives the sync cron

Sync scheduling has **moved from GitHub Actions into the database** (pg_cron + pg_net) because scheduled Actions were unreliable. See `supabase/migrations/20260619142000_schedule_sync_due_users_cron.sql`: `trigger_sync_due_users()` reads `project_url` and `sync_secret_key` from Supabase **Vault** and POSTs to `sync-due-users` every 15 minutes. The two Vault secrets must be created once per project (see the migration header) and are never committed. The old `.github/workflows/sync-recently-played.yml` has been deleted.

**Metadata enrichment now runs the same way**, for the same reason: its scheduled Action fired barely two thirds of the times it was asked to, drifting by hours. `20260727130000_schedule_enrich_backfill_cron.sql` adds two jobs reusing the same Vault secrets:

- `enrich-backfill` every 15 min POSTs the `enrich-backfill` edge function (default 30 tracks).
- `drain-rollup-refresh-queue` every 3 min calls `drain_rollup_refresh_queue(150)` directly — no HTTP hop, the work is in-database.

Spotify sometimes returns an app-wide `Retry-After` lasting many hours. `enrich-backfill` reconstructs that deadline from the latest `enrichment_runs` row before loading work or calling Spotify; scheduled invocations inside the window record an aborted cooldown run with zero failures and make no provider requests.

The split exists because rollup refresh is far more expensive than enrichment: one batch's affected dates blew the statement timeout, failing the job *after* the tracks were enriched. The edge functions queue dates into `rollup_refresh_queue` only when an artist's effective public genre set changes; the drain job works through them 150 at a time. External genre enrichment can enqueue thousands of historic dates, so migrations `20260829135424_tune_external_genre_rollup_drain.sql` and `20260829141741_increase_rollup_drain_cadence.sql` increase the drain cadence while deliberately retaining the production-proven 150-date batch; a 300-date benchmark hit the statement timeout. The final three-minute cadence was selected after production runs showed the 150-date transaction completing in 7–11 seconds and a heavy ten-entity artist batch enqueueing 326 dates. Migration `20260829142729_queue_rollups_only_for_changed_genres.sql` prevents repeated track and album reports from re-queueing those dates when the curated genre projection is unchanged. Migration `20260829143056_serialize_user_public_stats_refresh.sql` serializes the complete refresh per user so sync and drain jobs cannot race their delete-then-insert projections.

MusicBrainz + Last.fm enrichment uses a database-owned track/artist/album queue
created by `20260827073746_external_metadata_enrichment_worker.sql`. The hosted
`enrich-external-metadata` cron is temporarily paused by
`20260830111346_pause_external_enrichment_cron_for_local_drain.sql`; the queue
is drained from a laptop with `pnpm external:drain-local --duration-hours=12`.
That Node runner and the Edge Function share the runtime-neutral processor in
`supabase/functions/_shared/external-music-worker.ts`, while database claiming,
singleton leases, retries, completed endpoint state, and run telemetry remain
authoritative. The laptop runner globally paces provider calls at one per 1.1s.
It applies backpressure at 500 pending rollup refreshes so the database drain
can catch up. `pnpm external:status` prints queue progress and recent runs. Keep
`LASTFM_API_KEY` and `MUSICBRAINZ_USER_AGENT` in `.env.local`; use `caffeinate
-i` on macOS. Resume hosted processing only with a new migration using
`cron.schedule`, never by editing `cron.job` directly.

Every attempt writes a row to `public.enrichment_runs` — counts, whether it aborted, and Spotify's `retry-after` on a rate cap. `/admin` renders progress plus the last 50 runs. `pnpm enrich:backfill` still works for manual runs and writes the same telemetry.

## Extended history backfill

The committed workflow is documented in `docs/extended-history-backfill-plan.md`.

1. Explore with `uv run marimo edit notebooks/spotify_extended_history_explore.py`.
2. Find the cutoff with `min(played_at)` for the target user where `source = 2`.
3. Clean with `uv run python -m backfill.clean --input my_spotify_data.zip --out analysis/out --cutoff-iso '<timestamp>'`.
4. Import with `pnpm import:spotify-export --user-id=<auth-user-uuid> analysis/out/cleaned_*.json`.
5. Re-run the import once to verify idempotency, then run `pnpm enrich:metadata` until counts taper off.

The TypeScript importer requires `--user-id`; do not add back the null-user path. The cleaner emits JSON arrays, excludes PII columns, drops rows without `spotify_track_uri`, and preserves the source-event hash fields verbatim.

## Edge Functions deploy

```bash
supabase db push
supabase functions deploy spotify-callback --no-verify-jwt
supabase functions deploy sync-due-users --no-verify-jwt
supabase functions deploy enrich-backfill --no-verify-jwt
supabase functions deploy enrich-external-metadata --no-verify-jwt
supabase functions deploy spotify-connect          # requires JWT
supabase functions deploy complete-onboarding
```

The `--no-verify-jwt` functions enforce their own credential checks (Spotify redirect / service `apikey`).

**Do not run `supabase config push`** unless hosted Auth URLs and provider settings have been reviewed in the dashboard. The checked-in `supabase/config.toml` disables email signups for local dev; hosted Auth provider settings (public signups disabled, redirect URLs) are managed separately in the Supabase dashboard.

## Migrations

Numbered prefixes (`0001_`…`0003_`) are the original schema; later migrations use timestamp prefixes (`YYYYMMDDHHMMSS_`). RLS is enabled on all public tables with public-read policies only for safe tables and no anon write policies.

## Deploy

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on pushes to `main`. The base path is `/<repo-name>` in production (overridable via `PUBLIC_BASE_PATH`), so all in-app links must respect SvelteKit's `base` — see `svelte.config.js`.
