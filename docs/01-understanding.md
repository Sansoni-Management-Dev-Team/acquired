# Acquired — what I understand we're building

Status: pre-kickoff. Written from the product brief only; no prototype access yet.

## The engagement

MLAI Studio matches vetted builders to scoped, paid startup projects — "shippable, the kind of
thing a startup actually needs done this quarter". So the frame is: they own product scope,
priority and acceptance; I own delivery and push back on architecture; hand-over quality is part
of the deliverable, not an afterthought.

## The product

**Acquired** runs the SME acquisition pipeline as software. The thesis: most of the work in
buying a small business is legible, repetitive and evidence-driven — sourcing, enriching,
scoring, first contact, RFI, document collection, building a model, packaging for a lender.
Software does that work; humans stay only at the gates that carry trust, compliance or
negotiation risk.

It is not a marketplace and not a CRM. It is a **pipeline with agents in the middle and humans
on the gates**.

## Who it serves (V1)

Two design-partner tracks, one pipeline:

- **Buy-side** — partners with active acquisition mandates. They are the users driving the
  journey: define mandate, approve outreach, run the deal.
- **Lender-side** — a major Australian business bank, receiving a pipeline of bankable deals.
  They are the *consumer* of the output, not a user of the pipeline.

Sell-side (the business owners being approached) are subjects of the system, not users of it,
in V1. Buyer assessment is deferred entirely.

Read this commercially: the bank is the wedge. Buy-side partners generate deal flow; the deal
pack landing on a lender's desk in a shape they'll actually underwrite is the thing that proves
the model. That's why D6 (pack format) is under review with the bank and why the language
discipline rule exists — "lender appetite", never "pre-approved finance".

## The journey

```
mandate → targets sourced → enriched + scored → outreach drafted → [HUMAN GATE: approve]
       → reply captured → RFI → documents into data room
       → finance agent builds model + indicative terms → deal pack → lender
```

Three agents, nothing else:

| Agent | Runs when | Produces |
|---|---|---|
| Screening | after sourcing | ranked target list, fit score, rationale |
| Outreach | after screening | owner-specific drafts, held at a human gate |
| Finance | only once documents land | financial model, indicative terms, deal pack |

The remaining eleven of the fourteen-agent registry are out of scope — the only obligation is
not to design them out.

## What M0 actually is (Fri 28 Aug 2026)

Not a demo. An environment they can put real work through. Seven acceptance criteria:

1. Deployed, not localhost
2. Basic auth, two accounts
3. Persistent storage — survives refresh and redeploy
4. One live connector against real data (Firmable)
5. Mandate → target list → enrichment running on real records
6. Outreach drafting works; nothing sends
7. They can inspect what the system did and why

Everything downstream may stay seeded **provided the adapter boundary is real**. That last
clause is the whole architectural instruction: the seam between mocked and live has to be
load-bearing from day one, because that's what lets the bank's requirements land mid-build
without a rewrite.

## The constraints that shape the build

- **Claude only.** All model calls to Anthropic.
- **Evidence or nothing.** Every score, flag and figure cites its source. Missing data stays
  visibly missing — no silent imputation, no confident nulls. Acceptance-tested.
- **Human gates are real.** The system drafts, a person releases. Nothing sends autonomously.
- **Traceability.** Every stage emits structured data for the next; audit trail from day one.
- **Language discipline.** Business-level lender appetite. Never "pre-approved finance".
- **Adapters everywhere.** Mocked and live interchangeable at every external boundary.
- **No real personal data in dev/test.** Synthetic or fictionalised. Australian hosting in
  target state. Bank security review coming — flag failures now.

Two of these are architecture, not policy. "Evidence or nothing" means provenance is a field on
every derived value, not a logging concern — it has to be in the data model from the first
migration. "Traceability" means the same. Both are cheap on day one and brutal to retrofit.

## Open decisions I must not assume

| | Decision | Why it's hard |
|---|---|---|
| D1 | Data model — lean 4-record pipeline vs full 6-record platform | Most expensive call in the build; migrating later is painful; must be decided in week one or it gets made implicitly |
| D2 | Evolve the prototype or rebuild | Must be deliberate, not drift |
| D3 | Integrations must-have vs mocked, costed | Firmable critical path; also Basiq, CreditorWatch, Xero, Gmail (draft capture only), ASIC |
| D4 | Cloud now, own locked-down AWS tenant later | What would be a rewrite if deferred |
| D5 | Auth and tenancy | Few named users now, must not block multi-tenant later |
| D6 | Lender pack format | Under bank review; generate from structured data so shape can change |

## Things I've already checked

**Firmable's public API is enrichment-only.** The documented endpoint is `GET /company`, bearer
auth, looked up by a known identifier — Firmable ID, ABN, domain, LinkedIn slug or URL. It
returns firmographics, employee count, industry codes, revenue, contact points, ABN status,
locations, technographics. Coverage is roughly 1M+ AU companies and 10M+ people.

That is enrichment. It is not **discovery**. M0 criterion 5 is "mandate → target list →
enrichment", and the mandate→target-list step needs a *search* — give me AU businesses in this
industry, this revenue band, this state, owner likely near retirement. Whether Firmable exposes
that (a search/list endpoint, a bulk export, a Clay-style audience build) is the single biggest
unknown on the M0 critical path, and it's a commercial question as much as a technical one —
API access appears to sit on higher plans.

## Sources

- [MLAI Studio](https://mlai.au/mlai-studio)
- [Firmable](https://firmable.ai/)
- [Firmable API — company enrichment](https://docs.firmable.com/api-reference/endpoint/company-get)

---

## Addendum — second summary from Mark (19 Aug 2026)

Confirms the journey, the three agents, the two user groups and the M0 bar. Three deltas worth
recording:

**1. Firmable is named as the discovery step, not just enrichment.** "Finds potential businesses
using Firmable." That's now a stated product assumption rather than my inference — and it sits
directly against what the public API documents (`GET /company`, lookup by known identifier).
Either there's a search tier we haven't seen, or the sourcing entry point has to change. This is
the first thing to resolve.

**2. The build list adds nothing unexpected but makes the non-M0 half explicit:** document
storage, financial analysis, a flexible deal-pack generator, a full activity and decision audit
trail, adapters around every external service so providers can be swapped, and a path toward
multiple organisations, Australian hosting and bank-grade security. All consistent with the
brief. "So providers can be changed" is a stronger statement than "mocked and live are
interchangeable" — it means the adapter interface has to be modelled on the *domain need*, not
on Firmable's response shape, or we've just renamed the vendor's API.

**3. M0 restated as: real mandates and real Firmable records, through target ranking and
outreach drafting.** Slightly firmer than the seven criteria — it puts real records at the
centre rather than leaving the live connector as one item among seven.

### The conflict this creates

M0 must run on **real Firmable records**. The constraints say **no real personal data in dev or
test — synthetic or fictionalised only**.

Firmable records contain verified mobile numbers and email addresses for named decision makers.
Those are real people. The two requirements cannot both be satisfied literally.

The resolvable reading is: real company data, with personal fields fictionalised at ingest — the
Screening agent scores the business, and the Outreach agent drafts to a fictionalised owner in
M0. That preserves the acceptance bar (real records, real ranking) without putting real
individuals' contact details in a pre-security-review environment.

The unresolvable reading is that Mark wants to run his own live mandate end to end, in which
case M0 is handling real personal data before the bank's security review, and we should be
deliberate about that rather than arrive at it by accident. This is a decision, not a detail.
