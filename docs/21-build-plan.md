# Build plan — sourcing, ranking, sequenced outreach, sending

26 Aug 2026. The application shape as now stated: pull business data from Firmable and/or Apollo,
filter and rank it into cold/warm/hot with reasons, generate a seven-message outreach sequence
ending in a break-up, and send it through the user's own Gmail. Plus auth. Plus shadcn.

This document is the plan for that. It assumes no application code exists yet — because it
doesn't — and it is written against `01-understanding.md` (M0 criteria), `04-prototype-teardown.md`
(the spec worth harvesting) and `20-gmail-oauth.md` (the sending constraint).

---

## 0. The two constraints that decide the sequencing

**M0 is Friday 28 August — two days away.** Seven acceptance criteria, and criterion 6 is
explicitly *"outreach drafting works; nothing sends"*. So sending is not in M0 by the client's own
definition, which is fortunate, because:

**Gmail sending is gated on Google app verification, which is weeks not days.** `gmail.send` is a
*sensitive* scope: brand review, published privacy policy on a verified domain, demo video, scope
justification. Nothing in the build makes that queue shorter. The only lever is submitting early.

These two facts set the shape of the whole plan: **build the entire pipeline against a
`MockMailbox` and swap in Gmail when verification lands.** The seam is the deliverable, not the
Gmail client. Concretely, the Google Cloud project, consent screen and verification submission
should be started this week, in parallel with M0, by whoever owns the domain — it is the long pole
and it blocks nothing else.

Everything below is ordered accordingly.

---

## 1. Stack

| Layer | Choice | Why this and not the alternative |
|---|---|---|
| Framework | Next.js App Router, TypeScript | The prototype is already this; server actions and route handlers keep Claude calls server-side; nothing about the domain argues for anything else |
| UI | shadcn/ui + Tailwind, dark deal-desk theme | As requested. shadcn is copy-in components, not a dependency — matters for a bank security review, since there is no vendor UI runtime to assess |
| Database | Postgres in `ap-southeast-2` (Sydney) | Data sovereignty is a stated constraint and a bank-review question. Neon and Supabase both offer Sydney. Supabase if we want storage + row-level security for the data room later; Neon if we want plain Postgres and branching |
| ORM | Drizzle | Migrations as SQL we can read, which is what an auditor wants. Prisma is fine; Drizzle is lighter and the schema is the source of truth |
| Auth | Better Auth, self-hosted, Postgres-backed | See §7 — the deciding factor is that identity data stays in our AU database rather than a US identity vendor |
| Background work | `pg-boss` on Postgres for M0; a dedicated worker (Fly.io Sydney) when sequences go live | Sequences need durable, delayed, retryable jobs. Inngest and Trigger.dev are better tools and are US-hosted — flag before adopting |
| Hosting | Vercel for M0, functions pinned to `syd1` | Fastest path to criterion 1 (deployed, not localhost). D4 says own AWS tenant later; the adapter and worker boundaries are what make that a migration rather than a rewrite |
| Models | Claude only, no-training terms | Stated constraint, and a prerequisite for the Google verification submission |

Two things to hold fixed from day one because they are brutal to retrofit, per the brief:
**provenance is a field on every derived value**, and **every external boundary is an interface
with a mock and a live implementation**.

---

## 2. Data model

Harvest the prototype's vocabulary — it encodes how Mark thinks — and add the parts it never had.

```
Organisation                              tenancy root, from day one, even with one row
  User                                    Better Auth user, scoped to org
  MailboxConnection                       per user, encrypted refresh token, provider enum

Mandate                                   natural language + structured filters + confidence
Target                                    the business
  ├─ identifiers                          abn, firmableId, apolloId, domain, linkedinSlug
  ├─ firmographics                        revenue, ebitda, headcount, industry, state, estYear
  ├─ scores                               fit, ripeness, confidence  →  band (cold|warm|hot)
  └─ status                               the deal ladder enum
Contact                                   the owner/decision maker
Signal                                    { kind, value, source, sourceUrl, weight, capturedAt }
                                          the evidence atom — attaches to Target or Contact
Sequence                                  template: 7 steps, delays, channels
  SequenceEnrolment                       target × sequence, state machine
  Message                                 step, generated body, approvedBy, approvedAt,
                                          providerMessageId, providerThreadId, sentAt
Reply                                     inbound, parsed, threaded back to Message
Suppression                               address or domain, reason, addedAt — checked at send
AuditEvent                                actor, action, entity, before/after, at
```

Non-negotiable field-level rules, taken from the prototype's best instinct:

- Every derived number carries `{ value, source, confidence }`. Missing stays missing —
  `"UNKNOWN from register"`, never an imputed figure. Make this an acceptance test, not a
  convention.
- `Signal` is the `{signal, source, weight}` triple from the prototype's contact record, promoted
  to a first-class table. It is the "why" behind every score and every personalised sentence in an
  outreach message. If a claim in an email cannot point at a Signal row, it does not go in the
  email.
- Deal ladder, kept roughly as the prototype has it:
  `NO DEAL → IDENTIFIED → ENRICHED → OUTREACH QUEUED → CONTACTED → WARM → RFI FULFILLED →
   MODELLED → SUBMISSION PACKAGED`, plus terminal `NOT INTERESTED` and `SUPPRESSED`.

The **D1 decision** (lean four-record pipeline vs full six-record platform) is still formally open.
The shape above is the lean pipeline with tenancy and evidence added, which is where I think it
should land — but it is Mark's call and it should be made explicitly this week, not by drift.

---

## 3. Sourcing — Firmable, Apollo, and the thing the prototype already admitted

The honest position from `04-prototype-teardown.md`: **fifteen of the prototype's sixteen targets
came from an industry association member register, not from Firmable.** The demo labels Firmable
as live and the register as not-live, which is exactly backwards from what its own seed data says.

So model three source types behind one interface, and do not assume Firmable is the discovery
layer until someone has actually run a search on the account:

```
TargetSource
  search(mandate)      -> TargetCandidate[]     // discovery
  enrich(identifier)   -> TargetDetail          // enrichment
  capabilities()       -> { canSearch, canEnrich, coverage, costPerCall }
```

| Source | Realistic role | Open question |
|---|---|---|
| **Firmable** | Enrichment, high confidence, AU-native (1M+ AU companies, 10M+ people). Public API documents `GET /company` by known identifier only | Does our plan expose a search/list or audience-build endpoint? This is the single biggest unknown on the critical path and it is commercial as much as technical |
| **Apollo** | Discovery via `mixed_companies/search` + `people/search`, wide filters, good tooling | AU SME coverage is materially thinner than Firmable's, contact reveal burns credits, and the terms restrict export and retention in some tiers. Check the contract before it becomes the sourcing spine |
| **Registers** (ASIC, industry associations) | The actual quality source for a defined sector lane, and the only source of succession signal | ASIC director records — appointment date, tenure, sole-director structure — are what make the ripeness score real. Access path and cost need confirming |

Recommended M0 posture: **Firmable live for enrichment** (criterion 4 satisfied, one live connector
against real data), **register/seed for discovery**, Apollo behind the same interface but not on
the M0 path. If Firmable search turns out to exist, it slots into `search()` without touching
anything downstream — which is the entire point of the interface.

One constraint to honour at ingest, per the brief: **no real personal data in dev/test.**
Fictionalise personal fields at the ingest boundary so real company data flows through real
scoring while named individuals' mobiles and emails do not sit in a pre-security-review
environment. That is a switch on the ingest adapter, not a policy on a wiki.

---

## 4. Ranking — cold, warm, hot, and the "why"

This is the part worth getting right, and the prototype already had the key insight: **two scores,
not one.** An ideal business with a forty-year-old owner is not a lead. A retiring owner with a
business outside mandate is not a lead either.

### Three axes

**Fit (0–100) — does this business match the mandate?** Deterministic, computed in code from
structured fields: industry/sector lane, revenue band, EBITDA band, state and metro/regional,
headcount, capital intensity, single-state versus multi-state. Mark's own search is $1–5M EBITDA,
which is roughly $10–50M revenue and a universe of a few thousand nationally — so near-misses will
be obviously wrong to him and the band edges need to be sharp, not fuzzy.

**Ripeness (0–100) — is this owner likely to sell?** Derived from Signals, weighted:

| Signal | Typical source | Weight |
|---|---|---|
| Owner tenure 20+ years | ASIC appointment date + LinkedIn | high |
| Owner age band 60+ | Inferred — and labelled as inferred | medium |
| Sole director, no co-director | ASIC company extract | high |
| GM or second-in-command in place | LinkedIn + website team page | high |
| No next-generation family in the business | LinkedIn scan | medium |
| Ownership concentration / no PE on register | ASIC | medium |
| Recent capital investment paused or absent | Planning records, website | low |
| Business listed, or adviser engaged | Broker listings scan | very high |
| Eponymous business name | Register | low |

**Confidence (0–100) — how much of this do we actually know?** Completeness of the evidence, not a
quality judgement. This is what stops a target with two signals and no financials outranking one
with nine.

### The band

```
band = f(fit, ripeness) gated by confidence

HOT    fit >= 75  AND  ripeness >= 70  AND  confidence >= 60
WARM   fit >= 60  AND  ripeness >= 45  AND  confidence >= 40
COLD   everything else that clears the mandate floor
EXCLUDED  fails a hard mandate constraint, or is suppressed
```

Thresholds are configuration, not code — they will be tuned against Mark's judgement in week one,
and the tuning history is itself worth keeping.

### The rule that matters most

**The model does not emit the number.** Claude's job is to *extract and classify signals from
unstructured evidence* — read the ASIC extract, the LinkedIn profile, the website team page, and
return `{signal, source, sourceUrl, weight, confidence}` rows. The scoring function that turns
Signal rows into fit, ripeness and a band is deterministic TypeScript.

Three reasons, and they are all load-bearing here: scores must be **reproducible** (same evidence,
same score, every time); they must be **explainable** to someone with a banking and corporate
finance degree who will check them; and thresholds must be **tunable** without re-running an LLM
over the whole database. An LLM-emitted score is a number nobody can defend in a room with a
credit team.

The UI consequence: clicking a score opens the Signal list that produced it, each row with its
source link and its contribution to the total. That is "evidence or nothing" made visible, and it
is also the thing that makes the product trustworthy rather than impressive.

---

## 5. Outreach — the seven-touch sequence

A `Sequence` is a template of seven steps. Each step has a delay, a channel, a *purpose*, and a
prompt that is allowed to draw only on Signals attached to that target.

| # | Day | Purpose | Notes |
|---|---|---|---|
| 1 | 0 | Direct opener. One specific, verifiable reason for the approach. Ask for fifteen minutes | The personalised line must cite a Signal, not a tone instruction |
| 2 | +3 | Insight touch — something concrete about their sector or their numbers | Earns the second read |
| 3 | +7 | Credibility — who the buyer is, why the approach is serious, what happens next | Answers "who are you" before it is asked |
| 4 | +12 | Objection handling — the "I'm not selling" reframe. Conversation, not transaction | Highest-yield message in most owner-succession sequences |
| 5 | +18 | Value-forward — indicative valuation range, no obligation | Language discipline: business-level lender appetite, never "pre-approved finance" |
| 6 | +25 | Short nudge. One question, two lines | |
| 7 | +35 | Break-up. Closing the loop, leaving the door open | Reliably the second-highest reply rate in the sequence |

Design notes:

- **Days are business days with jitter**, not calendar days on a fixed clock. Seven identical
  sends at 09:00 sharp is a pattern that spam filters and humans both recognise.
- **Every message renders from the same Signal set**, so the sequence reads as one person who
  knows the business, not seven independent AI drafts. This is the bar `03-client-context.md`
  sets: Mark ran outbound programs for a living and competent-but-generic fails instantly.
- **Human gate.** Step 1 is approved per target. Steps 2–7 are approved either individually or as
  a block at enrolment — that is a decision for Mark (see §10), and the honest trade-off is that
  per-message approval preserves the gate literally but does not survive a hundred targets.
  My recommendation: approve step 1 individually, approve the remainder as a block, and force
  re-approval on any step that is regenerated or edited.
- **Stop conditions, in priority order:** reply received, meeting booked, unsubscribe, manual stop,
  suppression list hit, bounce. Any one of them halts the enrolment immediately.

### The dependency nobody should miss

**Auto-stop-on-reply is only as good as reply capture, and with `gmail.send` alone we have zero
read access to the mailbox.** Sending message four to someone who replied to message two is the
single worst failure mode this product has — it is the thing that makes a buyer look careless to
the exact person they are trying to buy from.

Per `20-gmail-oauth.md`, the answer is **Reply-To routing**: send with
`Reply-To: deal-<threadId>@reply.<ourdomain>`, receive at an inbound-parse endpoint on our own MX,
parse and thread it. No restricted scope, no annual CASA assessment. The consequence for this plan
is a hard ordering rule:

> **Inbound reply capture ships before, or with, automated multi-step sending. Not after.**

Until it does, sequences run in manual mode: the system queues step two and asks a human to
confirm no reply has arrived. That is a perfectly reasonable interim, and it is much better than
discovering the failure mode in production.

### Compliance, built in rather than bolted on

The Spam Act 2003 (Cth) is more binding on this product than the OAuth policy is. Cold outreach to
business owners runs on *inferred* consent, which is a real basis and a narrower one than people
assume. Practical requirements, all of them build items:

- Unsubscribe mechanism in every template, honoured within five working days
- Suppression list checked **at send time**, in the send path, not bypassable by the approve gate
- Accurate sender identification in the footer — the buyer is the sender, the platform is the tool
- Per-account daily caps set below Gmail's own (500 consumer, 2,000 Workspace), with visible
  headroom in the UI

---

## 6. Sending — Gmail OAuth

Design is settled in `20-gmail-oauth.md`; restating only what the build needs.

**Scope: `gmail.send` only**, plus `openid` and `email`. Not `gmail.compose` — writing a draft into
the user's Gmail Drafts folder is a *restricted* scope and costs an annual CASA security assessment
in the low-to-mid thousands. Sending outright is cheaper than drafting. Drafts live in our database
and are reviewed in our UI, which is what the prototype already models.

**Adapter, with three implementations over time:**

```
MailboxAdapter
  connect(userId)     -> authUrl
  status(userId)      -> { connected, address, scopes, expiresAt }
  send(userId, msg)   -> { providerMessageId, providerThreadId, sentAt }
  disconnect(userId)
```

`MockMailbox` writes to a table and returns a fake id — this is what M0 and every test run on.
`GmailMailbox` calls `users.messages.send`. A future `OutlookMailbox` hits Graph `Mail.Send`, which
is worth designing for now because a meaningful share of AU SME buyers are on Microsoft 365.

**Flow:** authorisation code with PKCE, `access_type=offline`, `prompt=consent` on first connect so
a refresh token is actually issued, signed short-lived `state` nonce bound to the session,
`login_hint` set to the user's known address. Code exchanged server-side; the client never touches
a token.

**Token storage:** refresh tokens are the most sensitive rows in the database. Own table, envelope
encryption with a KMS-held key, ciphertext plus key version, never logged, never returned over the
API. Access tokens cached with short TTL, not persisted. Treat `invalid_grant` as a first-class
product state — "reconnect Gmail" in the UI, never a silent send failure.

**The trap to write down now:** while the app is in Testing, pre-verification, refresh tokens
expire after **seven days** and the app is capped at 100 test users. That is fine for two accounts,
and it looks exactly like a bug to anyone who does not know.

---

## 7. Auth and tenancy (D5)

Two separate things that get conflated, and conflating them here would be expensive:

1. **Who is logged in to Acquired** — session identity
2. **Which mailbox this user has authorised us to send from** — a delegated capability

**Keep them separate.** Do not use "Sign in with Google" to also obtain `gmail.send`. Reasons: the
Gmail grant must be revocable without locking the user out of the product; not every user connects
a mailbox; incremental authorisation gives a much cleaner consent screen, which is precisely what
Google's verification reviewers grade; and a design partner on Microsoft 365 should still be able
to log in.

**Recommendation: Better Auth**, self-hosted, Postgres-backed, with the organisation plugin.

- Identity data stays in our Sydney database. Clerk and Auth0 are faster to stand up and put user
  records in a US-hosted vendor, which is a question we would rather not answer twice — once for
  the bank and once for the privacy assessment.
- The organisation plugin gives us multi-tenancy on the roles/membership side without building it,
  which satisfies D5's real requirement: few named users now, must not block multi-tenant later.
- Email + password with a strong policy for M0's two accounts; magic link or Google SSO as a later
  login option, independent of the Gmail grant.

**Tenancy from the first migration.** `organisationId` on every domain table, enforced in a query
layer that cannot be bypassed — Postgres row-level security if we are on Supabase, an enforced
`where` clause in a repository layer otherwise. Retrofitting tenancy is one of the two or three
genuinely painful migrations in software, and adding a column that always holds the same value for
six months costs nothing.

**Roles for V1:** `owner`, `analyst`, `viewer`. The approve-and-send gate belongs to `owner` and
`analyst`. Every approval and every send writes an `AuditEvent` naming the human.

---

## 8. UI

Routes, following the prototype's structure since it works for Mark and looks like a deal desk:

```
/mandate      natural language in, structured filters out, confirmation sentence
/targets      the ranked list — this is the main screen
/targets/:id  target detail: firmographics, contact, signal list, score breakdown
/outreach     sequence templates, drafts awaiting approval, the approval queue
/deal-room    documents (later)
/settings     mailbox connection, send caps, suppression list, team
```

`/targets` carries the weight. shadcn `DataTable` with server-side sort and filter, a `Badge` for
the hot/warm/cold band, columns for fit and ripeness as separate compact meters, and a filter rail
for band, state, sector lane, revenue band and signal presence. Row click opens a `Sheet` with the
score breakdown — every Signal, its source link, its weight, its contribution.

Two UI conventions worth making rules:

- **Missing data renders as missing.** `"not shown in register"`, styled as absence, never a dash
  that reads as zero and never a plausible-looking estimate.
- **Provenance is always one click away.** Every generated sentence, every score, every figure has
  a visible path back to what produced it. The prototype's `source: "fallback" | "live"` flag was
  the right instinct at route level; promote it to a component convention.

---

## 9. Sequenced plan

**M0 — by Friday 28 August (two days).** The seven criteria, nothing else.

- Next.js + shadcn + Drizzle + Postgres in Sydney, deployed to Vercel
- Better Auth, two accounts, organisation scoping in the schema
- Mandate parse (harvest the prototype's prompt), persisted
- `TargetSource` interface; Firmable enrichment live against real records; register/seed discovery
- Signal extraction and the deterministic scoring function; cold/warm/hot on the target list
- Outreach step-1 drafting, `MockMailbox`, nothing sends
- Audit trail visible in the UI — criterion 7 is "they can inspect what the system did and why",
  which means a screen, not a log file

*Parallel, blocking nothing:* Google Cloud project, consent screen, privacy policy page, demo
video, `gmail.send` verification submitted. The queue is the long pole; start it now.

**M1 — sequence engine.** All seven steps, `pg-boss` scheduling with business-day delays and
jitter, per-message and block approval, suppression list, unsubscribe, per-account send caps.
Still on `MockMailbox`.

**M2 — inbound reply capture.** Inbound domain and MX, Reply-To routing, parse endpoint, thread
reconstruction, auto-stop-on-reply, deal ladder advancing on real evidence. **This gates automated
sending.**

**M3 — Gmail live.** On verification granted: `GmailMailbox`, connect/disconnect UI, encrypted
token store, reconnect flow, real caps. Sequences move from manual-confirm to automatic.

**M4 — hardening.** AU tenancy decision (D4), bank security review prep, full audit export,
document storage and the finance agent per the original brief.

---

## 10. Decisions needed, and from whom

| | Decision | Owner | Blocking |
|---|---|---|---|
| D1 | Data model shape — lean pipeline vs full platform | Mark | This week, or it gets made by drift |
| A1 | Does the Firmable plan expose search, or is it enrichment-only? | Mark / Firmable | The whole discovery path |
| — | Apollo: is it in scope, and do the terms permit storing and sending to what we pull? | Mark | M1 |
| — | Sender of record — buyer's own mailbox or a platform domain? | Mark | Spam Act analysis, and whether Gmail OAuth is needed at all |
| C4 | Do in-app drafts satisfy "drafting works", or must they land in Gmail Drafts? | Mark | If the latter, that is a restricted scope and a CASA budget line — price it, do not absorb it |
| — | Approval granularity: per message, or per sequence at enrolment? | Mark | M1 |
| — | Domain for sending and inbound MX | Mark | Verification submission and M2 |
| — | Real personal data in M0, or fictionalised at ingest? | Mark | Ingest adapter, this week |
| D5 | Better Auth self-hosted — confirm the AU-residency reasoning holds | Me, with Mark | M0 |

---

## 11. Risks

**Firmable has no search.** Probability: meaningful, given the public API documents lookup by known
identifier and the prototype's own seed data sourced fifteen of sixteen targets from a register.
Mitigation: the `TargetSource` interface makes register-led discovery a first-class path rather
than a fallback, and for a defined sector lane an association member register is arguably the
*better* universe — licensed, verifiable, complete.

**Gmail verification takes longer than expected.** Mitigation: submit this week, single narrow
scope, clean demo video. `MockMailbox` means nothing downstream waits.

**A sequence sends after a reply.** Mitigation: the ordering rule in §5 — reply capture before
automated multi-step sending, manual-confirm mode until then.

**Scores that a finance-trained client cannot verify.** Mitigation: deterministic scoring, Signal
rows behind every number, model confined to extraction.

**Sending volume trips Gmail's limits or the account's reputation.** Mitigation: per-account caps
below Google's, queue with jitter, visible headroom, and no burst path in the code at all.
