```text
                       _ _
   _ __ ___  _   _ ___(_) | __
  | '_ ` _ \| | | / __| | |/ /
  | | | | | | |_| \__ \ |   <
  |_| |_| |_|\__,_|___/_|_|\_\

  cozy dashboard for exploring what you
  and your friends listen to on spotify
```

Members join by invite, connect their Spotify account once, and from then on their listening history syncs automatically every 15 minutes. Anyone can browse the profiles that members choose to make public — top artists, tracks, listening clocks, timelines — while each member keeps a private view of their own data. You can also import your full [Spotify Extended Streaming History](https://www.spotify.com/account/privacy/) to get stats going back years.

Under the hood it is deliberately simple and cheap to run:

- A **static SvelteKit site** deployed to GitHub Pages — no server to maintain
- A **Supabase** project for the database, auth, and Edge Functions
- One rule everywhere: **public read, private write**. The browser only ever gets a public Supabase key; every write and every Spotify secret stays behind row-level security or Edge Functions

Curious about the details? See [docs/architecture.md](docs/architecture.md).

## Running it locally

You'll need:

- **Node >= 22** and **pnpm**
- **[Supabase CLI](https://supabase.com/docs/guides/cli)** for migrations and Edge Functions
- **[uv](https://docs.astral.sh/uv/)** — only if you plan to import extended streaming history. I'm a python babby so used this but could have all been done in TS.

Then:

1. Clone the repo and install dependencies:

   ```bash
   pnpm install
   ```

2. Create a `.env.local` in the repo root pointing at a Supabase project (see the next section to create one):

   ```text
   PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SECRET_KEY=<secret key>
   ```

   The `PUBLIC_*` values are used by the browser app; the secret key is only used by the local CLI scripts (invites, imports) and never ships to the browser.

3. Start the dev server:

   ```bash
   pnpm dev
   ```

   The app lives at `/app/`, public profiles at `/profile/?slug=<slug>`.

Pointing `.env.local` at the hosted project is the normal day-to-day setup — you get live data immediately. If you want a fully local Supabase stack (local auth, invite emails captured in Mailpit, a seeded admin user), see [docs/local-development.md](docs/local-development.md).

## Setting up the database

1. Create a project at [supabase.com](https://supabase.com), then link and push the schema:

   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```

2. Create the two Vault secrets that drive the sync cron. The scheduled job (`pg_cron` + `pg_net`) reads these to call the sync Edge Function every 15 minutes — see the header of `supabase/migrations/20260619142000_schedule_sync_due_users_cron.sql` for the exact SQL:

   - `project_url` — your project URL
   - `sync_secret_key` — your service (secret) key

3. Configure Auth in the Supabase dashboard:

   - Set the Site URL and Redirect URL to your deployed app URL, e.g. `https://kartikey-vyas.github.io/spotify-tracker/app/`
   - In the email provider settings, **disable public signups**. Accounts are only ever created through the invite flow, which is what keeps the site invite-only.

4. Deploy the Edge Functions and set their secrets (Spotify values come from the next section):

   ```bash
   supabase secrets set \
     SPOTIFY_CLIENT_ID=... \
     SPOTIFY_CLIENT_SECRET=... \
     SPOTIFY_TOKEN_ENCRYPTION_KEY=... \
     SITE_URL=https://kartikey-vyas.github.io/spotify-tracker/app/

   supabase functions deploy complete-onboarding
   supabase functions deploy spotify-connect
   supabase functions deploy spotify-callback --no-verify-jwt
   supabase functions deploy sync-due-users --no-verify-jwt
   ```

   `SPOTIFY_TOKEN_ENCRYPTION_KEY` can be any long random string (`openssl rand -base64 32`); it encrypts Spotify refresh tokens before they are stored. The `--no-verify-jwt` functions enforce their own credential checks — `spotify-callback` is public because Spotify redirects to it, and `sync-due-users` verifies the service key itself.

## Setting up the Spotify app

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Register exactly one redirect URI:

   ```text
   https://<project-ref>.supabase.co/functions/v1/spotify-callback
   ```

3. Copy the Client ID and Client Secret into the Edge Function secrets above.

**Development mode matters here.** New Spotify apps run in development mode, which allows up to 25 users — and each one must be allowlisted first. Before someone can connect their Spotify account, add their name and the email tied to their Spotify account under **User Management** in the app's dashboard page. If they aren't allowlisted, the OAuth flow will fail for them even though the invite works fine.

## Inviting users

Invite someone by email:

```bash
pnpm invite friend@example.com --site-url=https://kartikey-vyas.github.io/spotify-tracker/app/
```

What happens next:

1. Supabase emails them a sign-up link (custom SMTP via Resend on `krtky.dev`).
2. They click it, land signed-in at `/app/`, and choose a password, display name, profile slug, and whether their profile is public.
3. They hit "connect spotify", approve the OAuth prompt, and syncing starts — new listens appear within 15 minutes.

Remember: they also need to be on the Spotify app's User Management allowlist (previous section) before step 3 will work.

Invites are the only way accounts get created — there is no public signup. If you invite someone via the Supabase dashboard instead of `pnpm invite`, onboarding will reject them with a 403; re-invite them with the CLI.

## Deploying the site

`.github/workflows/deploy.yml` releases production on every push to `main` in
this order: build the static site, apply pending Supabase migrations, deploy all
Edge Functions, then publish GitHub Pages. Configure the repo on GitHub:

- **Repository variables**: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (optional fallback `PUBLIC_SUPABASE_ANON_KEY`), `SUPABASE_PROJECT_ID`, and optionally `PUBLIC_BASE_PATH` — the base path defaults to `/<repo-name>`; set it to `/` when serving from a custom domain root.
- **Actions secrets used by operational scripts**: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
- **Actions secrets used by production deployment**:
  - `SUPABASE_ACCESS_TOKEN` — a Supabase personal access token.
  - `SUPABASE_DB_PASSWORD` — the production project's database password.

`SUPABASE_PROJECT_ID` is the non-sensitive project reference from the dashboard
URL and is stored as a repository variable rather than a secret.

Migration deployment uses `supabase db push`, without seed data. Function JWT
verification settings come from `supabase/config.toml`; the workflow never runs
`supabase config push`, so hosted Auth/provider settings remain dashboard-owned.

## Importing your full history

Spotify's [Extended Streaming History export](https://www.spotify.com/account/privacy/) (takes up to 30 days to arrive) gets you play-by-play data going back to your first ever listen. The flow is: explore the export in a Marimo notebook, clean it with Polars, then import it with the TypeScript CLI:

```bash
uv sync
uv run marimo edit notebooks/spotify_extended_history_explore.py
uv run python -m backfill.clean --input my_spotify_data.zip --out analysis/out --cutoff-iso '<timestamp>'
pnpm import:spotify-export --user-id=<auth-user-uuid> analysis/out/cleaned_*.json
```

The full walkthrough — including how to pick the cutoff timestamp so export rows don't double-count synced rows — is in [docs/extended-history-backfill-plan.md](docs/extended-history-backfill-plan.md). Keep raw exports in gitignored paths (`my_spotify_data.zip`, `Spotify Extended Streaming History/`, `analysis/`); they contain PII.

After a large import, run `pnpm enrich:metadata` (or the long-running `pnpm enrich:backfill`) to fill in artist images.

## Everyday commands

```bash
pnpm dev          # local dev server
pnpm build        # static production build
pnpm check        # svelte-check (app)
pnpm typecheck    # tsc (scripts/)
pnpm test         # vitest
uv run pytest     # python backfill tests
pnpm db:size      # check database size
```

## More docs

- [docs/architecture.md](docs/architecture.md) — data model, access rules, sync internals, security model
- [docs/local-development.md](docs/local-development.md) — full local Supabase stack, auth testing, Mailpit
- [docs/extended-history-backfill-plan.md](docs/extended-history-backfill-plan.md) — extended history import walkthrough
- [docs/pixel-people.md](docs/pixel-people.md) — the ambient pixel characters: how they move, and what breaks them
- [AGENTS.md](AGENTS.md) — instructions for coding agents working in this repo
