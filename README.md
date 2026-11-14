# Universal Content Studio

**Create anything. Publish everywhere.**

A multi-brand content production system: organizations → workspaces → brands, each brand with its own identity
and guidelines; production jobs for video, images, writing, audio and documents; human approval; publication
packages; cost control; analytics. The product name and tagline are configuration (`NEXT_PUBLIC_APP_NAME`,
`NEXT_PUBLIC_APP_TAGLINE`), not code.

> Status, design decisions, what is and is not built, and the roadmap are in
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Read its "What is not built yet" section before planning around this.

## Run it locally

Requirements: Node 20+, PostgreSQL 15+, FFmpeg (for slide-based video).

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run db:local
```

```bash
npm run db:migrate
```

```bash
npm run dev
```

Open http://localhost:3000, create an account, then an organization. No external service or API key is needed:
the built-in template engine (not AI) produces drafts, brand layout images, slide videos and documents, so the
whole pipeline can be exercised at zero cost.

`npm run db:local` creates a database and a small shim (`scripts/local-shim.sql`) that provides Supabase's
`auth.uid()` and roles on plain PostgreSQL. It runs `psql` as the `postgres` superuser via `su`; set `PSQL_SUPER`
if your machine does it differently (for example `PSQL_SUPER="sudo -u postgres sh -c"`).

### Using Claude

Set `ANTHROPIC_API_KEY` in the server environment, restart, then add **Anthropic Claude** under *AI Providers*.
Text tasks (strategy, scripts, concepts, copy, brand guidelines, campaign plans, caption adaptation) are then routed
to it; estimates and budgets use the prices shown in that panel.

### Using Supabase

The migrations in `supabase/migrations` are written for Supabase (they rely on `auth.users`, `auth.uid()` and the
`authenticated` role). Point `DATABASE_URL` at the project's Postgres connection string and run `npm run db:migrate`
(do **not** run `db:local` or the shim there). `AUTH_DRIVER=supabase` and `STORAGE_DRIVER=supabase` switch sign-in
and file storage to Supabase Auth and Storage. **These two drivers and the hosted-database path have not been run
against a live Supabase project yet** — no project or credentials were available when this was built.

## Tests

| Command | What it verifies |
| --- | --- |
| `npm run test:rls` | 39 checks: tenant isolation, roles, brand/workspace integrity, guideline lock, approval and publication guards |
| `npm run test:pipeline` | 26 checks: cost recording, budgets, provider fallback, retries, cancellation, emergency stop, automation modes |
| `npm run test:e2e` | Browser: create organization → brand → identity → project → generate asset → approve → prepare and confirm publication |
| `node scripts/e2e-extended.mjs` | Browser: all pages, sample brand, video/document/writing, QC, campaign, calendar, providers, analytics |

The browser tests need the app running (`BASE_URL=http://127.0.0.1:3000`) and Playwright installed.

## Layout

```
supabase/migrations/   schema, RLS policies, triggers
scripts/               local database setup, migration runner, worker entry point, tests
src/config/product.ts  product name and tagline
src/lib/ai/            provider contract, adapters, router, prompts
src/lib/jobs/          planner, pipeline, budgets, queue worker
src/lib/render/        brand layout images, FFmpeg slide video, document HTML
src/lib/content/       content-type catalog (add a format here)
src/lib/samples/       INNERWORKS sample brand (data only)
src/server/actions/    server actions (all data access runs under RLS as the signed-in user)
src/app/               pages
```
