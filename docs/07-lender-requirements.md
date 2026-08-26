# What the lender actually needs, and what hurts them

Researched 19 Aug 2026. This is the leg the brief defers and the competitive sweep found empty,
so it's the one worth understanding before D1 and D6 get decided.

**Source quality caveat, stated up front.** The most detailed material — deposit ranges, DSCR
thresholds, goodwill LVRs — comes from Australian commercial broker content marketing
(broker.com.au and similar). It is consistent across sources and consistent with how the market
is known to work, but it is SEO content, some of it plausibly AI-written, and none of it is a
lender's published credit policy. The structural and pain-point material from The Adviser, MPA,
ASBFEO, the RBA and Judo Bank is solid. **Treat the numbers below as a hypothesis to validate
with the bank, not as policy.** Getting one real credit policy or one real declined submission
from ANZ is worth more than everything here.

---

## Part 1 — What a lender needs to see

### The frame

Australian business lending still runs on the three Cs: **Character** (does the buyer know this
industry), **Capacity** (does the business service the debt from its own cash flow), **Collateral**
(what backs it if it fails). Acquisition lending is hard because the buyer has no track record
in the business and most of the purchase price is goodwill, which a bank cannot repossess.

### Documents required

**On the target business**
- Two to three years of P&L and balance sheets; some lenders ask three to five
- Business tax returns, same period
- Aged receivables and aged payables listings
- BAS lodgement history (gaps are a red flag in themselves)
- Copy of the commercial lease, or valuation if property is included
- Section 52 vendor statement (Victoria and some other states, for small business sales)
- PPSR search confirming assets aren't already encumbered
- Licences, contracts and compliance records
- Independent valuation from an API- or RICS-qualified valuer — allow 10–14 business days

**On the buyer**
- Personal Statement of Position (assets, liabilities, income) for every director
- Personal tax returns, two years
- Credit file
- CV or industry credentials — "management equity", the evidence they can run it

**On the deal**
- Signed LOI or conditional contract of sale
- Business plan covering how revenue survives the ownership change
- 12-month combined cash flow forecast, integration costs included
- Sources and uses
- Normalised EBITDA with add-backs itemised

### The numbers to model against

| Test | Typical requirement |
|---|---|
| DSCR | 1.25x target; range quoted 1.2–1.5x |
| DSCR stress test | serviceable at ~9.5–10% interest, not the actual rate |
| Buyer equity | 20–40% of purchase price; 30–50% where goodwill-heavy |
| LVR overall | 60–80% depending on industry and cash flow |
| LVR against goodwill | 50–70% at best, frequently less |
| Working capital | 90 days minimum, post-completion |
| Customer concentration | any single client >20% of revenue is a red flag |
| Market multiples | sub-$1m businesses ~2.8x SDE; $2–5m ~4.0x EBITDA |
| Indicative pricing | secured 6–9%; unsecured 8–12%+; private credit 10–18% |
| Time to settlement | 4–8 weeks |

### Add-backs — accepted and contested

Accepted: one-off legal fees, personal vehicle expenses, non-recurring repairs, owner salary
above market rate.

Every one of these increases EBITDA and therefore borrowing capacity, which is exactly why
lenders scrutinise them. The practitioner rule of thumb from the Reddit sweep — **add-backs over
20% of total cash flow means walk or reprice** — is the discipline the Finance agent must
enforce on itself. If Acquired produces a pack whose add-backs a credit assessor strips out, the
deal doesn't just fail, the tool loses credibility with the bank permanently.

### The goodwill distinction that decides most deals

Lenders separate **business goodwill** — systems, brand, recurring contracts, a management team
— from **personal goodwill**, where revenue depends on the departing owner's relationships.
Personal goodwill is described as a major red flag.

This is the single most important thing for the product, because it connects directly to the
Screening agent. `GM-IN-PLACE` and `ownerOutOfBusiness` in the prototype are not just succession
signals — **they are the difference between lendable and unlendable goodwill.** A business where
the owner is the business scores well on "ripeness" and badly on financeability. Those two scores
can point in opposite directions, and the system should say so out loud rather than average them
away.

### What a credit paper contains

From a private credit fund's description, the structure is: business, operations and market
review; **key risks and mitigants**; detailed financials and model; negotiated structure; terms.

The "risks and mitigants" section is the heart of it, and it's the part software can genuinely
help with — every risk the pack raises needs a named mitigant, and both need a source. Key person
risk in particular requires an explicit mitigation plan, not a mention.

---

## Part 2 — Where the pain actually is

### The gap is real and quantified

Judo Bank's SME Banking Insights put the unmet lending need for Australian SMEs turning over
$1–20m at **$94.3 billion** in 2021, up $4.6bn on 2019, with a further $119.2bn for the $20–50m
band. Small business loan applications have fallen **33% since 2014** (ASBFEO). A brokers' survey
found **46% of SME finance enquiries never became a loan application at all.**

That last number is the one to sit with. Nearly half of the demand dies before a bank ever sees
a submission — not declined, never presented. **The bottleneck is origination, not credit
appetite.** Which is precisely what the r/AusFinance thread showed from the buyer's side: a
creditworthy buyer, a profitable business at 3x NPAT, four lenders, no loan.

### What the banker's side of it feels like

From broker satisfaction research (Broker Pulse, reported in The Adviser):

- Credit assessor **policy consistency fell from 78% to 56%** over six months, declining every
  month.
- **37% of major-bank interactions** were classed as inconsistent, against much better non-bank
  performance.
- Major-bank BDM satisfaction dropped to **62%**, versus **86%** for non-banks.
- *"Have had lots of yes applications that turn to no when it gets to actual credit assessment.
  Very frustrating for me and my clients."*
- On delays: *"The amount of shuffling between different levels of credit divisions is the cause
  of these delays, not volume or training new staff."*

Read from the bank's side rather than the broker's, the picture is consistent: submissions arrive
in inconsistent shapes, get re-worked across multiple credit levels, generate repeated
information requests, and burn assessor time on deals that were never going to clear policy. An
hour-long phone call that ends in "we don't lend to new owners" — the AusFinance experience — is
an hour lost on both sides of the table.

An industry commentator quoted in MPA framed the opportunity exactly: the win is *standardising
a credit submission so that when brokers sent it to banks it would fit right into* the bank's
process. Described as a workflow problem. Nobody has productised it.

### The four pains, named

1. **Deal flow arrives unqualified.** Assessors spend time on submissions that fail policy on
   facts knowable at the start — new-owner purchase, goodwill-heavy with no security, DSCR that
   never clears at stress rate.
2. **Submissions arrive in inconsistent shapes.** Every broker's pack is different, so every
   assessment starts with reconstruction rather than assessment.
3. **Iterative information requests.** Missing aged receivables, no PPSR, no Section 52,
   unsupported add-backs — each round trip adds days and re-queues the file.
4. **Unverifiable numbers.** Add-backs asserted without source. The assessor's job becomes
   forensic rather than analytical.

---

## Part 3 — What this means for Acquired

Every one of those four pains maps onto something already in the brief, which is a good sign the
thesis is sound.

| Bank pain | What answers it |
|---|---|
| Unqualified deal flow | Screening scored against **lender** criteria, not just buyer fit — surface DSCR-at-stress-rate and goodwill mix before outreach, not after LOI |
| Inconsistent submission shape | D6: pack generated from structured data to the bank's own template |
| Iterative information requests | The RFI stage as a completeness gate — the pack cannot be produced until the required document set has landed |
| Unverifiable numbers | "Evidence or nothing" — every figure cites its source; add-backs itemised, sourced, totalled as a % of cash flow |

**Three consequences worth acting on:**

**A third score is needed.** The prototype has desk score (mandate fit) and ripeness score (will
they sell). The lender leg needs **financeability** — DSCR at stress rate, goodwill proportion,
customer concentration, personal-versus-business goodwill, lease term remaining, BAS currency.
It is computable from data the Screening and Enrichment agents already gather, it is the thing
the bank cares about, and it can be shown early enough to stop a searcher wasting three months
on an unfundable target. That is a genuinely differentiated feature and no competitor has it.

**Financeability and ripeness can disagree, and the system should say so.** An owner-dependent
business with no GM is maximally ripe and minimally lendable. Averaging those into one number
destroys the most useful thing the system knows.

**The pack's data requirements should be modelled now, even though the pack is deferred.** This
is D1's real test. If the data model can't hold aged receivables, itemised add-backs with
sources, a sources-and-uses, and a risks-and-mitigants register with a mitigant per risk, the
pack becomes a rebuild rather than a template change — which is the exact failure D6 exists to
prevent.

---

## What to ask the bank

Ordered by value. The first three are worth more than all the desk research above.

1. **One real credit policy extract** for business acquisition lending, or the current
   requirements checklist. Replaces every estimate in Part 1 with fact.
2. **Two or three recently declined acquisition submissions**, redacted. Declines teach more than
   approvals: they show what was missing, what was disbelieved, and where the assessment stopped.
3. **The template or headings the credit paper actually uses**, so D6 generates into their shape
   from day one.
4. What proportion of acquisition enquiries are declined on facts knowable before assessment
   begins? That number sizes the pre-qualification opportunity directly.
5. Which add-backs do assessors routinely strip out?
6. What's the current DSCR floor and the stress rate applied?
7. Is there appetite specifically for **new-owner** purchases, or is the r/AusFinance experience
   ("we only lend to existing owners to grow") current policy?
8. Who reads the pack — relationship banker, credit analyst, or committee? Different readers want
   different documents.

## Sources

- [Broker.com.au — business acquisition finance requirements](https://www.broker.com.au/blog/business-acquisition-finance-requirements/) · [buying a business 2026 guide](https://www.broker.com.au/blog/buy-a-business-in-australia-2026-guide/) · [goodwill valuation](https://www.broker.com.au/blog/goodwill-valuation-australian-business-2026/) · [acquisition finance 2026](https://www.broker.com.au/blog/business-acquisition-finance-australia-2026/)
- [Australia Business Broker — financing a business purchase](https://australiabusinessbroker.com.au/how-to-finance-buying-a-business-in-australia/)
- [The Adviser — brokers call for credit assessor consistency](https://www.theadviser.com.au/broker/41280-brokers-call-for-credit-assessor-consistency)
- [Judo Bank — SME Banking Insights](https://www.judo.bank/smeconomics/sme-banking-insights-2021)
- [ASBFEO — access to finance](https://www.asbfeo.gov.au/media-centre/media-releases/ombudsman-shares-rba-concern-over-small-business-access-finance)
- [RBA Bulletin — Access to Small Business Finance](https://www.rba.gov.au/publications/bulletin/2018/sep/access-to-small-business-finance.html)
