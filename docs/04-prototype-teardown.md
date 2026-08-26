# Prototype teardown — acquired-deal-engine.vercel.app

Read from the deployed build (HTML, JS chunks, live API probes) on 19 Aug 2026. No repo access.
Next.js App Router on Vercel, dark "deal desk" UI, title *Acquired — AI Deal Engine*, meta
description "Mandate to bank-grade model, one thread, five layers. Prototype."

## Routes

Six, matching the sidebar exactly: `/mandate` `/targets` `/enrichment` `/outreach` `/deal-room`
`/buyer-assessment`. `/` redirects to `/mandate`.

## State model

One React context (`DealProvider`), `useState`, in memory. Nothing persists. Full shape:

```
mandate, mandateConfirmation, mandateSource
searchRun, targets[], selectedTargetId
contacts{targetId → contact}, drafts{}, approvals{"targetId:channel" → true}
threadOpened, conversation
dealRoomUnlocked, landedFiles[]
financeModel, creditNotes, creditNotesSource, activeCase ("low"|"mid"|"high")
buyerAssessment, selectedBuyerId, submissionPackaged
```

**`const TARGET_ID = "tgt-001"`** is a module constant. Everything downstream of the target list
is hardwired to one company. This is a single-deal narrative demo, not a multi-record pipeline.

Two derived functions worth keeping conceptually:

- **Stage gating** — each stage is `locked | active | done`, derived from state rather than
  stored. Mandate set → targets active; search run → enrichment active; contact enriched →
  outreach active; and so on.
- **Deal status ladder** — `NO DEAL → IDENTIFIED → ENRICHED → OUTREACH QUEUED → WARM →
  RFI FULFILLED → MODELLED → BUYER ASSESSED → SUBMISSION PACKAGED`.

That ladder is a good spec. It's the deal lifecycle stated as an enum, and it should survive
into the real data model roughly as-is.

## The adapter boundary does not exist

The brief says "all integrations mocked behind adapters". What's actually deployed:

```js
let adapter = {
  searchCompanies: async (mandate) =>
    [...SEED_16.filter(t => matchesLocation(t, mandate.location))]
      .sort((a,b) => a.id==="tgt-001" ? -1 : b.id==="tgt-001" ? 1 : b.deskScore - a.deskScore)
};
```

One method. It filters a hardcoded 16-record array on state only — industry, revenue and EBITDA
from the mandate are ignored entirely — then pins `tgt-001` to the top. There is no Firmable
client, no interface, no swap point, and no second implementation.

The "live Firmable pull" is a scripted progress animation: five labelled stages totalling 3.75
seconds — *"Connecting to Firmable API…"*, *"Querying 2.4m Australian companies…"*, *"Applying
mandate filters…"*, *"Overlaying ASIC director records…"*, *"Ranking 16 matches by desk score…"*.
The enrichment and buyer-assessment pages use the same device (*"Retrieving Equifax consumer
credit file…"*).

**This matters for M0.** "Everything downstream may stay seeded, provided the adapter boundary
is real" reads as inherited work. It isn't. The adapter boundary is net-new, and it's the
architecturally load-bearing part of the milestone.

## What is real

Three server routes that call Claude and degrade gracefully:

| Route | Produces |
|---|---|
| `POST /api/mandate` | natural language → structured filter set + confirmation sentence |
| `POST /api/outreach` | owner-specific drafts per channel (email, and others) |
| `POST /api/credit-notes` | analytical notes over the financials |

Each returns a **`source`** field — `"fallback"` with a `reason` when the model call is skipped
or fails, otherwise live. That's the provenance mechanism, and it's surfaced in the UI. Keep the
pattern; it's the right instinct.

Output quality is high. The credit notes are genuinely analytical:

> *"FY24 to FY25 is the story: EBITDA moves from $111,685 to $1,008,705 while revenue moves from
> $8,067,180 to $8,973,887, taking the EBITDA margin from 1.4% to 11.2%. This is a margin
> recovery rather than a volume story, and the GM appointed in FY23 is the obvious candidate
> cause and the single most important diligence question."*

The outreach draft is written the way a person would write it, not the way an LLM defaults to.
Whatever prompting produced these is worth extracting before anything is rebuilt.

## The seed data is the most valuable artefact here

### Target record

```
id, companyName, website, suburb, state, postcode, sectorLane,
source, sourceUrl, dateCaptured,
headcountSignal, revenueEstimate, ebitdaEstimate, capitalIntensityNote,
deskScore, confidence (H|M|L), flags[], notes, phone, estYear, status
```

Flag vocabulary in use: `PRIORITY` `SUCCESSION-SIGNAL` `GM-IN-PLACE` `FINANCIALS-AVAILABLE`
`AMCA-MEMBER` `SINGLE-STATE` `EPONYMOUS` `REGIONAL` `NEEDS-ENRICHMENT`.

**Evidence discipline is genuinely present.** Fifteen of sixteen records carry
`"UNKNOWN from register"` for revenue and EBITDA and `"not shown in register"` for headcount.
Nothing is imputed to look complete. `estYear: null` renders as "not shown in register". This is
the "missing data stays visibly missing" constraint already honoured in the demo data, and it's
the single best sign that the product thinking is sound.

### The sourcing admission

Look at where the sixteen targets come from:

- **tgt-001** — `"Firmable + ASIC overlay"`
- **tgt-002 … tgt-016** — `"AMCA members register"`, with `sourceUrl` of `amca.example/members/…`

AMCA is the Air Conditioning and Mechanical Contractors' Association. Fifteen of sixteen targets
were sourced from an **industry association member register**, not from Firmable. On the targets
page the source chips render `FIRMABLE` and `ASIC` as live and `AMCA REGISTER` as not-live —
which is precisely backwards from what the data says.

The prototype has already conceded the point: **discovery comes from registers; Firmable
enriches.** That's the answer to question A1 sitting in his own demo data, and it's worth putting
to him directly.

It also suggests something better than a generic search: for a defined sector lane, the highest-
quality target universe is the industry association's member list — licensed, verifiable,
complete for that trade. That's a real product idea, and it's cheap.

### Contact / enrichment record — the succession model already exists

```json
{
  "id": "ct-001", "targetId": "tgt-001",
  "name": "Graham Mercer", "role": "Founder & Managing Director", "tenureYears": 28,
  "linkedinUrl": "...", "facebookUrl": "...", "email": "...", "mobile": "...", "whatsapp": "...",
  "enrichmentSources": ["Firmable director record","ASIC company extract","LinkedIn scan","Website team page"],
  "buySideSignals": [
    {"signal":"Owner tenure 28 years",                        "source":"ASIC + LinkedIn",      "weight":"high"},
    {"signal":"GM in place (Dale Whitfield, appointed FY23)", "source":"LinkedIn + website",   "weight":"high"},
    {"signal":"Owner age band 60+",                           "source":"Inferred",             "weight":"medium"},
    {"signal":"No next-generation family in the business",    "source":"LinkedIn scan",        "weight":"medium"},
    {"signal":"Recent plant investment paused",               "source":"Planning records scan","weight":"low"}
  ],
  "ripenessScore": 86, "gmInPlace": true, "ownerOutOfBusiness": false
}
```

This is the succession-signal model I flagged as the real intellectual work of the Screening
agent — and it's already designed, with `{signal, source, weight}` as the atom. Note `"source":
"Inferred"` on owner age: even the inference is labelled as an inference. That triple is the
right shape for the entire evidence layer, not just this record.

Two scores exist and mean different things: **desk score** (does this business match the
mandate) and **ripeness score** (is this owner likely to sell). Keeping them separate is
correct — an ideal business with a 40-year-old owner is not a lead.

### Deal room and finance

Three seeded documents — `Meridian_FY23_P&L.xlsx`, `Meridian_FY24_P&L.xlsx`,
`Meridian_FY25_GL_Export.xlsx`. Finance model keys include `revenue`, `ebitda`, `addBacks`,
`multiple`, `seniorDebt`, `dscr`, across low/mid/high cases.

### Buyer assessment

Deferred in V1 — and the most built-out page in the prototype. Simulated Equifax pull, defaults
and insolvency scan, property equity, net worth, liquid funds, equity release, available to
close, shortfall, sources-and-uses. Worth knowing it exists so we don't rebuild it later from
nothing.

## Recommendation on D2 — rebuild the system, harvest the spec

There is no backend to inherit: no database, no auth, no persistence, no adapter interface, no
domain layer. The one adapter method is a hardcoded filter. Carrying that forward saves nothing
and imports a single-deal assumption (`TARGET_ID`) into the foundations.

What we should harvest, deliberately and by hand:

1. **The three Claude prompts** and their fallback pattern — the outputs are strong and were
   clearly worked on.
2. **The `source` field convention**, promoted from a route-level flag to a first-class
   provenance wrapper on every derived value.
3. **The `{signal, source, weight}` evidence triple** as the shape of the whole evidence layer.
4. **The two-score model** — desk score and ripeness score, separate.
5. **The deal status ladder** and stage-gating logic, as the deal lifecycle enum.
6. **The field vocabulary** — target, contact and flag taxonomy — as the starting draft of the
   D1 schema, since it encodes how Mark actually thinks about a target.
7. **The "UNKNOWN from register" discipline** — as an acceptance test, not a convention.
8. **The design language** — it looks like a deal desk, and it clearly works for him.

So: the brief's own phrase is right. Skeleton and spec by example, not a codebase to inherit.
The prototype is a well-made narrative demo whose *content* is worth more than its code.

## Open questions this raises

- Firmable is named as the discovery layer, but 15 of 16 seeded targets came from an industry
  association register. Which is the intended sourcing path — and has Firmable search actually
  been tested?
- The demo mandate is $2–20m revenue with a $1m EBITDA floor. Mark's own search is $1–5m EBITDA.
  tgt-001 sits at $1.0–1.4m, the very bottom of his band. Is the demo mandate deliberately
  narrower than the real one?
- Buyer assessment is the most complete downstream page and is explicitly out of V1 scope. Is
  that because it's already proven, or because it's the least valuable to the bank?
- Who wrote the prototype, and are they available to explain the prompts?
