# Architecture

The state of the system as built. Everything runs as one Next.js deployment on Vercel pinned to `syd1`; the only stateful component we own is Neon Postgres.

## Infrastructure

```mermaid
flowchart TB
    buyer["Buyer browser"]

    subgraph vercel["Vercel — syd1 (Sydney)"]
        direction TB
        pages["App Router pages<br/>mandate · targets · outreach<br/>audit · settings · auth screens"]
        api["Route handlers<br/>auth · target discovery/enrichment<br/>outreach drafting · Gmail approval"]
        server["Server logic<br/>domain → adapters → repositories"]
        pages --> server
        api --> server
    end

    neon[("Neon Postgres<br/>Australian region")]

    subgraph ext["External services"]
        places["Google Places API"]
        google["Google<br/>OAuth + Gmail API"]
        resend["Resend"]
        firmable["Firmable API"]
        openrouter["OpenRouter"]
    end

    seller["Seller mailbox"]

    buyer --> pages
    buyer --> api
    server --> neon
    server -.-> google
    server -.-> places
    server -.-> resend
    server -.-> firmable
    server -.-> openrouter
    google --> seller
    seller -. "reply webhook" .-> api

    classDef ours fill:#e8f2ec,stroke:#4a7a5e,color:#1e3a2a
    classDef third fill:#f5f0e8,stroke:#8a7a5c,color:#3a3428
    class pages,api,server,neon ours
    class places,google,resend,firmable,openrouter,seller third
```

Dotted edges are the ones that leave our infrastructure. External discovery and drafting are selected explicitly with `TARGET_DATA_PROVIDER` and `OUTREACH_DRAFTING_PROVIDER`; fixture mode makes no provider requests. Gmail approval always requires an explicitly connected mailbox and only creates a draft—it does not send.

## Module layering

```mermaid
flowchart TB
    subgraph l1["1 · Entry points (src/app)"]
        direction LR
        authpages["/sign-in · /sign-up<br/>/forgot-password · /reset-password<br/>/onboarding · /auth/complete"]
        apppages["/mandate · /targets<br/>/outreach · /audit · /settings"]
        inbound["/api/inbound/reply"]
        mailboxapi["/api/mailbox/google<br/>connect · callback"]
        authapi["/api/auth/[...all]"]
    end

    subgraph l2["2 · Domain and platform"]
        direction LR
        subgraph dom["Domain — no provider knowledge (src/domain)"]
            direction LR
            mandate["mandate.ts"]
            scoring["scoring.ts"]
            outreach["outreach.ts"]
            replies["replies.ts"]
        end
        subgraph plat["Platform (src/lib)"]
            direction LR
            betterauth["auth.ts<br/>Better Auth"]
            gauth["google-oauth.ts<br/>PKCE"]
            crypto["token-crypto.ts"]
            mail["transactional-email.ts"]
        end
    end

    subgraph l3["3 · Adapters — swappable boundaries (src/adapters)"]
        direction LR
        mode["provider-mode.ts<br/>explicit fixture/live switch"]
        fixture["fixture-provider.ts<br/>safe local/test responses"]
        places["GooglePlacesClient"]
        firmable["FirmableClient"]
        drafting["outreach-drafting.ts<br/>explicit fixture/AI switch"]
        ai["OpenRouterAiProvider<br/>model waterfall"]
        gmail["GmailMailbox<br/>draft create/update/delete"]
        mode --- fixture
        mode --- places
        mode --- firmable
        drafting --- ai
    end

    subgraph l4["4 · Persistence (src/db)"]
        direction LR
        repos["repositories.ts<br/>organisation-scoped"] --> orm["Drizzle ORM<br/>neon-http"]
    end

    apppages --> mandate
    apppages --> scoring
    apppages --> outreach
    inbound --> replies
    mailboxapi --> gauth
    authapi --> betterauth
    authpages --> betterauth

    gauth --> crypto
    betterauth --> mail

    mandate --> mode
    scoring --> mode
    outreach --> drafting
    outreach --> gmail
    crypto --> gmail

    dom --> repos
    betterauth --> repos

    classDef def fill:#e8f2ec,stroke:#4a7a5e,color:#1e3a2a
    class mode,drafting def
```

Green nodes are explicit provider boundaries. `.env.example` selects fixture target data and fixture drafting so a fresh local clone and automated tests make no external provider requests. Production must explicitly select `TARGET_DATA_PROVIDER=live` and `OUTREACH_DRAFTING_PROVIDER=ai`.

Two rules hold the layering together: the domain layer has no knowledge of any provider, and nothing above layer 4 touches the database except through the organisation-scoped repositories.

## Two separate Google grants

Product sign-in and mailbox sending use the same Google project but are deliberately different flows, with different callbacks and different token stores.

```mermaid
flowchart LR
    subgraph signin["Product sign-in"]
        direction TB
        a1["/sign-up or /sign-in"] --> a2["Better Auth<br/>social provider"] --> a3["/api/auth/callback/google"] --> a4[("account table<br/>session cookie")]
    end
    subgraph mailbox["Delegated Gmail sending"]
        direction TB
        b1["/settings"] --> b2["/api/mailbox/google/connect<br/>PKCE challenge"] --> b3["/api/mailbox/google/callback"] --> b4["token-crypto"] --> b5[("mailbox_connections<br/>encrypted refresh token")]
    end
```

Signing in never grants send scope. Connecting a mailbox is an explicit second act from Settings.

## Outreach send and reply

```mermaid
sequenceDiagram
    participant U as Buyer
    participant O as /outreach
    participant D as outreach route
    participant DB as Neon Postgres
    participant M as MailboxAdapter
    participant G as Gmail Drafts

    U->>O: approve step
    O->>D: request Gmail draft
    D->>DB: verify real contact, email and mailbox connection
    DB-->>D: allowed
    D->>M: create or update draft
    M->>G: save draft in buyer mailbox
    D->>DB: persist approval state, provider IDs and audit event
```

Approval guards are enforced before Gmail is called. Fictionalised contacts, missing email addresses, do-not-contact records and unconnected mailboxes cannot create Gmail drafts. Sending remains outside the current product flow.

## Data

One Neon Postgres database. All product tables are organisation-scoped and reached only through `src/db/repositories.ts`.

| Group | Tables |
| --- | --- |
| Identity | `user`, `session`, `account`, `verification` |
| Tenancy | `organization`, `member`, `invitation` |
| Sourcing | `mandates`, `targets`, `contacts`, `signals` |
| Outreach | `sequences`, `sequence_enrolments`, `messages`, `replies`, `suppressions`, `daily_send_counters` |
| Mailbox | `mailbox_connections`; legacy `mock_mailbox_deliveries` remains in the schema pending a separately approved migration |
| Trail | `audit_events` |

Schema lives in `src/db/schema.ts`. Migrations are checked-in SQL under `drizzle/` and are never applied without explicit approval for that specific migration.

## Why these boundaries

- **The domain knows nothing about providers.** Scoring, mandate parsing, sequencing, and reply handling are pure and deterministic, which is why they carry the test coverage.
- **Every external dependency sits behind an explicit provider boundary.** Fixture mode supports local development and automated tests; live mode uses Google Places, Firmable, OpenRouter and Gmail only for user-triggered operations.
- **Sovereignty is a deployment property, not a code property.** The `syd1` pin in `vercel.json` and an Australian Neon region keep request handling and data in-country without the application needing to know.
