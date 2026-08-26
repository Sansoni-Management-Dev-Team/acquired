# Acquired

Evidence-led SME acquisition sourcing, ranking, and outreach. This repository is implementing the phases in [`docs/21-build-plan.md`](docs/21-build-plan.md).

## Implemented

- Next.js App Router, TypeScript, Tailwind, and copy-in UI components
- separate discovery, Firmable enrichment/contact, and Apollo boundaries
- deterministic fit, ripeness, financeability, confidence, and opportunity qualification
- deterministic mandate parsing and structured confirmation
- seven-step evidence-grounded outreach with approval, suppression, reply, and cap guards
- mock and Gmail mailbox adapters, delegated OAuth with PKCE, encrypted refresh-token storage
- signed inbound reply routing that stops a sequence atomically
- fictional seed records with field-level provenance and explicit missing values
- ranked `/targets` table with search, band filters, and evidence breakdown
- mandate, targets, outreach, audit, settings, and sign-in screens
- organisation-scoped Drizzle repository and an initial SQL migration artifact

## Run locally

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

Copy `.env.example` to `.env.local` only when connecting external services. `TARGET_SOURCE=seed` and the mock mailbox are the safe defaults. Live provider calls are never made by the normal test suite.

## Database safety

The schema lives in `src/db/schema.ts`. Migrations `drizzle/0000_initial.sql`, `drizzle/0001_opportunity_qualification.sql`, and `drizzle/0002_auth_issuer_compatibility.sql` were explicitly approved and applied to the configured Neon database on 2026-08-26. Never apply a future migration without explicit approval for that specific migration.

## Authentication

Email/password and Google registration/login plus one-hour password reset tokens are backed by Better Auth tables in Neon Postgres. Registration creates an organisation and makes it active for the new session. Password resets revoke existing sessions and use Resend when `RESEND_API_KEY` and `AUTH_EMAIL_FROM` are configured. Product Google sign-in uses `/api/auth/callback/google`; the delegated Gmail grant remains separate at `/api/mailbox/google/callback` and can be connected from Settings after login.
