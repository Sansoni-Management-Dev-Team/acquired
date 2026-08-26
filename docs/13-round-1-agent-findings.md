# Round 1, agent findings — new instances, incumbency, and four framework revisions

> **NOTE, 20 Aug 2026.** Revision 1 (the intermediary boundary condition) is the most important thing
> in this document — and I failed to apply it to Acquired's own market, where Australian commercial
> finance broking *is* the low-cost continuous intermediary it describes. See
> [19-critique-and-reckoning.md](19-critique-and-reckoning.md) Part 1. The probate recommendation in
> Part 2 also needs the unqualified-legal-practice perimeter (LPUL s10) applied before it goes
> anywhere.

20 Aug 2026. Deep-research round 1, from two research agents (legal/regulatory incumbency; new
instances). Both flagged their own confidence levels and unread sources; those flags are carried
through here rather than smoothed over.

Companion to [11-verified-round-1.md](11-verified-round-1.md) (trade finance, FDA, counter-thesis)
and [12-practitioner-voice.md](12-practitioner-voice.md).

---

## Part 1 — Four revisions to the framework

These matter more than the individual instances. Three sharpen the thesis; one attacks it.

### Revision 1 — The boundary condition: patents falsify the pattern, usefully

Patent prosecution has **every surface feature** of the completeness arbitrage: tacit examiner
practice, near-universal first-action rejection, an episodic applicant, a hard lapse deadline
that forfeits the priority date irrecoverably. And yet no arbitrage exists.

Why not: iteration is *expected and priced in* (an adverse first report is the normal path, not a
failure), the cure window is roughly twelve months with multiple rounds, and decisively — **the
patent attorney is a cheap, continuous, competitive intermediary who has already commoditised
the tacit knowledge.**

That yields a screen to apply before anything else:

> **The completeness arbitrage exists only where a low-cost continuous intermediary is absent,
> unaffordable, or itself episodic.**

Every strong candidate below passes it: device sponsors lodging a handful of novel applications
per decade, prospectors, veterans, sub-$1m insolvencies, first-time business buyers. Where a
mature intermediary market has already absorbed the knowledge and sells it cheaply relative to
the value at stake, there is nothing left to arbitrage.

### Revision 2 — The billing-model test: who *loses* from the loop

From the probate work, the sharpest commercial insight of the round. Answering requisitions is
**billable revenue for an hourly firm and pure margin erosion for a fixed-fee provider.** Same
work, opposite sign on the P&L.

So the buyer is never "law firms". It is specifically:
- **fixed-fee, high-volume providers** — Safewill Legal, Willed Law, state and public trustees,
  paralegal-heavy estates practices;
- and **never** hourly-rate firms, one of which openly markets "addressing requisitions" as a
  service line.

Generalise it: **find the party who has committed to a fixed price for getting through the gate.**
They have converted the iteration loop from revenue into cost, and they are the only ones who
want it dead. This is a much better buyer test than doc 09's "whose P&L carries the loop".

### Revision 3 — Stock versus flow: why headcount never fixes this

DVA cleared the Royal Commission's 41,799-claim backlog by February 2024, ahead of deadline. It
worked. And yet:

- Claims on hand have since **more than doubled**, from 65,231 (June 2022) to **103,074**
  (30 June 2026).
- MRCA initial liability has **reversed**, from 315 days average to **364 days**.
- Average conditions per claim rose from 2.6 (May 2022) to **4.1** (Jan 2026) — up 58% in under
  four years, each condition requiring its own decision.
- FY2025-26: 109,221 claims received against 94,433 determinations — a **14,788 shortfall in one
  year**.

Clearing a backlog is a **stock** intervention. Completeness is a **flow** problem. Surging case
officers fixes the first and does nothing to the second. That is why these loops persist through
reform programmes, and it is the argument for why software rather than headcount is the answer.

### Revision 4 — The challenge to the thesis, stated fairly

**HCPA**, an Australian "regulatory growth consultancy", productises first-pass registration
across roughly **25 distinct Australian gates** — NDIS provider registration, aged care and home
care, GP practice and telehealth, DVA, medicinal cannabis, dental, pharmacy, medical imaging,
childcare CCS and provider approval, RTO and CRICOS, trade promotion permits, online wagering
licences.

It sells **software in exactly one** of them: NDIS Compliance Software. Consulting in the other
twenty-four.

Read as a natural experiment, that is a warning: **gate-completeness software emerges where the
gate is high-frequency, recurring and audited, and stays human consulting where the gate is
episodic.** Which is precisely the wrong way round for this thesis — the episodic gate is exactly
where we argue the arbitrage is largest.

Two possible readings. Either the episodic gates genuinely cannot support software (too few
events, too much variance, willingness-to-pay concentrated in a moment of panic that a human
service captures better), or HCPA simply built where recurring revenue was easiest and the
episodic gates are unbuilt rather than unbuildable. **I do not know which, and it is the single
most valuable question left open by this round.** Understanding why HCPA built for NDIS and not
its other twenty-four verticals is probably the highest-value interview available.

### And a fifth observation — the measurement gap

Ahpra publishes its own average assessment time. The ACCC publishes its own decision timeliness.
The TGA's published clock **explicitly excludes time spent waiting on the applicant.** The NSW
Supreme Court publishes no requisition rate at all.

**Every institution measures its own speed. None measures the applicant's iteration loop.** So
nobody can price the loop, because nobody publishes its size. That is simultaneously the reason
this opportunity is invisible to incumbents and the reason our pitch is hard to evidence.

---

## Part 2 — Incumbency verdicts

### Probate — OPEN, and the conditions are unusually favourable

**Every tool investigated assembles or orders. None validates.**

| Tool | What it actually does |
|---|---|
| InfoTrack Wills & Estates | VOI/AML, Will Trace, title/ASIC/AFSA searches, valuations — monetised per disbursement |
| GlobalX (rebranding to Dye & Durham) | Property-centric; no surviving probate product page |
| LEAP | Supplies automated court forms, pre-populates matter data — transcription-error reduction, not sufficiency checking |
| Smokeball / Actionstep | Matter and document management with form automation |
| By Lawyers | Precedent commentary — requirements encoded in prose a human must read (**unconfirmed, URL 404'd**) |
| Probate Plus | Post-grant estate *accounting*; presents as UK — out of jurisdiction |
| Safewill Legal / Willed Law | Not software — productised fixed-fee law firms |
| LawBridge "Risk Checker" | A three-question lead-capture quiz that tests *eligibility to apply*, not *sufficiency of the application* |

Nothing on the Australian market checks a probate application against registry requisition
grounds. The InfoTrack and LEAP absences are informative rather than merely unobserved — a
requisition-prevention feature would be a headline claim in that market.

**Why the conditions are good:** mandatory online filing since 1 August 2023 gives a fixed,
machine-readable submission surface. The failure taxonomy is published by the head of the
jurisdiction. The pain is quantified. And critically — **replies to requisitions are explicitly
never expedited**, so the queue-position loss is unrecoverable by any means, including money.

**The taxonomy, and its limits.** The Chief Justice's statement of 21 July 2025 names four
grounds: failure to certify death certificates per the Supreme Court Rules 1970 (NSW);
improperly taken affidavits (not confirming oath versus affirmation); failure to provide
evidence for copy-will applications, or filing photocopies instead of original wills; and
misreading the will's terms or misunderstanding who has standing. He attributes these to
"incomplete applications filed by practitioners which often fail to provide the basic required
application for a grant of probate."

That is **four grounds in one paragraph — a seed ontology, not a training corpus.** The Court
publishes no requisition-ground code list, no requisition rate, no requisitions-per-application
figure. Its separate Probate Checklist PDF (keyed to Part 78 SCR 1970) lists what to *file*, not
what the registry *rejects for*, and the Court itself scopes it to straightforward applications
only. A real corpus would have to be assembled from actual requisitions held by high-volume
filers — which is exactly why **the fixed-fee volume firm is both the buyer and the data
partner.**

**Registry state as at week of 17–21 Aug 2026:** probate filings from 30 Jul–6 Aug being
assessed; Letters of Administration from 4–13 June — roughly **ten weeks behind.** Separate,
slower queues exist for "Answers to requisitions" and "Complex answers to requisitions", so the
stopped-clock cost is measurable directly off the Court's own published bands.

**Principal risk:** the Court's own remedy list includes "exploring improvements to the online
probate system". If it builds validation into the filing form, the category disappears. Same
pattern as eSTAR in doc 11.

### ACCC merger notification — perfect problem, bad market. Deprioritise.

The mechanic is textbook and severe: a **materially incomplete** determination voids the
effective notification date, forces a fresh notification and **another $56,800**, and can be made
at *any* point in Phase 1 rather than only at intake. The one documented instance is Sembcorp
Industries / Alinta Energy, characterised as "materially incomplete and materially misleading",
suspended then recommenced — roughly **1 in 64 notifications (~1.5%)** over July 2025 to March
2026. *(Low confidence: sourced from search extracts of a Gilbert + Tobin page that served an
unrelated index when scraped. Verify against the ACCC Acquisitions Register.)*

But the market fails on three counts:

1. **Volume.** 50 notifications and 108 waiver applications in Q1 2026. Seat count will never
   support software.
2. **The gatekeeper has already closed it.** The ACCC publishes both forms with guidance plus
   four XLSX annexure templates, offers **free pre-notification engagement**, and accepts **free
   draft notifications through the portal.** The regulator supplies the completeness rehearsal at
   zero price. FIRB has done the same — its Foreign Investment Portal forces structured lodgement
   behind Digital ID and ships its own checklist.
3. **Parties facing $475,000–$1,595,000 Phase 2 fees will always buy partner hours**, not
   software.

Consistent with that, the one productised offering is a lead magnet: Gilbert + Tobin launched
technology for fast assessment of notification *obligations* about five weeks into the regime —
the **threshold** question, not the completeness question, mirroring Stikeman Elliott's Canadian
tool. *(The threshold-versus-completeness distinction is inference from the title; the
announcement returned HTTP 403 and was never read. It is the load-bearing claim in this verdict
and it is unverified.)*

Also negative and worth recording: the ACCC's own first-quarter report publishes volumes,
timeliness and waiver outcomes but **no materially-incomplete count, no information-request
count, no stop-the-clock statistic.** The completeness dimension is absent from the regulator's
public performance framing — the measurement gap again.

Retain as a credibility beachhead or one module of a multi-gate platform. Not a primary market.

### AHPRA / international medical graduates — the strongest of the three

The arbitrage here is **already proven and monetised, as a human service.** Recruitment agencies
staff named regulatory specialists; one sells first-pass completeness explicitly — *"we can make
sure your application is complete and correct the first time"* — citing **around 60% of
applications missing critical information** required to process them. *(Attributed to Ahpra by a
recruitment agency, in a 2021 post with bolted-on updates. Unverified and stale. Do not rely on
it until a primary source is found — Ahpra Annual Report, Senate Estimates, or FOI.)*

The finding that needs no caveat: **Ahpra has published a video library aimed at employers and
recruiters** teaching them how IMGs should answer the introductory questions that determine which
registration type they are applying for. A regulator producing explainer videos for third-party
intermediaries, on a page it is "regularly updating", is an institutional confession that the
episodic applicant cannot navigate the form alone. The portal only prompts — it does not
validate.

**Hard numbers:** 5,717 IMG applications finalised in 2023-24 (up 1,205 year on year), with
average assessment time down from 110 to **87 days** — still nearly three months after a 26%
improvement. Nowhere is there a metric for first-pass completeness or applications held for
further information.

**The gate is a composite**, which is the real product insight: Ahpra *plus* college/RACGP *plus*
Medicare provider number, on top of AMC primary source verification, ECFMG EPIC portfolio, and a
visa. The defensible product is **cross-gate orchestration**, not single-form validation. And the
Expedited Specialist pathway's eligibility list is ministerially set and moving — seven
specialties live, four prioritised next — so tracking a shifting eligibility ontology is both a
maintenance burden and a moat.

**Buyer: not the doctor.** The work is free to them because the agency recovers it from the
employer's placement fee. The loop lands on (1) recruitment and locum agencies, where delay
defers placement revenue and consumes specialist salary, and (2) employers paying locum premiums
to backfill unfilled positions — state health districts, rural workforce agencies, corporate GP
groups. Price against locum backfill cost, not software comparables.

---

## Part 3 — New instances

### TGA preliminary assessment — Australia's 510(k) RTA, and the cleanest new find

Section 41FDB of the Therapeutic Goods Act 1989. The TGA states the mechanic in its own words:

> "Applications that do not pass preliminary assessment will be refused by the TGA."

Not queried. Not returned for more information. **Refused** — inside a 20-working-day statutory
window, after a non-refundable fee. It applies to every device class except Class I (Export
Only), Class 1 IVD and Class 1 IVD (Export Only), i.e. everything commercially meaningful.

Two structural details make this unusually attractive:

- **The asymmetry is concentrated in one screen.** After the gate, iteration is generously built
  in — s41JA notices to provide information, multiple assessment rounds, an explicit opportunity
  to withdraw. At the gate, there is no cure period at all.
- **The loop is invisible in the statistics.** The TGA's published clock "[does] not include any
  time when we are waiting for you to respond" — so applicant-side incompleteness cannot appear
  in any performance figure the regulator publishes.

The tacit knowledge is well-localised: the substantive requirement is defined by reference to a
*separate* guidance document on using market authorisation evidence from comparable overseas
regulators, and the characteristic failure is mis-mapping an existing overseas approval onto the
required Australian evidentiary form. Buyer: device sponsors (Australian distributors or local
arms of overseas manufacturers) with launch revenue waiting on ARTG listing, plus the regulatory
affairs consultancies already selling this. **Gap: the TGA publishes no refusal rate at
preliminary assessment. The half-yearly Snapshot series appears to stop after Jul–Dec 2021. This
is the most valuable missing number of the round and may need an FOI.**

### WA mining tenements post-*Forrest & Forrest* — the only candidate scoring high on all four legs

*Forrest & Forrest Pty Ltd v Wilson* [2017] HCA 30 held that lodging a mineralisation report
*with* the application (s74(1)(ca)(ii), Mining Act 1978 (WA)) is a **condition precedent to the
jurisdiction** of the Warden and the power of the Minister to grant. Strict compliance, not
substantial compliance, because grants over state resources are involved.

The consequence is the most extreme silent failure found anywhere in this research: a defective
application does not fail at assessment. It produces a tenement that is granted, financed,
drilled and mined — **and is void** — with the defect surfacing years or decades later when a
third party litigates it. The applicant is never told.

Layered on top is a genuine **first-in-time race against a rival**, not merely against a
bureaucratic clock: where two applicants seek the same ground, priority goes to whoever *first
complies with the initial requirements*, and the date of application requires lodgement
*together with the prescribed fees*. So incompleteness costs the ground to a competitor now and
title validity later.

Buyer: tenement management specialists (a Datamine LandTrack ecosystem already exists), resources
law firms, and critically the **financiers and JV partners whose security is worthless if the
tenement is void** — title validity is a diligence line item in every resources financing.
*(Caveat: whether WA legislatively validated affected historical tenements post-2017 was not
verified, and it materially changes the silent-failure score for existing grants. The prospective
strict-compliance requirement and the priority race both stand regardless.)*

### DVA claims — the gatekeeper's confession

Already covered under Revision 3. The quotable line, from DVA's own page:

> "DVA has commenced up-front screening to address the increasing number of incomplete claims
> being received."

A continuous institution has independently diagnosed applicant incompleteness as its binding
constraint and is spending money on it. It also publishes a "How to be claim ready?" guide —
conceding that claim-readiness is a skill distinct from entitlement. Incomplete claims are held
*before allocation to a delegate*, so incompleteness costs queue position in practice without any
formal clock reset. Third-party latency compounds it: medical reports average ~72 days.

Weakest leg is capture: ex-service organisation advocates are largely free and volunteer-staffed,
and this is not a contingency-fee market at TPD scale. The realistic buyer is **DVA itself** —
which is a different business, but a real one, and the only instance found where the gatekeeper
is plausibly the customer for applicant-side completeness.

### Voluntary administration and DOCAs — where failure is *non-submission*

ASIC Report 836 (7 July 2026): 3,528 grouped appointments, 5,020 companies, $71bn liabilities,
FY2021-22 to FY2024-25. The finding that matters:

- **In most sub-$1m administrations, no DOCA proposal is ever put to creditors at all.**
- DOCA rate by size: **48.3%** above $10m liabilities versus **15.4%** at $1–250k.
- But when a proposal *is* put and recommended, it almost always succeeds — administrators
  recommended approval of 95%, creditors followed 89% of the time.

So the binding constraint is **proposal production, not creditor persuasion**, and the steep size
gradient is the fingerprint of a fixed cost of assembling a compliant, credible proposal that
only large liabilities can amortise. Option decay is absolute: 56% of these companies are
liquidated and cease to exist.

A useful correction to an assumption I would have made: the 20-business-day s439A convening
period *looks* like a hard clock but isn't — of 30 published Federal Court extension judgments
since 2022, only one was refused. **The clock binds budget, not calendar.** Monetisation problem:
the segment where the need is clearest is insolvent by definition, with median dividends of 11.5c
in the dollar.

### FIRB — the most precisely priceable queue penalty found

The decision clock does not start until the fee lands against the Payment Reference Number, and
fees are **non-refundable on rejection, withdrawal, lapse, or the deal simply not proceeding.**
Business acquisition fees run from $14,700 to a maximum of **$1,171,600**. So withdraw-and-
resubmit costs the **full fee a second time plus a fresh 30 days at the back of the queue** — a
directly computable price for incompleteness, which is rare.

Treasury is missing its own already-lowered target: **46% decided within 30 days against a 50%
target**, median drifted back to 35 days. And the extension mechanism contains a perverse
incentive — FIRB requests a *voluntary* extension first, and declining risks an adverse decision,
so applicants routinely consent to their own delay.

Best capture case of the round: foreign investment teams bill this constantly, and the acquirer's
deal P&L carries the delay directly through break fees, financing commitment expiry, exclusivity
windows and MAC clauses. *(All processing-time figures come via law-firm commentary on Treasury
quarterly data, not a direct read. Fee maximum needs verification against Schedule of Fees v8.)*

### DAFF import permits — the only *priced* completeness penalty

**$42 per quarter hour**, or part thereof, of assessment time beyond the initial included period.
DAFF has effectively published the arbitrage in its own fee guidance. Standard permits: 20
business days from payment *and a completed application*.

And the purest option decay in the entire research: permit conditions frequently require
government certification **from the country of export, which generally cannot be obtained once
the goods have left.** Discovering a condition late does not delay the consignment — it destroys
it, through destruction or re-export at the importer's cost, with the goods already in transit
while the applicant iterates. Downgraded to moderate overall on per-transaction value; strongest
sub-segment is high-value biologicals, live animals and genetic material.

### Aged care approved provider — structurally interesting, evidentially thin

A discrete **10-business-day validity check** precedes any substantive assessment — the exact
structural signature we hunt — and Requests for Information **incur additional fees**. Nominal
funnel: validity check (10 bd), initial assessment (10 bd), formal assessment (up to 90 days).

The compelling angle is the acquisition overlay: an aged care or childcare centre acquisition
**cannot complete without provider approval**, so the applicant is a buyer on a contract
timetable with a settlement date, converting a ~110-business-day process into hard option decay.
That links this candidate directly to Acquired's own domain. *(Low confidence — both Commission
pages defeated the scraper, and no approval or refusal rate data was found.)*

### NDIS access requests — do not treat as validated

Structurally plausible: the reported binding constraint is not eligibility but the evidentiary
demonstration of **permanence** and **functional impact** — the gap between a clinician's ordinary
notes and what the NDIA needs to see. But **every characterisation found came from provider and
plan-manager content marketing**, each with a commercial interest in portraying applications as
difficult. No NDIA primary data; access statistics are being pursued via FOI, suggesting routine
quarterly publication doesn't break down rejection reasons.

It also fails the capture test for a structural reason worth noting: plan managers are paid from
plan funds **that only exist once access is granted**, so nobody in the chain is funded to solve
the pre-access problem.

---

## Part 4 — Revised ranking

| Instance | Mechanic | Strength | Buyer quality | Note |
|---|---|---|---|---|
| WA mining tenements | Queue penalty + strict compliance | **Strong** | Good — financiers, JV partners | Only candidate high on all four legs |
| TGA preliminary assessment | Strict compliance | **Strong** | Good — sponsors with launch revenue | Cleanest AU analogue to 510(k) RTA |
| AHPRA / IMG | Credential | **Strong** | **Best** — agencies and employers | Arbitrage already monetised as service |
| NSW probate | Queue penalty | **Strong** | Good — fixed-fee volume providers | Software market genuinely open |
| FIRB | Queue penalty | **Strong** | **Best** — deal P&L | Most precisely priceable penalty |
| DVA claims | Evidence threshold | Strong pattern | **Poor** — buyer is DVA itself | Gatekeeper confession; flow problem |
| VA / DOCA | Non-submission | Moderate | Poor — insolvent by definition | Failure is never applying |
| DAFF import permits | Strict compliance | Moderate | Fair — brokers | Only priced penalty; absolute decay |
| Aged care provider | Strict compliance | Moderate | Fair — acquirers | Needs verification |
| ACCC / merger | Queue penalty | Perfect pattern | **Bad market** | Gatekeeper closed it themselves |
| NDIS access | Evidence threshold | Unvalidated | **None** | Content marketing only |
| Patents | — | **Negative case** | — | Defines the boundary condition |

---

## Part 5 — What this means for Acquired

1. **Apply the intermediary test to ourselves.** Business brokers and finance brokers exist and
   do repeat this. The reason the arbitrage survives in SME acquisition lending is that they are
   *episodic relative to the gate* — they see a fraction of one bank's credit decisions — and
   their knowledge sits in heads, not systems. That is a defensible answer, but we should be able
   to say it out loud when challenged.

2. **Find the fixed-fee party.** Per Revision 2, the buyer is whoever has committed to a fixed
   price for getting through the gate. In our case that is arguably the buy-side partner with a
   mandate to close, and it is *not* an hourly adviser. Worth testing against Aaron's students'
   fee structure.

3. **Watch the gatekeeper-closes-it risk explicitly.** eSTAR (doc 11), the ACCC's free draft
   notifications, FIRB's portal checklist, and the NSW Court "exploring improvements to the online
   probate system" are four instances of the same thing in one research round. Any part of our
   product that a bank could replicate with a mandatory structured portal has a shelf life.

4. **Answer the HCPA question before betting on a second vertical.** If completeness software
   only works on recurring, audited gates, then every episodic instance in the table above is a
   consulting business wearing a software costume — including, potentially, ours.

---

## Highest-value gaps

Carried forward to round 2, in priority order:

1. **Why did HCPA build software for NDIS and not its other 24 verticals?** (Revision 4.)
2. **Australian SME lending primary data** — still the biggest gap overall, still unfilled.
3. **TGA refusal rate at preliminary assessment** — likely FOI.
4. **A primary source for the AHPRA ~60% figure** — Annual Report, Senate Estimates, or FOI.
5. **Verify the Gilbert + Tobin tool** (403'd) and the **Sembcorp/Alinta base rate** against the
   ACCC Acquisitions Register.
6. Whether the NSW Online Registry probate form already does server-side conditional validation,
   and whether the Court/Law Society "reviewing requisition practices" workstream published
   anything — the highest-value document in that space if it exists.
7. Whether WA legislatively validated tenements affected by *Forrest & Forrest*.
8. **Buyer-side loop economics**: what a requisition costs a fixed-fee probate provider per file;
   what 30 days of IMG registration delay costs a rural health service in locum backfill.
9. Royal Commission into Defence and Veteran Suicide primary findings on evidence burden.
10. Safe harbour (s588GA) — has a documentation-completeness precondition for directors and was
    not investigated at all.

---

## Sources

**Primary — courts and regulators**
- [Statement by the Chief Justice in relation to probate applications, 21 July 2025 (PDF)](https://supremecourt.nsw.gov.au/content/dam/dcj/ctsd/supreme-court/documents/media/Statement-probate-applications-20250721.pdf) — credibility 10
- [Wills and probate, processing times — Supreme Court of NSW](https://supremecourt.nsw.gov.au/wills-probate.html) — credibility 10
- [Probate Checklist 1, Part 78 SCR 1970 (PDF)](https://supremecourt.nsw.gov.au/documents/Forms-and-Fees/Probate-Forms/Fact-Sheet-Precedent-Forms/Checklist_Probate.pdf) — credibility 8
- [Passing preliminary assessment for medical device applications — TGA](https://www.tga.gov.au/resources/guidance/passing-preliminary-assessment-medical-device-applications) — credibility 10
- [Understanding the medical device application audit process — TGA](https://www.tga.gov.au/resources/guidance/understanding-medical-device-application-audit-process) — credibility 10
- [Claim processing times — DVA, updated 15 July 2026](https://www.dva.gov.au/access-benefits/claims-and-compensation-for-illness-or-injury/claim-processing-times) — credibility 9
- [26-144MR ASIC review into VA and DOCA outcomes (Report 836)](https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2026-releases/26-144mr-asic-review-provides-insights-into-voluntary-administration-and-deed-of-company-arrangement-outcomes/) — credibility 9
- [ACCC media release 32/26 — new merger control regime off to positive start](https://www.accc.gov.au/media-release/new-merger-control-regime-off-to-positive-start) — credibility 9
- [ACCC — notifying an acquisition (forms, fees, portal)](https://www.accc.gov.au/business/mergers-and-acquisitions/notifying-an-acquisition) — credibility 10
- [FIRB Guidance Note 10 — Fees (PDF)](https://foreigninvestment.gov.au/sites/foreigninvestment.gov.au/files/2025-03/guidance-note-10-fees-v6.pdf) — credibility 7
- [Charges for import permits — DAFF](https://www.agriculture.gov.au/biosecurity-trade/import/online-services/bicon/fees-import-permits) — credibility 9
- [Aged care provider registration applications — ACQSC](https://www.agedcarequality.gov.au/providers/provider-registration/applications-requests-and-notifications) — credibility 6
- [Ahpra — helping international health practitioners to register (employer/recruiter resources)](https://www.ahpra.gov.au/Registration/Employer-Services/International-practitioner-employer-information) — credibility 10
- [Medical Board — Expedited Specialist pathway](https://www.medicalboard.gov.au/Registration/International-Medical-Graduates/Expedited-specialist-pathway.aspx) — credibility 10
- [Ahpra response to the Kruk Review](https://www.ahpra.gov.au/News/2023-12-07-Ahpra-response-to-Kruk-Review.aspx) — credibility 8
- [Responding to an examination report — IP Australia](https://www.ipaustralia.gov.au/patents/applying-patent/responding-examination-report) — credibility 6
- [*Forrest & Forrest Pty Ltd v Wilson* [2017] HCA 30 — AustLII](https://classic.austlii.edu.au/au/cases/cth/HCA/2017/30.html) — credibility 9

**Secondary and vendor — treat with the noted caution**
- [Jones Day — how long does Australian FIRB approval take (June 2026)](https://www.jonesday.com/en/insights/2026/06/how-long-does-australian-firb-approval-take-latest-statistics-and-more-streamlining-reforms) — credibility 7
- [Gilbert + Tobin — new merger regime first-quarter insights](https://www.gtlaw.com.au/insights/new-merger-regime-first-quarter-insights) — credibility 6, **not read**
- [Gilbert + Tobin — technology for assessing ACCC notification obligations](https://www.gtlaw.com.au/news/gilbert-tobin-launches-technology-for-fast-assessment-of-accc-merger-notification-obligations) — credibility 4, **title only, 403**
- [Holding Redlich — Australia's new FIRB portal](https://www.holdingredlich.com/australia-s-new-firb-portal-what-foreign-investors-need-to-know) — credibility 6
- [InfoTrack Wills & Estates FAQs](https://www.infotrack.com.au/wills-estates-lawyers-faqs/) — credibility 7, vendor
- [LEAP — InfoTrack integration](https://www.leap.com.au/exclusive-integrations/infotrack/) — credibility 7, vendor
- [Safewill Legal — probate](https://www.safewilllegal.com.au/probate) — credibility 6, firm marketing
- [LawBridge — NSW probate eligibility and risk checker](https://lawbridge.com.au/insights/how-to-apply-probate-nsw/) — credibility 5
- [Kells — navigating the probate process in NSW (Jan 2026)](https://www.kells.com.au/navigating-the-probate-process-in-nsw-tips-for-executors-in-2026) — credibility 5
- [HCPA — AHPRA registration for GPs, complete application support](https://www.hcpassociation.com.au/post/ahpra-registration-for-gps-complete-application-support/) — credibility 6, vendor
- [Wavelength — medical recruitment services](https://wave.com.au/medical-recruitment-services/) — credibility 5, vendor
- [Medrecruit — Ahpra slashes processing time](https://medrecruit.medworld.com/articles/aphra-slashes-processing-time-in-a-bid-to-get-overseas-doctors-to-australia) — credibility 4, **source of the unverified 60% figure**
- [NDIS access statistics FOI request — Right To Know](https://www.righttoknow.org.au/request/ndis_access_statistics_april_to) — credibility 3
