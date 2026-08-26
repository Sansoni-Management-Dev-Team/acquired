# The HCPA question resolved, and three corrections

20 Aug 2026. Deep-research round 2. Resolves the challenge raised as
[Revision 4 in doc 13](13-round-1-agent-findings.md) and corrects three published claims.

---

## Part 1 — HCPA: the claim is true, and it means something different than I thought

**The software-in-one-vertical claim survives a proper test.** Not a menu reading — every internal
href on the site was extracted and diffed, and both sitemaps were checked for
`software|platform|tool|audit-pilot`. Exactly one software URL exists. Every other vertical
resolves to "<vertical> registration" and/or "grow your <vertical> business", both human
consulting. The gate count is also higher than first reported: closer to **30**, including CTP
motor-accident care across eight state schemes and workplace-accident care across five.

**But the one software product is not a completeness product.** It is *Audit Pilot* ($199/month,
also sold standalone), and it is **post-registration audit-readiness monitoring**: "monitors your
business daily & fixes compliance gaps automatically before auditors find them", organised around
"all 8 Core Modules and 28 Practice Standards" with 13,000+ daily checks. Every check it names is a
recurring-state check that only exists *once you are already registered* — expired worker
credentials, overdue reports, worker screening status, incident monitoring. There is **no
registration-application workflow in it at all.**

So the natural experiment I was worried about was never run. HCPA did not try completeness software
at episodic gates and fail; it built recurring-compliance software for its one recurring vertical
and left the episodic gates as guaranteed human services. **That is evidence about monetisation,
not about feasibility or demand.**

### What HCPA does instead at episodic gates — and it is instructive

Its registration products monetise the episodic gate through **outcome guarantees rather than
software**:

- Aged care: a "Compliance Guarantee (or Money Back)" that pays only "following three registration
  attempts", plus a "First Client Guarantee" bundling downstream demand generation onto the
  registration sale.
- Marketed on precisely our proposition: **"99% first-time approval — no costly resubmissions"** and
  **"Cut application wait time by up to 90%."**
- The filing itself is disclaimed: HCPA "support[s] the preparation and submission" while the client
  "retain[s] responsibility for all declarations, submitted information".

And a detail worth noting: the registration pages are decorated with **mocked software dashboards
borrowed from Audit Pilot** ("3 gaps detected, 2 auto-resolved") on pages where no such product is
sold. They are signalling the product direction without shipping it.

Also relevant: Audit Pilot is explicitly sold as a substitute for episodic consulting on recurrence
grounds — *"Consultants provide quarterly point-in-time reviews at $15,000 to $25,000 per year.
Audit Pilot provides continuous daily monitoring for $199 per month."*

### Why NDIS and not the other twenty-nine

- **Recurrence is decisive.** NDIS registration is time-limited with mid-term and renewal audits
  against a published, versioned standard set. That gives a vendor a permanent, externally-scored,
  dated obligation that recurs whether the customer wants it or not — which is what a subscription
  needs.
- **Volume is necessary but not sufficient.** Trade promotion permits and childcare CCS are also
  high-volume and got nothing.
- **Frequency *per customer* is what binds.** At an episodic gate the buyer transacts once, has
  never done it before so cannot evaluate a self-serve tool's accuracy in advance, and never
  renews. LTV collapses to a single sale that must also carry CAC — hence high-ticket done-for-you
  plus a guarantee that substitutes the vendor's credibility for the buyer's inability to judge.
- **And a factor I had missed entirely: machine-checkability.** The NDIS Practice Standards are
  published, enumerated and stable enough to encode as rules. Most of HCPA's other gates have
  requirement sets that are tacit, discretionary, or split across state regulators — the eight-scheme
  CTP list being the extreme.

### The real narrowing, and the tension it exposes

> **At episodic gates, completeness tooling gets built *inside the intermediary* as a throughput and
> margin instrument. It does not get sold to the applicant as software.**

Corroborated in a completely different sector: Gilbert + Tobin's merger tool (MerTL, published
5 February 2026) is an **internal** tool — "allows G+T's lawyers to quickly identify whether a
transaction is likely to require ACCC notification" — invitation-only, reachable by clients only
through an engagement. Same pattern. Even Provider Institute, which does run a real $1,979/year
subscription, sells a policy-template library and regulatory-change digests, and productises the
episodic gate as **static template packs** at $1,249 each. Not a checking engine.

And the tension that matters more than episodic-versus-recurring:

> **The arbitrage is largest where requirements are tacit, but software is easiest to build where
> they are explicit.**

That is the actual product problem. NDIS got software because its standards are enumerated;
the gates where applicants suffer most are precisely the ones hardest to encode. Any product here
lives on that gradient, and the answer is presumably to *manufacture* explicitness — build the
requirement corpus that does not exist — rather than to wait for the gate to publish one.

### Three implications for Acquired

1. **Selling software directly to episodic applicants has a structural LTV problem.** The three
   available answers are: attach a **guarantee** (HCPA's route), attach to a **recurring obligation
   downstream of the gate**, or **sell to the intermediary rather than the applicant**. Aaron's
   students are episodic buyers; the buy-side partner with a continuing mandate is not. That is an
   argument for pricing at the partner level.
2. **A guarantee is a real product mechanism, not a gimmick.** "99% first-time approval" and
   money-back-after-three-attempts are how the market currently solves the buyer's inability to
   judge quality in advance. Worth considering for the deal pack, and worth asking Mark whether he
   would stand behind one.
3. **Watch the mocked-dashboard signal.** A 100+ consultant firm with a CTO across thirty gates is
   advertising a product it has not built. If it ships, it ships as an intermediary-side tool.

---

## Part 2 — Correction: the Sembcorp/Alinta mechanic was wrong

Doc 13 stated that a materially-incomplete determination "forces a fresh notification and another
$56,800". **That is incorrect.** Verified verbatim off the ACCC register:

Case **MN-95001**. Filed 11 February 2026. On **12 March 2026** the ACCC decided under **s 51ABZ**
that the notification "should be taken not to have an effective notification date because it is
**materially incomplete and materially misleading**". Sembcorp then **cured in place under
s 51ABZA** on 7 April 2026 — same case number, effective notification date reset to that day — and
cleared Phase 1 unconditionally on 6 May.

So no fresh notification was required. The cost was **eight weeks of dead clock on a ~A$6.5bn deal**
whose substantive assessment was never in doubt. Whether any further fee was payable is not
disclosed on the register; the guidelines say only "and pay any applicable fee".

The mechanic is still real and still severe — losing the effective notification date is exactly the
queue-penalty pattern — but it is *curable in place*, which makes it materially less catastrophic
than doc 13 implied. Also confirmed: the ACCC's FY25/26 statistics workbook (v2, 5 Aug 2026)
publishes **no count of materially-incomplete decisions and no count of requests for information.**
The failure mode is statistically invisible in the regime's own reporting. Whether other
materially-incomplete determinations exist since 1 January 2026 is **unverified** — they appear only
in individual register entries.

---

## Part 3 — Correction: the Companies House figures are not publishable as statistics

Doc 15 used "~0.3–0.5% rejection online versus 6–9% paper" as the quantitative support for Layer 2.
Provenance now traced, and it does not hold up as presented.

The 6% / 2% / 0.3% split comes from **a trade-press article (AccountingWEB, 3 January 2017)
relaying a Companies House webinar** — not from any Companies House statistical release, annual
report or official statistics collection. The 0.5% variant I published **cannot be sourced at all;
drop it.** Scope is **annual accounts only** (not incorporations, not confirmation statements) and
the data is 2016 — roughly a decade stale.

What *is* attributable to published Companies House statistics: an overall accounts rejection rate
of **2.2%**, described as static; **88,000 accounts rejected per year**, "some more than once"; over
2.7m sets of accounts received annually; 20% still filed on paper.

**And it is not like-for-like.** Amended and revised accounts "can only be done on paper", so the
hardest cases sit entirely in the paper denominator; many forms cannot be filed online at all; and
paper filers skew to unrepresented non-practitioners. Textbook self-selection — the objection I
flagged was well founded.

**But one internal control partly defeats it, and it is why the case survives in weakened form.**
Third-party software filers are the *most* capable cohort — professional agents with paid tooling —
and they sit at **2%, nearly seven times the WebFiling rate of 0.3%.** If filer capability were
doing the work, software should be lowest. It is not. That points at validation strength rather than
capability. Though composition confounds this too: software handles complex full accounts while
WebFiling skews to dormant and micro-entity accounts.

**The one primary source that survives is qualitative**, from Companies House's own blog (31 January
2016): rejection rates "are significantly higher for paper accounts than with e-submissions. As a
result, **it makes sense to use the inbuilt validation** provided by software and WebFiling to reduce
your chance of errors." Companies House itself naming inbuilt validation as the mechanism, with no
number attached.

**How to cite Layer 2 from now on:** the 2016 Companies House blog plus the *direction* of the
split, describing 6/2/0.3 as figures reported at a Companies House webinar rather than published
statistics, with scope and selection caveats in line.

A forward-looking wrinkle worth a footnote: under ECCTA, all accounts filings must go via commercial
software in iXBRL from 1 April 2028, with web and paper routes closing. **Companies House is
deliberately moving everyone off the 0.3% channel onto the 2% channel** — structured data matters
more to it than marginal authoring accuracy. A useful reminder that gatekeepers optimise for
themselves, not for applicant first-pass success.

---

## Part 4 — Correction: the CMS causal claim was invalid; the observation that replaces it is better

My population worry was **unfounded** — the median response time and the denial rates come from the
same CMS-mandated metric set, same insurers, same CY2025 period, 14 insurers covering ~71 million
enrollees, across all prior authorisation requests rather than only auto-approvals. **The internal
comparison is valid.**

But the causal sentence "automation made the gate instantaneous and changed the outcome not at all"
is **not defensible.** Per CMS's own fact sheet, the Prior Authorization API — the actual electronic
prior authorisation mechanism — "must be implemented beginning January 1, **2027**", and operational
provisions begin generally from 1 January **2026**. The KFF data is **CY2025**, predating both. And
there is no baseline: this is the first year of mandated reporting, a single cross-section, so
nobody has measured whether automation moved denials in either direction. KFF makes no causal claim.

**Restate Layer 3 on the datum that needs no baseline.** In 2025, across insurers covering ~71m
enrollees, median determinations came back in **under a day**, while **12%** of standard requests
were denied in Medicare Advantage, **14%** in Medicaid managed care and **18%** in the Marketplace —
and **67%, 47% and 43%** of appealed denials respectively were **overturned**.

The overturn rates are the load-bearing observation:

> **The standard applied at the gate differs materially from the standard applied on review, on the
> same evidence.**

That is a direct measurement of substantive indeterminacy, and it stands on a single cross-section.
Fast decisions coexisting with contested substantive outcomes is *consistent with* Layer 3; it is
not proof that automation failed to move them.

Also retire: the "7.7% in 2024 versus 12–13% in 2025" comparison. Different reporters, different
definitions, not a time series.

### The upside: a dated, pre-registered test of the whole model

From **1 January 2027**, the mandated Prior Authorization API must be populated with covered items
and services and must **"identify documentation requirements for prior authorization approval."**
That is **Layer 2 — requirement encoding — mandated by federal rule** across Medicare Advantage,
Medicaid, CHIP and the Marketplace, with **baseline denial and overturn metrics already published
for 2025** and annual reporting continuing.

So the three-layer model has a real forthcoming test with the pre-period already banked:

| If the model is right | If Layer 2 also fixes substantive sufficiency |
|---|---|
| Decision times stay fast | Decision times stay fast |
| Denial rates barely move | **Denial rates fall from 2027** |
| Overturn-on-appeal stays high | Overturn rates fall |

Either way we get an answer on published data. Worth diarising — and worth telling the bank that our
central claim is falsifiable on a known date.

---

## Part 5 — And the NSW probate form does not block incomplete filings

Confirmed, which removes the main Layer-2 threat to a probate product. The Online Registry prompts
conditionally but does not prevent progression: **"If you do not have the document to upload you can
still proceed with the rest of your application."** Completeness at the end is *self-certification*,
and the only gate before payment is that documents were uploaded — not that their contents are
correct.

The Court's "reviewing requisition practices… exploring improvements to the online probate system"
workstream is confirmed real, with no published output found. And the sharpest operational detail:
**"Replies to requisitions are not expedited."** Expedition is available for fresh applications but
explicitly barred for requisition replies — so a completeness failure costs a full re-queue and
cannot be escalated out of, at any price.

---

## Sources

**Primary**
- ACCC public register, case **MN-95001** (Sembcorp Industries / Alinta Energy) — s 51ABZ decision 12 Mar 2026; s 51ABZA cure 7 Apr 2026; Phase 1 clearance 6 May 2026
- ACCC merger regime statistics workbook FY25/26 (v2, 5 Aug 2026) — publishes no materially-incomplete or RFI counts
- [CMS-0057-F fact sheet — Prior Authorization API implementation from 1 Jan 2027](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-and-prior-authorization-final-rule-cms-0057-f)
- Companies House blog, 31 January 2016 — "it makes sense to use the inbuilt validation"
- [Supreme Court of NSW — Wills and probate (processing times; "replies to requisitions are not expedited")](https://supremecourt.nsw.gov.au/wills-probate.html)
- [Gilbert + Tobin — MerTL announcement, 5 February 2026](https://www.gtlaw.com.au/news/gilbert-tobin-launches-technology-for-fast-assessment-of-accc-merger-notification-obligations)

**Vendor — read directly, treat claims as marketing**
- HCPA (hcpa.com/au) — ~30 registration verticals; one software URL; aged care and NDIS registration pages with guarantees
- Audit Pilot (auditpilot.com.au) — $199/month, "audit-ready 24/7", 8 Core Modules and 28 Practice Standards
- Provider Institute — $1,979/year subscription (policy templates and regulatory digests); $1,249 registration template packs
- SAH Consulting — aged care registration, services only

**Secondary**
- Jennifer Adams, "Is Companies House rejecting more accounts?", AccountingWEB, 3 January 2017 — source of the 6%/2%/0.3% split, relaying a Companies House webinar. **Not official statistics**
- KFF analyses of CY2025 payer prior-authorisation metrics — 14 insurers, ~71m enrollees

**Unverified / open**
- Whether other ACCC materially-incomplete determinations exist since 1 Jan 2026
- Ideal Placements, Provider Assist, Complyance, Astute Compliance — not reachable; deliberately not characterised
- Any published output of the NSW Court/Law Society requisition-practices workstream
