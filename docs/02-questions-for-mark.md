# Questions for Mark — Acquired kickoff

Each question has my **working assumption** attached. If a question doesn't get answered, I
proceed on the assumption and flag it rather than stall. Anything marked **BLOCKER** genuinely
stops work.

Ordered by how much damage a wrong answer does.

---

## A. Blocks the M0 critical path

**A1. BLOCKER — Do we have a Firmable contract, and does it include search, or only
enrichment?**
Your summary says Acquired "finds potential businesses using Firmable". The public API is
enrichment-only: `GET /company`, looked up by ABN, domain, LinkedIn slug or Firmable ID. It
answers "tell me about this company", not "find me companies matching this mandate". If there's
a search/audience/bulk-export tier you've seen and I haven't, point me at it. If there isn't,
the sourcing entry point has to change — ASIC/ABR for the universe, Firmable enriching on top —
and that's a product change, not just a plumbing one.
*Assumption if unanswered:* enrichment-only; I build sourcing against an ABR/ASIC-derived
universe and use Firmable to enrich, and the adapter hides the difference.

**A2. BLOCKER — Who holds the Firmable credentials, on what plan, and when do I get a key?**
API access sits on higher tiers. If the key lands in week two, the one live connector in M0
doesn't happen. I need it in the first few days.
*Assumption if unanswered:* no key until day 5, and I build live-first against the mock so the
swap is a config change.

**A3. Your own search is the reference mandate — let's model it explicitly.**
Your profile gives me the spine: one Australian SMB, $1–5M EBITDA, strong fundamentals, owner
thinking succession or exit. What I still need is the rest of the filter — industries you'd
take and industries you'd never touch, geography (national or Victoria-weighted), minimum
trading history, customer-concentration limits, owner-dependence tolerance, whether you'd take
a business needing a licence you don't hold, and anything that's an instant no.
*Assumption if unanswered:* I model the mandate schema on your stated criteria plus standard ETA
disqualifiers, and you correct it in week one.

**A3b. "Owner thinking about succession or exit" is the signal that makes this product work,
and I don't think Firmable has it.**
Firmable has firmographics, revenue, headcount, tech stack, hiring and funding signals. It does
not have "the founder is 62, sole director, 28 years in, no successor". That has to be derived —
ASIC director records for age, tenure, appointment date and sole-director structure; LinkedIn
tenure; ownership concentration. How do *you* spot it today, manually? Your heuristics here are
worth more to the Screening agent than anything else in this list.

**A4. What makes a target a good fit — in your words, ranked?**
The screening agent produces a fit score. A score nobody trusts is worse than no score, and
you'll be the first person to stress-test it. I need your actual heuristics and their relative
weight, and specifically which signals are disqualifying rather than merely negative.
*Assumption if unanswered:* transparent weighted-factor scoring with every factor's contribution
and source shown, weights editable in config, no black-box number.

**A5. Where does the prototype live, and can I have it?**
D2 (evolve vs rebuild) isn't answerable without reading it. Repo access, or a Vercel URL and a
zip.
*Assumption if unanswered:* rebuild, treating the prototype as a spec by example.

---

## B. D1 — the data model, needed in week one

**B1. Which of the six platform records carry meaning that the lean four can't hold, in V1?**
The gap between `target/contact/conversation/deal` and
`business/seller/deal/buyer/offer/partner` is mostly three things: separating the *business*
from the *seller* as a person, making the *offer* a first-class versioned object, and making
*partner* an explicit tenancy boundary. My instinct is that the first and third are cheap now
and expensive later, and *offer* can wait until buyer assessment comes back in scope. I want to
test that against how you actually think about a deal.

**B2. Can one business be under mandate from two different buy-side partners at once?**
This is the question that decides whether `business` is a shared record with partner-scoped
overlays, or whether each partner gets their own copy. It's a one-line answer now and a
migration later.
*Assumption if unanswered:* yes, eventually — shared business record, partner-scoped everything
else.

**B3. Does the lender see deals, or a pipeline?**
Whether the bank's view is per-deal (a pack lands, they assess it) or portfolio-level (they
watch a funnel) changes what we persist and what the partner record has to support.
*Assumption if unanswered:* per-deal pack in V1, structured so a portfolio view is a query, not
a rebuild.

**B4. What does "indicative terms" mean concretely, and who is accountable for the numbers?**
The finance agent producing figures that go to a bank is the highest-risk output in the system.
I want to know what it's allowed to assert, what must be marked as an assumption, and whose
sign-off sits between the model and the pack.
*Assumption if unanswered:* every figure carries source or is labelled an assumption; a human
gate sits before the pack leaves the system, same as outreach.

---

## C. Scope and acceptance

**C1. Confirm the M0 date. Two weeks from the brief reads as Friday 28 August 2026 — that's
nine days from today, not fourteen.**
I'll tell you at kickoff which of the seven criteria I'd trade, but I want to be sure we're
counting the same days first.

**C2. Which of the seven M0 criteria would you sacrifice first, if I have to?**
You said you'd rather cut scope than get a demo that can't take real input. My read of the
cheapest cut is #4 — the live connector — because a real adapter boundary with a mocked
Firmable still satisfies the *architecture*, and the key may not arrive in time anyway. But
you've called Firmable the critical path, so I want your ranking, not mine.

**C3. "I can inspect what the system did and why" — what does that look like for you?**
A run log per pipeline stage? A per-target evidence panel showing every field and its source?
Raw prompts and responses? All three are buildable in M0; they're different amounts of work and
different products.
*Assumption if unanswered:* per-record evidence panel (every derived value → its source) plus a
run timeline per stage, with prompt/response inspectable behind it.

**C4. Outreach drafting "works, nothing sends" — where does the draft end up?**
Held in-app only, or written to a Gmail drafts folder? You listed Gmail as draft-capture-only,
which I read as *inbound* reply capture, but it's worth being explicit.
*Assumption if unanswered:* drafts live in-app in M0; Gmail is inbound reply capture, deferred.

**C5. Two accounts — which two?**
You and me, or you and someone from a design partner? It changes whether tenancy shows up in
M0 or is just a column.

---

## D. Integrations and spend (D3)

**D6. What's the budget envelope for API and licensing spend in V1, and who approves it?**
You want it costed for approval. Give me the ceiling and I'll classify against it rather than
sending you a list you have to reject.

**D7. For each of Basiq, CreditorWatch, Xero, ASIC — do you already have accounts?**
Existing access changes must-have vs mocked more than the price does. My initial read:
- **ASIC/ABR** — cheap or free, likely the real sourcing universe. Must-have if A1 comes back
  enrichment-only.
- **CreditorWatch** — the credit and adverse-signal layer; matters to the bank; V1 candidate.
- **Xero** — only meaningful once a seller grants access post-NDA. Adapter now, live later.
- **Basiq** — bank-feed verification, later still. Mock.
- **Gmail** — inbound reply capture. Deferred, adapter only.

**D8. Is there an existing lender pack — even a bad one — that a deal has actually gone out in?**
D6 says generate from structured data, which I agree with. But I need one concrete instance to
know what fields the structure must be able to produce.

---

## E. Compliance and the bank's security review

**E1. When does the bank's security review happen, and can I see their requirements list early
rather than at the end?**
You said pilot requirements land mid-build. Any part of that list I can see now is worth more
than the whole list later.

**E2. Australian hosting — is that a target-state requirement, or does M0 need to be in an AU
region on day one?**
Vercel and most managed Postgres offer Sydney regions; pinning to `syd1`/`ap-southeast-2` from
the first deploy costs nothing now and avoids a migration. I'd just do it unless you tell me
otherwise.
*Assumption if unanswered:* everything in ap-southeast-2 from day one.

**E3. BLOCKER — Two requirements conflict, and only you can resolve it.**
M0 must run on "real mandates and real Firmable records". The constraints say "no real personal
data in dev or test — synthetic or fictionalised only". Firmable records contain verified mobile
numbers and email addresses for named decision makers. Those are real people.

Two readings:
- **Split the difference** — real company data, personal fields fictionalised at ingest.
  Screening scores the real business; Outreach drafts to a fictionalised owner. Preserves the
  acceptance bar, keeps real individuals out of a pre-security-review environment.
- **Run it live** — you put your own real mandate through, real owners and all. Defensible, but
  it means M0 is handling real personal data before the bank has reviewed anything, and we
  should choose that on purpose.

This decides whether M0 can run on real records at all, and it's the kind of thing a bank asks
about later.
*Assumption if unanswered:* split the difference — real company data, contact fields
fictionalised at ingest, with the fictionalisation a toggle we can turn off once reviewed.

**E4. When outreach eventually sends — who is the sender, legally?**
You, a partner entity, or the platform? It's a spam-law and identity question, not a technical
one, and it shapes the outreach data model. Doesn't block M0 since nothing sends.

---

## F. Working arrangement

**F1. What's your availability for the D1 decision, and what forum?**
The brief says decided together in week one, and that if it slips it gets made implicitly. I'd
like a scheduled hour this week rather than async.

**F2. Where do decisions get recorded?**
I'll keep an ADR log in the repo by default — one file per decision, with the reversal cost
written down at the time. Tell me if you want it somewhere you'll actually read it.

**F0. Who owns Acquired?**
You're Head of AI at Sansoni Management. Is Acquired yours, Sansoni's, or a joint thing? It
changes who I'm building for, whose security posture applies, and who the two M0 accounts belong
to.

**F0b. Is the bank ANZ?**
You worked alongside ANZ at DataCo, a 1835i portfolio company. If the "major Australian business
bank" is ANZ and the relationship is warm, that's materially better than a cold enterprise
procurement path — and it means we can probably get their pilot requirements earlier than "mid-
build". Worth asking them now.

**F3. What happens after M0?**
Is there a defined V1 end date and budget, or is M0 the gate that decides whether there's more?
Affects how much I invest in foundations versus getting the seven criteria green.
