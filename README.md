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

The schema lives in `src/db/schema.ts`, and the reviewed candidate SQL is `drizzle/0000_initial.sql`. It has **not** been applied. Never apply a migration without explicit approval for that specific migration.
