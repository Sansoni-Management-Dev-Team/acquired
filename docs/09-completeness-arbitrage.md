# The completeness arbitrage — the general form, and where else it exists

> **HEAVILY QUALIFIED, 20 Aug 2026.** Independent practitioner review has withdrawn two headline
> claims in this document: the **82% prior-auth overturn rate** (conditioned on the appealed subset,
> which selects for winnability — the unbiased comparator is roughly an order of magnitude lower) and
> the **TPD advised/non-advised gap** (product-design differences in underwriting depth and disability
> definition predict the gap with zero information-asymmetry effect; see ASIC REP 587). Reason 2 for
> persistence — "the intermediary is paid by the hour" — is **false for finance brokers**, who are paid
> on settlement. Read [19-critique-and-reckoning.md](19-critique-and-reckoning.md) before using
> anything here.

Written 20 Aug 2026, from Callum's reframing: the opportunity is not "AI for acquisitions", it is
an **information arbitrage** between what a gatekeeper requires and what an applicant knows to
provide. Desk research, no practitioner interviews. Vendor-sourced figures are flagged.

Supersedes the framing in [08-adjacent-opportunities.md](08-adjacent-opportunities.md), which
looked for the same *industry shape*. This looks for the same *economic mechanism*, which is a
wider and more useful net.

---

## Part 1 — The mechanism

> Two parties hold asymmetric knowledge of a **requirement set**. The assessor knows it. The
> applicant does not, and cannot learn it. Every iteration of the loop destroys value that
> neither party fully books. Whoever holds the complete requirement set as software captures
> the value released by deleting the loop.

The applicant's problem is not laziness or bad faith. It is that **they cannot know the list.**

### Why the arbitrage persists

An arbitrage that survives needs a reason. This one has three, and they are structural:

1. **Frequency asymmetry.** The applicant is episodic — they buy a business, bury a parent,
   apply for a visa once or twice in a lifetime. The assessor is continuous — thousands of
   files a year. The applicant can never amortise learning the checklist. The assessor has
   learned it but will not publish it, because published criteria get gamed and specificity
   creates liability.

2. **The intermediary is paid by the hour.** Brokers, lawyers and agents *do* repeat, so in
   theory they hold the list. But it lives in individual heads rather than in a system, and
   time-based billing does not punish iteration — it bills it. This is why NSW probate lawyers,
   who file these constantly, still file incomplete applications often enough for the Chief
   Justice to say so publicly.

3. **Nobody owns the loop.** The cost of iteration splits — the applicant pays in calendar time
   and dead deals, the assessor in handling cost — so neither party's P&L shows the full loss.
   A textbook externality. Unowned costs do not get engineered away.

### The natural experiment that prices it

Australian TPD insurance is assessed by the same insurers against the same policy terms whether
or not the claimant had an adviser. APRA's 2025 claims data:

| | Admittance rate | Claims paid ratio |
|---|---|---|
| Individual **advised** TPD | **82%** | 70% |
| Individual **non-advised** TPD | **69%** | 53% |

Same insurer. Same policies. Same underlying disabilities, roughly. **A 13-point swing in
whether the claim is paid at all**, and a 17-point swing in the ratio, attributable to having
someone in the room who knows what the assessor needs to see.

That is the arbitrage, measured.

**CORRECTION, 20 Aug 2026 — this claim was overstated and is now downgraded.** I checked APRA's
own Explanatory Notes and Glossary directly.

*What survives.* The comparison is cleaner than I feared. Both channels are **"Individual"**
business — APRA defines Individual as cover where "each life insured is individually underwritten",
as distinct from Group, which is "underwritten according to blanket rules that apply to the group".
So this is **not** retail-versus-default-group-cover-inside-super, which was the obvious objection.
Same cover type (TPD), same individually underwritten product class, differing by whether personal
advice was provided at sale (per s 766B(3) of the Corporations Act).

*What does not survive.* Two problems, the second fatal to the strong claim:

1. **The populations are not perfectly matched.** Per APRA's channel mapping, "Individual Advised"
   *combines* Outside Super and Inside Super business, while "Individual Non-Advised" covers Outside
   Super only — Individual / Non-Advised / Inside Super is expressly "Not included". So the two
   figures are drawn from differently composed books.

2. **The gap cannot distinguish two entirely different mechanisms.** An adviser acts at *two*
   moments, and only one of them is our thesis:
   - **At claim time** — advocacy, assembling evidence, knowing what the assessor needs. *This is the
     completeness arbitrage.*
   - **At sale time** — selecting a policy with a more claimable definition (own-occupation versus
     any-occupation TPD), and ensuring proper disclosure at inception so the claim is not later
     declined for non-disclosure. *This is product selection, not completeness.*

   APRA's published data cannot separate these, and it does not report TPD definition type by
   channel, so the question cannot be resolved from the publication at all. The sale-time
   explanation is at least as plausible as ours — arguably more so, since product selection and
   disclosure at inception are the documented core of what advisers do.

**So the honest formulation is: the 13-point gap is consistent with the completeness arbitrage but
does not isolate it.** It is suggestive evidence that having someone who knows the system materially
changes claim outcomes. It is not a measurement of the value of claim-time completeness, and it
should not be presented as one. Delete "the arbitrage, measured" from any external use.

What would settle it: APRA data split by TPD definition type within channel (not published), or a
plaintiff firm's own first-pass-versus-final outcome data on files it took over after a
self-lodged declined claim.

### The purest proof, from US healthcare

Prior authorisation is the same mechanism at national scale:

- **82–83% of appealed prior-auth denials are overturned**, fully or partially.
- **Fewer than 11% of denials are ever appealed.**

Read those together. The overwhelming majority of appealed denials were *wrong*. The gate was
not saying "no, this fails on merit" — it was saying "no, because the evidence in front of me
was incomplete". And nine in ten of those decisions stand anyway, because appealing costs more
than most applicants can spend.

**The gate's "no" is very often a statement about the submission, not about the applicant.** That
sentence is the whole thesis. Everything below is a search for places where it is true.

---

## Part 2 — The four multipliers

Every gate has some iteration cost. What makes the arbitrage *large* is not the loop's existence
but its penalty structure. Four multipliers, in rough order of power:

**1. Queue penalty — does resubmission lose your place?**
NSW probate is the cleanest example: if a requisition is issued, the application re-queues
*behind newer filings*, adding four to twelve weeks to what would otherwise have been a four-to-
eight-week grant. The cost of incompleteness isn't the fix, it's the loss of position. In
council DAs, an RFI stops the assessment clock entirely.

**2. Option decay — does the underlying thing die while you iterate?**
The vendor accepts another offer. Exclusivity lapses. The patient deteriorates. The grant round
closes. Where the asset has a clock on it, first-pass completeness isn't a saving, it's the
difference between having the thing and not.

**3. Silent failure — are you declined, rather than asked?**
An RFI is a gift: the gate tells you what's missing. A refusal doesn't. Visa refusals for
insufficient evidence generally mean reapplying from scratch, and under PIC 4020 a false or
misleading document can trigger a **three-year ban**. Where the gate fails silently, the value
of knowing the list beforehand is enormous, because there is no second pass.

**4. Asymmetric penalty — is the applicant's downside catastrophic and the assessor's trivial?**
The three-year ban again. The dead deal. The unpaid TPD claim. The assessor books a marginally
higher handling cost; the applicant loses the outcome entirely. Asymmetry means the applicant
will pay well above the assessor's cost to remove the risk — which is where the margin lives.

### And the test that decides whether you can capture it

**Whose P&L does the loop actually hit?** That's your buyer. If the answer is "nobody's, quite" —
the pain is spread thin across applicants who each feel it once — the arbitrage is real but
uncapturable, and that is exactly why it has survived. Look for a repeat intermediary whose
write-offs, or a gatekeeper whose handling cost, is big enough to show up in a budget line.

---

## Part 3 — Acquired's own arbitrage, quantified

Worth stating in these terms, because it's the pitch:

- **One in three** SMEs applying for bank finance are declined or only partially funded (ASBFEO,
  2023).
- **61%** of SMEs abandoned a bank application because of the paperwork (Bizcap research —
  lender-sourced, treat as directional).
- An incomplete package adds **7–14 days** per resubmission cycle.
- Average time to settlement: **43 days** with a bank, versus under a week with leading private
  lenders — the gap is largely iteration.
- Small business loan applications are down **33% since 2014**.

And the claim from the non-bank side, which is content marketing but is precisely our thesis:
most declines aren't weak businesses, they're *"applications that arrive at the wrong lender, at
the wrong time, with the wrong documentation."*

Multipliers present: **option decay** (the vendor walks — high), **queue penalty** (moderate — you
re-enter credit assessment), **silent failure** (moderate — a decline rarely itemises what would
have worked), **asymmetric penalty** (high — the buyer loses the business, the bank loses
nothing). Buyer's P&L: the acquirer loses the deal; the bank carries handling cost on files it
declines. Both are real. This is a good arbitrage.

The strategic implication: the deal pack is the *visible* product, but the higher-value product
is **pre-qualification** — because we hold the checklist, we can tell a buyer on day one whether
this deal is bankable, before they spend money and months. That's worth more than assembling
the pack, and it's a thing neither the buyer nor the bank can do for themselves.

---

## Part 4 — Where else the arbitrage exists

Ranked by size of arbitrage × capturability, not by market size.

### 1. Probate and deceased estate administration (Australia) — the sharpest queue penalty

- **2,000+** outstanding probate requisitions in NSW as at June 2025, hundreds unanswered for
  over two months.
- The Chief Justice publicly attributed delays partly to **practitioners filing incomplete
  applications** — improperly certified documents, missing evidence, misread wills,
  misunderstood standing.
- A requisition re-queues the file behind newer filings: **+4 to 12 weeks**.
- Probate application volume up **13.5%** from 2020 to 2024; the court's answer was two new
  deputy registrars.

Why the arbitrage is big: the requirement set is finite, knowable and almost entirely
documentary — exactly the kind of thing software holds better than a person. The queue penalty
means first-pass completeness has non-linear value. And the failure mode is *documented by the
gate itself*, which is rare and enormously useful: the registry effectively publishes its own
requisition taxonomy through practice.

Why it's capturable: **the loop lands on a law firm's P&L as WIP write-offs and client
complaints**, and firms are already buying software. This passes the buyer test more cleanly
than anything else on this list.

Adjacent and connected: superannuation death benefits, where ASIC found **78% of reviewed claim
files had delays within the trustee's control**, including a trustee repeatedly requesting
documents the beneficiary had already provided. Note the inversion — here the incompleteness is
the *assessor's* disorganisation, not the applicant's ignorance. Same loop, opposite cause, and
it means the trustee is also a potential buyer.

### 2. Insurance-in-super claims: TPD and income protection — the arbitrage is already priced

The 13-point advised/non-advised admittance gap above *is* the addressable value. Plaintiff firms
already monetise it, taking a percentage to be the party who knows the checklist. A system that
raises first-pass completeness competes with, or sells to, those firms.

Multipliers: option decay (claimants are in financial hardship — high), silent failure (a
declined claim doesn't itemise the winning evidence — high), asymmetric penalty (life-changing
for the claimant — very high). Buyer: plaintiff firms, whose economics are entirely about
which claims resolve quickly.

Caution: this is a regulated, adversarial, vulnerable-consumer domain. "Human on the gate" isn't
a design choice here, it's a legal obligation, and the reputational risk of getting it wrong is
severe.

### 3. Migration and employer sponsorship — the strongest silent-failure case

The requirement set is genuinely tacit: published criteria plus case-officer practice plus
country-specific evidentiary norms. Failure is silent — refusal, not enquiry — and under
PIC 4020 the penalty can be a **three-year ban**. Section 57 natural justice gives a limited
7–28 day window to respond to adverse information, which is a partial safety net, not a fix.

Multipliers: silent failure (very high), asymmetric penalty (very high), option decay (high — job
offers and sponsors don't wait). Buyer: migration agents and sponsoring employers. Crowded with
*agents*, thin on *systems* — the checklist lives in agents' heads, which is precisely condition
2 above.

### 4. Renewable grid connection — carried over from 08

**33%** of surveyed developers named "initial application submission and completeness checks" as
a delay cause; **75%** missed their connection date. Queue penalty and option decay both high.
Weakness: the evidence is power-system simulation, not documents, so "collect it completely" is
an engineering problem, not an extraction problem.

### 5. The proven-but-taken tier

**Prior authorisation and clinical denials (US).** The purest instance of the mechanism and by
far the largest. Also the most heavily funded — a crowded field of AI appeal and submission
tools by 2026. Value here as *evidence*, not as a target: it proves an 80%-plus overturn rate
is possible, i.e. that gates routinely decline on absent data rather than merit.

**Commercial insurance placement (AU/global).** Fits perfectly; being closed by Cytora,
Convr, and locally Hutch's Dawn. See 08.

**Government tenders, R&D tax claims, council DAs.** Real loops, but each fails a different
test: incumbents already there, no origination gap, or nobody's P&L carries the loop.

---

## Part 5 — What to do with this

1. **Reframe the pitch.** Not "we source and package deals" but "we hold the lender's
   requirement set, so the first submission is the last one." The ASBFEO one-in-three and the
   43-versus-7-day settlement gap are the numbers to quote.

2. **Build the checklist as an asset, not as prompt text.** The arbitrage compounds only if
   every submission and every decline teaches the system what the gate actually required. That
   means modelling the requirement set as versioned, queryable data with outcomes attached —
   a decision the D1 data model either supports or forecloses. This is the one item here with a
   direct M0 consequence.

3. **Sell pre-qualification early.** "Is this bankable?" answered on day one is a cheaper
   product to build than the full pack and is worth more per use. It's also the natural wedge
   with Aaron's students, who currently spend months discovering the answer is no.

4. **Watch the insurance precedent.** The join closed there inside two years. Assume the same
   clock applies here.

5. **If a second bet is wanted, look at probate.** It has the sharpest queue penalty, a
   gate that documents its own failure modes, and a buyer whose P&L is already bleeding.

---

## Sources

**The arbitrage, measured**
- [Life insurance claims and disputes statistics — APRA](https://www.apra.gov.au/news-and-publications/life-insurance-claims-and-disputes-statistics)
- [APRA and ASIC map 2025 life claims and disputes — Insurance Business AU](https://www.insurancebusinessmag.com/au/news/life-insurance/apra-and-asic-map-2025-life-claims-and-disputes-573423.aspx)
- [2025 life insurance claims and disputes statistics — Life Insurance Direct](https://www.lifeinsurancedirect.com.au/life-insurance-claims-statistics-australia/)
- [Prior authorization approval rates: what 2026 data reveals — Insight Health](https://www.insighthealth.ai/blog/prior-authorization-approval-rate)
- [AI prior authorization tools have an 82% overturn rate — AI2Work](https://ai2.work/blog/ai-prior-authorization-tools-have-an-82-overturn-rate-and-that-s-the-problem)

**SME lending**
- [Australian small business loan approval rates and lending statistics 2026 — Scalesuite](https://www.scalesuite.com.au/resources/australian-small-business-loan-approval-rates-lending-statistics)
- [Why SMEs are turning to non-bank lenders — Renown Lending](https://renownlending.com/2026/03/28/why-smes-are-turning-to-non-bank-lenders-in-australia-for-flexible-business-loans/) *(lender content marketing)*
- [Guides for landing small business loans — CPA Australia](https://www.cpaaustralia.com.au/public-practice/inpractice/business-and-advisory/new-how-to-guides-for-landing-small-business-loans)

**Probate and estates**
- [Statement by the Chief Justice in relation to probate applications, 21 July 2025 — Law Society of NSW](https://www.lawsociety.com.au/sites/default/files/2025-07/Statement%20by%20the%20Chief%20Justice%20in%20relation%20to%20probate%20applications,%2021.07.25.pdf)
- [What is a probate requisition? — Mid Mountains Legal](https://midmountainslegal.com.au/what-is-a-probate-requisition/)
- [NSW probate application timeline — Wills and Estate Disputes](https://www.willsandestatedisputes.com.au/nsw-probate-application-timeline/)
- [Getting your probate application right — Attwood Marshall](https://attwoodmarshall.com.au/getting-your-probate-application-right/)

**Superannuation death benefits**
- [REP 806: Taking ownership of death benefits — ASIC, 31 March 2025](https://download.asic.gov.au/media/edznpbwm/rep-806-published-31-march-2025.pdf)
- [26-116MR Super stragglers dampen progress on death benefits — ASIC, 2026](https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2026-releases/26-116mr-super-stragglers-dampen-progress-on-death-benefits-delivery-for-grieving-australians/)
- [ASIC review into super death benefit claims — ABC News](https://www.abc.net.au/news/2025-03-31/superannuation-death-benefit-claims-delays-asic-report/105107640)

**Migration**
- [Section 57 natural justice invitation to comment — GVM](https://gvm.com.au/visa-refusals-appeals/s57-natural-justice-invitation-to-comment)
- [PIC 4020 bogus document and false information refusal ban guide 2026 — AHL Legal](https://ahllegal.com/en/australia-pic-4020-bogus-document-false-information-refusal-ban-guide-2026/)

**Grid connection**
- [Grid connection delays risk Australia's renewables targets — ESD News](https://esdnews.com.au/grid-connection-delays-risk-australias-renewables-targets/)
