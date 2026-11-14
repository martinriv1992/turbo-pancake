# Architecture, status and roadmap

## 1. Audit of the starting point

The repository was empty: no commits, no remote branches, no backend, no integrations and no INNERWORKS code or
documents. Consequences:

- There was nothing to preserve or migrate at the code level. Everything here is new.
- The earlier INNERWORKS Studio concept was not available to read. The INNERWORKS sample brand
  (`src/lib/samples/innerworks.ts`) is **reconstructed from the scope named in the brief** (engineering categories,
  documentary workflow, 3D production requirements, English scripts, social strategy, publishing targets). Its
  wording, palette, typefaces and account handles are placeholders to be replaced with the real material.
- No Supabase project, API keys or platform credentials exist yet.

## 2. Decisions

| Decision | Why |
| --- | --- |
| Next.js (App Router) + TypeScript + Tailwind | The preferred stack; one deployable for UI and server actions. |
| PostgreSQL schema written for Supabase, runnable on plain Postgres | Supabase is the target, but its local stack could not be started in the build environment. A 30-line shim reproduces `auth.uid()` and the roles so the same migrations and RLS policies are tested for real. |
| Data access over a Postgres connection, each request in a transaction as role `authenticated` with `request.jwt.claims` set | This is the mechanism Supabase itself uses, so RLS is enforced identically without depending on PostgREST. |
| Sessions are a signed cookie; credential checking is pluggable (local bcrypt or Supabase Auth) | Keeps the app runnable with no external service. |
| Job queue in Postgres (`FOR UPDATE SKIP LOCKED`) | No extra infrastructure; any number of workers; survives restarts. |
| Provider adapters behind one interface; provider *instances* are rows | Providers are added, removed, repriced and reprioritised in the UI without a rebuild. |
| Only adapters whose API could be verified are shipped | Anthropic (verified against the official SDK reference) and a built-in non-AI engine. Other providers' documentation was not reachable, so they were not guessed. |

## 3. Tenancy and permissions

```
organization ── workspaces ── brands ── guidelines, assets, audiences, products, social accounts,
     │               │                  projects, campaigns, briefs, jobs → assets, versions, approvals,
     │               └── clients        publications → results, analytics
     └── memberships (org-wide or one workspace), AI providers, workflows, templates, audit log
```

Isolation is enforced in the database, twice:

1. **Row Level Security** on every table through `app.can(org, workspace, permission)`. Permissions (`view`, `edit`,
   `approve`, `publish`, `manage`) come from the `roles` table: owner, administrator, creative director, editor,
   content producer, client reviewer, viewer. A membership with no workspace applies to the whole organization.
2. **Composite foreign keys**: a row cannot reference a workspace of another organization, or a brand of another
   workspace. Mixing brand identities is structurally impossible, not just disallowed by code.

Further guards, also in the database: locked guidelines cannot be edited; a job's status changes to approved only by
inserting an `approvals` row (so reviewers who cannot edit can still approve, and every approval names a person);
a publication cannot be `published` without a confirmed result carrying a link or external id; only approved content
can be scheduled; full automation requires who/when activation metadata; nobody can grant a role above their own.

Each generation request is built by `loadBrandContext(brandId)` from the selected brand only; that single object is
the only route by which brand identity reaches a provider.

## 4. Production pipeline

`REQUEST → BRAND → BRIEF → RESEARCH → STRATEGY → SCRIPT/CONCEPT → GENERATION → EDITING → QUALITY CONTROL → HUMAN APPROVAL → DISTRIBUTION → ANALYTICS`

- Stage lists live in the `workflows` table and resolve most-specific-first: brand + type, brand + module,
  organization + type, organization + module, built-in. An image job has no storyboard stage; INNERWORKS
  documentaries add an editing stage through a brand-level row.
- Every job keeps its status, input, brand, stage history, providers used, estimated and actual cost, errors,
  attempts, versions and approval history.
- Operating modes (per workspace): **assisted** pauses on the script or concept for human edits; **autonomous
  production** runs straight to final approval; **full automation** (typed confirmation required) additionally
  auto-approves content whose quality control has no issues at all, in the name of the person who enabled it.
- Human control: cancel a job, emergency stop for the whole organization, budgets at organization, brand, project
  and campaign level checked before every paid provider call, audit log.
- Quality control: final asset exists and is non-empty, banned terms, unresolved `[TO CONFIRM]` markers, guideline
  status, dimensions against the requested format, and a flag when output is from the non-AI engine.

## 5. AI orchestration

`src/lib/ai/types.ts` defines capabilities (text, research, translation, image, image edit, video, voice, audio, 3D,
plus deterministic layout image / layout video / document) and the `Adapter` interface. The router ranks enabled,
currently available providers for a capability by the organization's preference (quality, cost or speed), then by
priority; the pipeline tries them in order, so the next one is the fallback. Usage and cost are recorded per call.

| Adapter | Capabilities | State |
| --- | --- | --- |
| Built-in template engine | text (templated drafts), brand layout images (SVG → PNG), slide video (FFmpeg, silent), HTML documents | Working and tested. **Not AI**; labelled as such everywhere. |
| Anthropic Claude | text, translation | Implemented against the official SDK; compiles; **not yet called with a live key** (none was available). |

Each content type lists the capabilities that can produce it. A type whose only options are generative (product
photography, illustration, 2D/3D animation, UGC video, every audio type) is shown as unavailable until an adapter
for that capability is installed. Nothing is simulated.

## 6. What is not built yet

Stated plainly so nothing is assumed:

- **No generative image, video, voice, music, 3D or research provider.** Those formats cannot be produced yet.
- **No direct platform publishing.** Distribution produces manual packages (caption + files); a person posts and
  confirms with the live link. Facebook, Instagram, YouTube, TikTok, Pinterest and LinkedIn each need an app,
  OAuth, token storage and, for most, platform review. Current API restrictions were not verifiable from the build
  environment and must be checked when this is built.
- **No automatic analytics import.** Metrics are entered manually. Recommendations are rules over the recorded
  numbers, not AI-generated.
- **Brand Builder does not read websites or analyse uploaded images**; it works from the profile and pasted text.
- **Supabase Auth, Supabase Storage and a hosted Supabase database are untested** (code paths exist).
- No email: invitations, password reset and error alerts. Members are added by the email of an existing account.
- No sign-in rate limiting or MFA in local auth mode.
- No PDF or slide-deck export (documents are print-ready HTML), no background removal or image resizing tools,
  no in-browser video or audio editor, no Blender pipeline, no reusable template UI (the `templates` table exists).
- No recurring or rule-triggered automations; the worker handles jobs, stale-job recovery and due publications only.
- Video from the built-in engine is silent slides at 720p-class resolution, capped at 12 scenes.

## 7. Roadmap

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Multi-tenant foundation, authentication, workspaces, brands, roles, RLS | Done, tested |
| 2 | Brand Builder (draft, edit, approve, lock), brand assets, audiences, products | Done; website and image analysis outstanding |
| 3 | Universal creation flow, AI orchestration, routing, fallback, cost tracking | Done with two adapters |
| 4 | Video, image, text, audio and document production | Text, layout image, slide video, documents done; generative media and audio need adapters |
| 5 | Campaigns, calendar, templates | Campaign planning and production and the calendar done; template UI outstanding |
| 6 | Platform integrations and distribution | Manual packages, scheduling, retries, logs done; platform APIs outstanding |
| 7 | Analytics, automation, cost management | Dashboards, manual metrics, modes, budgets, emergency stop done; API import and recurring automations outstanding |

Suggested next steps, in order: (1) connect a Supabase project and run the three test suites against it; (2) add an
Anthropic key and review real output quality; (3) choose image, video and voice providers and write their adapters
against their current documentation; (4) the first platform publisher (YouTube or LinkedIn are usually the simplest
to get approved); (5) email.

## 8. Adding things

- **A content type**: one line in `src/lib/content/catalog.ts`.
- **A workflow**: a row in `workflows` (organization- or brand-level).
- **A provider**: implement `Adapter` in `src/lib/ai/adapters/`, register it in `src/lib/ai/registry.ts`, and map
  where its files are stored if it introduces a new asset kind. Verify the provider's API documentation first.
- **A brand** (Solaroma, Ideonapp, Martz Gaming, anything): through the UI. No code refers to any brand.
