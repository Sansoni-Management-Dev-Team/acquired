# Acquired

Evidence-led SME acquisition sourcing, ranking, and outreach. This repository is implementing the phases in [`docs/21-build-plan.md`](docs/21-build-plan.md).

## Implemented

- Next.js App Router, TypeScript, Tailwind, and copy-in UI components
- separate discovery, Firmable enrichment/contact, and Apollo boundaries
- deterministic fit, ripeness, financeability, confidence, and opportunity qualification
- deterministic mandate parsing and structured confirmation
- seven-step evidence-grounded outreach with persisted editing, per-message approval, and Gmail Drafts synchronization
- mock and Gmail mailbox adapters, delegated OAuth with PKCE, encrypted refresh-token storage
- signed inbound reply routing that stops a sequence atomically
- Google Places natural-language company discovery followed by bounded, sequential Firmable website enrichment
- ranked `/targets` table with saved-target hydration, search limits, band filters, provenance, and evidence breakdown
- persisted Firmable company profiles, outreach context, decision-maker contacts, evidence signals, and seven-step draft sequences using the existing database schema
- targets, outreach, audit, settings, and sign-in screens
- organisation-scoped Drizzle repository and an initial SQL migration artifact

## Run locally

Set up the isolated OrbStack PostgreSQL database by following [`docs/26-orbstack-local-development.md`](docs/26-orbstack-local-development.md). The database starts empty; applying application migrations requires separate, explicit approval.

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000/targets`.

## Verify

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Copy `.env.example` to `.env.local`. Local development explicitly uses `TARGET_DATA_PROVIDER=fixture` and `OUTREACH_DRAFTING_PROVIDER=fixture`; these adapters exercise the provider response schemas without making Google Places, Firmable, AI, or email requests. Set the target provider to `live` and configure `GOOGLE_PLACES_API_KEY` plus `FIRMABLE_API_KEY` only for a controlled live test. Set outreach drafting to `ai`, choose `AI_PROVIDER=openrouter`, and configure `OPENROUTER_API_KEY` plus the ordered `OUTREACH_AI_MODELS` list for controlled AI drafting tests. The example waterfall makes one request each to GLM 5.2 Free and Dots3 Note Preview Free, then allows the low-cost paid Qwen 3.8 Flash fallback at most two attempts. It falls through only after a transient provider, transport, or malformed-response failure and never exceeds four model requests per user action. Reasoning is disabled for these models because outreach is a constrained structured-writing task. Free endpoint availability and rate limits make them unsuitable as production dependencies; Dots3 Note Preview is scheduled for removal on 30 September 2026. OpenRouter requests deny provider data collection and fail closed if no compatible endpoint is available. Outreach depends on a provider-neutral structured-generation interface so future Bedrock, direct OpenAI, or Anthropic adapters do not change the drafting or persistence flow. Provider keys remain server-side. Searches are only made after a signed-in user clicks **Search & enrich**. One Google request scans at most 20 candidates, skips missing and duplicate websites, and stops after collecting the selected `1`, `3`, `5`, `10`, or bounded `Max (20)` website-backed targets. Firmable calls cannot exceed that selected cap. A per-organisation concurrency and cooldown guard prevents repeated direct API calls from bypassing the UI controls.

Target searches emit structured `[target-search]` logs from `pnpm dev`, including the parsed mandate, Google query/results, Firmable domain lookups, safe enrichment summaries, errors, and ranked output. Development logging is enabled by default. Set `TARGET_SEARCH_VERBOSE_LOGGING=true` to enable it outside development or `false` to silence it explicitly. Secrets, authorization headers, emails, phone numbers, and raw Firmable payloads are never logged.

Successful Firmable enrichments are upserted by organisation and domain. Google content remains transient except for its Place ID; safe Firmable company data is stored in `targets.identifiers` and `targets.firmographics`. Saved targets, exact score explanations, and evidence survive refresh. Outreach requires explicit candidate review before one fictionalised or live decision-maker is enriched and saved. A stored buyer profile plus factual company evidence feeds seven database-backed, editable drafts. Approval creates or updates a Gmail draft using the separately granted `gmail.compose` scope; revocation deletes that Gmail draft. Approving all seven moves the enrolment only to `manual_confirmation`. Nothing sends automatically.

## Database safety

The schema lives in `src/db/schema.ts`. Migrations `drizzle/0000_initial.sql`, `drizzle/0001_opportunity_qualification.sql`, and `drizzle/0002_auth_issuer_compatibility.sql` were explicitly approved and applied to the configured Neon database on 2026-08-26. Never apply a future migration without explicit approval for that specific migration.

## Authentication

Email/password and Google registration/login plus one-hour password reset tokens are backed by Better Auth tables in the configured PostgreSQL database—OrbStack locally and Neon when deployed. Registration creates an organisation and makes it active for the new session. Password resets revoke existing sessions and use Resend when `RESEND_API_KEY` and `AUTH_EMAIL_FROM` are configured. Product Google sign-in uses `/api/auth/callback/google`; the delegated Gmail grant remains separate at `/api/mailbox/google/callback` and can be connected from Settings after login.
