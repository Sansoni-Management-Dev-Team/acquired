# Practitioner critique — what lands, and what the thesis becomes

20 Aug 2026. An independent practitioner review of docs 01, 07 and 09–15 arrived after the
self-critique in [doc 18](18-self-critique.md). **Most of it lands.** This document records the
attacks I accept, the corrections they force, and the revised position.

Summary judgement, which I accept: **the mechanism is real, but the completeness arbitrage does not
survive as a claim about a defensible, compounding, learnable information asset in Acquired's own
market.** It survives as a good explanation of why the product is useful. That is a demotion from
thesis to framing, and the rest of this document is the reasoning.

---

## Part 1 — The attack I should have made myself

**I never applied my own screening test to my own market.**

Doc 13, Revision 1 states the boundary condition: *"The completeness arbitrage exists only where a
low-cost continuous intermediary is absent, unaffordable, or itself episodic."* I applied it to
patent prosecution, where it falsified the case. I never applied it to Australian acquisition
finance.

Applied properly: **Australian commercial finance broking is exactly that intermediary.** Thousands
of accredited brokers, paid by lender settlement commission plus trail, so the marginal price to the
borrower is approximately zero — and their stock-in-trade is precisely the two things doc 15
nominates as our product: *which lender will take this deal*, and *what to put in front of them*.
Add accountants for normalised EBITDA.

Worse, this breaks doc 09's stated reason the arbitrage persists. Reason 2 was *"the intermediary is
paid by the hour… time-based billing does not punish iteration — it bills it."* **That is true of
probate solicitors and false of finance brokers**, who are paid on settlement and therefore have the
strongest possible incentive to get it right first time. They are the "party who has committed to a
fixed price for getting through the gate" that doc 13's own billing-model test names as the only
natural buyer.

So in Acquired's market the stated mechanism of persistence is absent, and the party who wants the
loop dead already exists and is paid to kill it. Doc 12's own u/FL_Biz_Broker — 250+ closings,
publishes the full documentation guide, knows "different banks do different deals" — *is* that
intermediary, in our domain, doing the job.

**This is the most damaging finding in the programme and I generated the tool that produces it, then
failed to point it at myself.**

## Part 2 — The Layer 3 argument is a non sequitur

Doc 15 evidences Layer 3's durability with gatekeeper-side automation failing to move outcomes
(CMS prior-auth decisions became instantaneous, denial rates did not move), then concludes "the good
news is that our layer is the durable one".

**The same evidence is a moat argument and a futility argument.** You cannot claim a layer is
defensible *because* software has never moved it and then sell software to move it.

The narrower version that might survive: *Layer 3 has resisted **gatekeeper-side** automation, which
says nothing about **applicant-side** assistance.* Doc 15 never draws that distinction, and every
piece of its Layer 3 evidence is gatekeeper-side. Accepted, and doc 15 needs that distinction made
explicitly or the conclusion withdrawn.

The 510(k) support dissolves the same way: two-thirds of submissions drawing a first-cycle
Additional Information request is **normal iterative regulatory dialogue** — structurally identical
to patent first-action rejections, which doc 13 correctly classifies as expected, priced in, and
therefore *not* an arbitrage. I used it as proof of unfixable substantive failure anyway.

## Part 3 — Layer 3 is credit judgement, and I kept relabelling "no" as "incomplete no"

> "If the add-backs are not provable, EBITDA is genuinely lower, DSCR genuinely fails at the stress
> rate, and the bank is not asking for more paper — **it is telling you the price is wrong.**"

Accepted, and this is the error a vendor is *motivated* to make: every substantive decline
reclassified as documentary inflates the addressable market. A first-time buyer with no industry
experience buying an owner-dependent business is not missing a document — they are missing the thing
the bank lends against. Doc 07 gets this right in isolation (personal versus business goodwill as
the lendable/unlendable line); doc 15 folds it back into the completeness frame.

A credit officer spots this in thirty seconds. It has to come out of the pitch.

## Part 4 — Why substantive sufficiency is not learnable from outside

The five determinants are internal and non-stationary: industry appetite tables that move within a
half and are transmitted by informal BDM phone call; delegated lending authority, so the same policy
is applied differently by ticket size; exceptions that turn on what the assessor can defend upward
to their credit reviewer; stress rates and DSCR floors as versioned internal settings; and who
actually reads the pack.

**And the learning-rate arithmetic, which nobody in the corpus attempted.** To learn "which add-backs
Bank X strips in fitness businesses" you need dozens of Bank X decisions in that industry with clean
labels. At 20–40 deals a year across four or five lenders and twenty-odd industries, that is
**single-digit observations per cell per year** against a requirement set that changes faster than
that. You never reach power in any cell that matters.

Compounding it: **the labels are censored.** Banks give generic decline reasons ("did not meet our
lending criteria"), and doc 12's own practitioner says get it in writing because "half the time the
verbal reason and the written reason are different". And **the only good training data is data you
are contractually barred from generalising** — doc 07's ask (a real credit policy extract, redacted
declines) arrives under a confidentiality deed, after which it cannot be used in a multi-tenant
product serving other lenders. The asset cannot be pooled across the axis that would make it
valuable.

This kills "the requirement set becomes a compounding data asset" as stated in docs 09, 11 and 14.
What survives is much smaller: **the recurring, cross-lender objection taxonomy** — contested
add-backs, BAS gaps, unreleased PPSR interests, lease assignment, missing vendor statements. Those
repeat, are observable, and a first-time buyer genuinely does not know them.

## Part 5 — And the Westpac datapoint cuts against me

I presented "over three-quarters of simple deals are now auto-decisioned" plus "designed to halve
banker processing time" as proof that the judgement-heavy residual is preserved for us. The better
reading: **a bank is spending capital building the completeness product for itself, from the inside,
with the policy, the data and the officers.** The residual is not preserved — it is the next roadmap
item, attacked by the only party who can see the five unobservables above. "The residual resists
automation" is a warning about our own product, not a moat.

## Part 6 — Two statistical corrections

**The 82% prior-auth overturn rate is conditioned on the appealed subset.** Doc 09 put both
statistics in one paragraph and they destroy each other: appeals are launched by the party who
believes the denial is wrong *and* holds the evidence to prove it, so conditioning on appeal selects
for winnability and says nothing about the unappealed 89%. "Overturned in whole or in part" also
bundles partial overturns. The unbiased comparator is roughly an order of magnitude lower — HHS OIG's
audit of the *denial* population in Medicare Advantage found ~13% would have been approved under
Medicare rules *(cited from the reviewer's recall; verify before use)*. Doc 09 called the 82% figure
"the whole thesis". **Withdrawn.**

**The TPD gap is worse than my own correction allowed.** I had already downgraded it after checking
APRA's glossary. The reviewer goes further and is right: direct TPD is typically sold with limited or
no underwriting at inception, often on "any occupation" or activities-of-daily-living definitions,
while advised TPD is typically fully underwritten on "own occupation". **Those two design facts alone
predict a large admittance gap with zero information-asymmetry effect** — not-underwritten-at-inception
policies generate non-disclosure declines at claim, and ADL definitions are harder to satisfy on the
merits. ASIC REP 587 (*The sale of direct life insurance*, 2018) diagnosed direct-channel outcomes as
product-design and sales-practice failures, not evidence-assembly failures. The claims-paid *ratio* is
worse still, being dollar-weighted across different sums insured. **"Priced by the regulator's own
data" is withdrawn entirely.**

## Part 7 — The NSW falsification is over-read, and I marked it high confidence

I claimed NSW proves digitising the channel makes completeness worse, and marked it high confidence
because I read the PDF myself. **The PDF is primary; my inference was not.**

Portal-only lodgement became mandatory in July 2021. The paper's baseline is **FY2021/22** — which
begins at the mandate. So 15%→27% is **portal-to-portal, not paper-to-portal**, and cannot support
the claim I built on it. More plausible explanations for the rise: "return" became a formally counted
workflow action where councils previously sat on files informally; the definition and practice
matured over five years; and requirement mix changed as BASIX, bushfire and flood controls were
added. The per-council spread (Fairfield 63%, Liverpool 56%) tracks applicant population
characteristics at least as well as channel design — making it an **applicant-capability** finding
rather than a Layer 1 one.

**The layer taxonomy survives as a design heuristic. Its headline evidence does not.** What would
settle it: NSW return rates for FY2019/20 and FY2020/21 plus the Department's definition-change
history. If pre-mandate returns were never measured, the falsification claim must be withdrawn
rather than weakened.

Companies House cuts the other way but is close to circular — the online form structurally cannot be
submitted incomplete, and paper filers are a self-selected residual of the complex and unadvised.

## Part 8 — "Tacit" is largely false in our market, and the real diagnosis is better

Doc 07 reconstructed a plausible full requirement list from public broker content in an afternoon.
Doc 12's practitioner says it "shouldn't be a mystery" and another broker publishes it in full. And
doc 14's evidence for tacitness — the RBA's "banks are reluctant to provide them with advice on how
to obtain finance" — is a *different claim*: a bank declining to advise, for licensing and liability
reasons, is not the requirements being unknowable.

Meanwhile doc 14 reports the finding that actually explains the failure and buries it: **45% of small
businesses do not use accounting software.** That is bookkeeping, not information asymmetry. No
requirement-set product creates three years of reconciled accounts for a cash-heavy café whose owner
runs personal spend through the business.

**Revised diagnosis: under-advised, not uninformed — and nobody shops.** ASBFEO's "only one in a
hundred business owners over 30 would consider changing banks" is a search-and-habit failure, not a
knowledge asymmetry. Still an opportunity. Different opportunity, different economics, and it changes
who the customer is.

## Part 9 — Liability, properly stated

My self-critique flagged this; the reviewer makes it concrete and it is worse than I wrote.

**The corpus is entirely about false negatives; the liability runs the other way.** Every number
concerns good deals killed by paperwork. But the flagship product — "is this bankable?" answered on
day one — fails through **false positives**: a buyer pays a non-refundable deposit and $40k of due
diligence, then gets declined. Nothing in docs 09–17 discusses calibration, thresholds, or what the
system says when it does not know. And "bankable: yes" quietly violates doc 01's own **evidence-or-
nothing** rule, being a derived judgement with no citable source by construction.

Three specific perimeters:

1. **ACL s4.** "This deal is bankable" is a representation as to a future matter, **deemed misleading
   unless the maker shows reasonable grounds, with the onus on the maker** — and s18 cannot be
   contracted out of, so SaaS disclaimers do not save it. Mitigations are cheap: express output as
   ranked lender appetite with the specific policy tests that pass and fail plus the evidence behind
   each, never a verdict; record the basis for every component so reasonable grounds are
   demonstrable; and make **"insufficient information to assess" a first-class output state.**
2. **NCCP s29 credit assistance** — a criminal offence if unlicensed. Business-purpose lending sits
   largely outside via the business-purpose declaration, but the boundary cases are the *normal*
   case here: the buyer pledging the family home (doc 14: residentially-secured SME loans average
   4.5x larger), mixed purpose, sole traders. **Appetite routing is recommending a credit provider**,
   so this goes live the moment routing ships.
3. **Legal Profession Uniform Law s10.** Section 52 vendor statements, lease assignments, PPSR
   releases and LOIs — producing them or assessing their sufficiency is legal practice. **The probate
   recommendation is much worse**: docs 09 and 13 rank it the best second bet across thousands of
   words without mentioning that software telling a lay person whether their probate application is
   sufficient sits near the centre of that prohibition. The workable form is a lawyer-facing tool
   inside a firm under supervision — which changes the buyer, the price and the go-to-market.

Plus a structural conflict I had not seen: doc 01 has the bank consuming the output while the
buy-side drives the pipeline. **If Acquired is ever paid by the lender while telling a buyer a deal
is bankable, that is an undisclosed conflict** of the kind ASIC and the Banking Code care about, and
it is structural rather than curable by disclosure.

**Action: half a day with a financial-services regulatory lawyer, before D6, on three questions** —
the NCCP perimeter for business-purpose acquisition finance with residential security; whether a
bankability score or appetite ranking is credit assistance or financial product advice; and whether
pack assembly touching Section 52 and lease assignment is legal practice. Definitive answers exist.

## Part 10 — The bank is a worse customer than I claimed

Doc 10 said the bank is the better counterparty and that its handling cost on declined files is the
pitch. **Nobody in a major Australian bank has a budget line called "cost to assess declined files",
and no scorecard moves if it falls** — business banking is measured on book growth, NIM, arrears and
regulatory risk. And the bank has *already* outsourced origination completeness and pays for it out
of margin: that is what broker commission buys.

Then the operational reality I had at the wrong altitude: a startup handling customer financial data
for a major Australian bank is a **material service provider under APRA CPS 230** (effective 1 July
2025) plus CPS 234 — third-party risk assessment, continuity attestation, exit planning, penetration
testing, contractual notification. Realistically **6–18 months for a small team**, gated by
procurement. That is not a thesis problem; it is a timeline and cashflow problem that decides whether
bank-side revenue exists inside this engagement at all, and it largely decides **D4**.

## Part 11 — What survives

The reviewer's own list of what holds, which I accept as the honest residue:

- **The three-layer taxonomy as a design heuristic**, and "never build a Layer 1 product" as a
  correct and hard-won discipline.
- **Doc 07 is the strongest document in the set, and the least arbitrage-flavoured.** Financeability
  as a third score computable before outreach. Personal versus business goodwill as the
  lendable/unlendable line. Ripeness and financeability pointing opposite ways with the system saying
  so instead of averaging. Add-backs above 20% of cash flow meaning walk or reprice. **None of it
  depends on the arbitrage being true, and all of it is right.**
- **Completeness is not maximalism** — the 39-document visa refusal as the cautionary tale. Hand a
  credit analyst 400 pages and they ask for a summary and think less of you.
- **"We cannot sell escalation"** (doc 12) is the most credible sentence in the corpus — and doc 15
  contradicts it by headlining appetite routing without reconciliation.
- **Appetite variance is real**; the disagreement is over who owns that product.
- **Stock versus flow** (doc 13) and the **measurement gap** both stand.

## Part 12 — The revised position

Accepted in full:

1. **Demote the completeness arbitrage from thesis to framing.** It explains why the product is
   useful. It is not a defensible compounding asset in this market.
2. **Doc 07 is the product spec**, not doc 09. Financeability screening plus disciplined pack
   production for the buy-side searcher, priced as a **workflow tool** — not as an information
   monopoly.
3. **Get the regulatory perimeter answered in writing before D6.**
4. **Treat bank-side revenue as a 12-month CPS 230 project**, not a wedge. Buy-side pays first.
5. **Reconcile appetite routing with "we cannot sell escalation"** — or drop routing until the NCCP
   question is answered.
6. **Add to the questions for Mark:** how often does published credit policy get exceptioned, and who
   decides? If the answer is "routinely, by the credit manager", appetite routing is a relationship
   product and software cannot hold it.
7. **Interview five Australian commercial brokers who write acquisition deals.** How many lenders do
   you shop a goodwill-heavy acquisition to; how do you know current appetite; what share of
   submissions draw an information request; what would you pay to halve that. **If the answer to the
   last is "nothing, that's my job", the product is a broker tool and should be built and priced as
   one.** This single set of interviews is worth more than another research round.

---

## What this does not change

M0 is still due 28 August, and none of the above alters the seven acceptance criteria. The build
implications are narrow: keep provenance and the audit trail (they are now liability controls, not
just principles), make "insufficient information to assess" a first-class state in the data model,
and do not ship anything that renders a bankability verdict until the regulatory questions are
answered. Everything else here is commercial positioning, not code.
