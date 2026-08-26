# Deep research, round 1 — verified findings and corrections

> **SUPERSEDED IN PART, 20 Aug 2026.** Section 4 below (the counter-thesis "split verdict") rests
> on FDA RTA figures that turned out not to be FDA data, and its clerical/substantive two-layer
> model was falsified by NSW planning data. See [15-counter-thesis-resolved.md](15-counter-thesis-resolved.md)
> for the corrected three-layer model. Sections 1-3 (the ICC primary source, the discrepancy-fee
> mechanic, Traydstream incumbency) stand unchanged.

20 Aug 2026. Run under the deep-research-plus skill at ultradeep depth.

**Process note, stated plainly.** Six parallel research agents were spawned for round 1. All six
signalled idle without returning findings, and re-prompting them produced the same result. The
delegation channel failed. Everything below was therefore researched directly, so this is a
narrower round than four-round ultradeep would imply — it covers the two questions that could
change what is already written, not the full brief. What remains unrun is listed at the end.

Nothing here is second-hand from an agent. Every figure was read from the page cited.

---

## 1. The letter of credit figure — CONFIRMED, primary-sourced

Previously cited as "60–80%" from vendor blogs. Now traced to the primary document:
**ICC Banking Commission, Technical Advisory Briefing No. 3, "Reducing discrepancy rates under
Documentary Credits", 27 June 2022.** Verbatim, from the ISSUE section:

> "It is estimated that the global percentage of documents refused on first presentation under
> documentary credits ranges between 65-80%."

Correct the figure to **65–80%**, and describe it as an ICC *estimate* rather than a measurement.

Supporting detail from the same briefing, all quotable:

- **The rules are not the problem.** "the primary problem lies not with the UCP 600, but with how
  the rules are used, i.e., through application and practice."
- **Decades of a published rulebook changed nothing.** In the ICC's 2017 Trade Survey
  (*Rethinking Trade & Finance*), 26.7% of respondents reported a decrease in first-presentation
  refusals, 12.3% an increase, and **58.9% no change whatsoever.** The briefing itself calls this
  "a fairly insignificant change".
- **Causes, per ICC National Committees:** poor drafting of the credit; outdated or inappropriate
  application forms; lack of understanding of UCP 600 workflows; lack of attention to detail in
  document collation; excessive and unnecessary data added to documents; and **restricted access
  to ISBP 745 and/or ICC opinions.**
- **The remedy the ICC proposes is education.** Better credit drafting, workshops, seminars, and
  advising beneficiaries to buy a copy of ISBP 745. It also concedes the access problem: "The
  question of online access, digital availability, pricing, regular updates in line with
  Opinions, etc., must also be addressed."

That last point qualifies our own argument and should be stated when we use it: UCP 600 and
ISBP 745 are **paid ICC publications**, so this is not a pure test of "published but still
failing" — part of the failure is that the rulebook sits behind a paywall.

## 2. The discovery that adds a new mechanic — the gatekeeper monetises the loop

The same ICC briefing, on discrepancy fees:

> "It is often commented that a number of banks now consider discrepancy fees as an essential
> element of their revenue stream."

And: fees were originally justified by the extra work, "but is now, perhaps, being abused in some
cases." The ICC notes it cannot fix this — "neither the ICC, nor the UCP 600, can mandate how the
market should handle this issue."

This is a **sixth screening question**, and probably the most powerful one:

> **Does the gatekeeper earn revenue from the iteration loop?**

Where the assessor bills for incompleteness, the loop will never be fixed from the assessor's
side, no matter how much it costs the applicant. That is the strongest possible reason an
arbitrage persists — stronger than tacit knowledge, stronger than the split-cost externality in
doc 09, because it inverts the incentive rather than merely diluting it.

It also reframes the buyer question. In doc 09 I concluded "when the assessor pays, the market
clears fast". The corollary: **when the assessor is paid, the market never clears — and the
applicant is the only possible customer.**

Worth checking against Acquired directly: do Australian banks charge application, valuation or
assessment fees on business acquisition loans that are earned regardless of outcome? If yes, the
bank is a worse commercial counterparty than doc 09 assumed, and the buy-side is the only buyer.
**Open question for Mark and for the bank conversation.**

## 3. Letter of credit document checking — INCUMBENCY CONFIRMED, market taken

I flagged in doc 10 that Traydstream probably owned this. It does.

- Founded 2015, **~US$66m raised** in total, including a €9.3m round.
- Checks extracted document data against "over 400,000 permutations of international trade
  rules" including UCP 600 and ISBP, plus sanctions and dual-use goods screening, and produces a
  discrepancy report for human review.
- Partnered with Surecomp; sells to both banks and exporters.
- **Claimed results (vendor-sourced, discount accordingly):** with one top-tier international
  bank, 10,000+ documents in three months and a **75% reduction in discrepancy rates**;
  elsewhere, processing costs down 60–70%, error rates down 80%, checking time from three days
  to 40 minutes.

Two conclusions, pulling in opposite directions:

**Against us:** trade finance is closed. Do not enter it.

**For us:** this is the best available proof that *the mechanisation thesis actually works*. A
75% reduction in first-pass discrepancies is the arbitrage being captured, by software, against
a published-but-poorly-applied rulebook, with a human left on the gate to resolve flagged items.
That is structurally the same product as Acquired's deal pack. It is worth citing to the bank
for exactly that reason — someone has already proven the model in an adjacent, more conservative
corner of the same institution.

## 4. The counter-thesis — SPLIT VERDICT, and this is the most useful finding

Question 4 was: has publishing checklists, standardising forms, or portal lodgement ever actually
reduced first-pass failure? The honest answer is **yes for one layer, no for the other**, and the
distinction is now the core of doc 10.

**Structured submission works on clerical completeness.** FDA guidance states eSTAR submissions
"are not anticipated to undergo a refuse to accept (RTA) process" because a properly prepared
electronic template "should represent a complete submission". RTA was replaced by virus scanning
and technical screening, with an incomplete eSTAR placed on hold and deemed withdrawn if not
replaced within 180 days. RTA hold rates fell from **up to ~60%** in the early programme to
**~33%** (the current figure is vendor-cited to "FDA/industry data" — medium confidence, worth
verifying against a CDRH or MDUFA performance report).

**It does not touch substantive completeness.** Even under mandatory eSTAR, approximately **67%
of 510(k) submissions receive at least one Additional Information request during the first
review cycle** (vendor-cited to FDA FY2022 data — medium confidence), and the review clock pauses
while the sponsor responds.

So a gatekeeper *can* engineer away the clerical layer, and the FDA did. The lesson for us is
uncomfortable and important: **any part of our product that is form-filling has a shelf life.**
The bank can build a portal that refuses to accept a submission until every field is populated.
What it cannot build is the thing that knows, for this particular business, which add-backs will
be contested and what evidence pre-empts the objection. Sell that.

---

## Corrections to earlier docs

| Doc | Claim | Status |
|---|---|---|
| 10 | "60–80% of LC presentations rejected first pass" | **Corrected to 65–80%**, primary-sourced to ICC TAB No. 3 |
| 10 | "The FDA publishes its checklist yet still issues RTA for clerical faults" | **Wrong as framed.** eSTAR largely removed the RTA gate; the clerical layer was fixed. Section rewritten |
| 10 | "Publishing doesn't work, the problem is mechanical" | **Too broad.** Splits into clerical (fixable by structure) vs substantive (not). Rewritten |
| 10 | "Worth checking whether Traydstream already owns this space; my expectation is yes" | **Confirmed yes.** Market taken; retained as proof the model works |
| 09 | "When the assessor pays, the market clears fast" | **Extended:** when the assessor is *paid* for the loop, it never clears |

---

## What remains unrun

Round 1 was meant to cover six themes. Four are outstanding because the agent fan-out failed:

1. **Australian lending primary data.** Still no primary source (RBA, ASBFEO, Treasury,
   Productivity Commission, APRA) quantifying AU SME loan declines attributable to documentation
   versus credit merit. Our best figures remain ASBFEO's one-in-three and a set of
   broker/lender content-marketing numbers. **This is the most important gap** — it is the pitch.
2. **Probate incumbency.** Unresolved: do GlobalX, InfoTrack, LEAP, Smokeball, Actionstep or
   By Lawyers *validate* against registry requisition grounds, or only assemble documents? And
   does any Australian probate registry publish a requisition taxonomy (which would be a
   training corpus)?
3. **ACCC / FIRB and AHPRA incumbency**, plus any 2026 ACCC data on "materially incomplete"
   declarations and Phase 1 stop-the-clock frequency.
4. **New instances:** FIRB processing times from Treasury annual reports, DVA claim backlogs from
   the Royal Commission into Defence and Veteran Suicide, TGA performance statistics, patent
   first-action rejection rates, insolvency, aged care, NDIS.
5. **Practitioner voice.** No Reddit or HN primary voice was gathered — no verbatim accounts of
   how many rounds people actually endured.
6. **Wider counter-thesis evidence:** NSW Planning Portal RFI trends, XBRL/STP/Peppol first-pass
   acceptance, CMS electronic prior authorisation outcomes, and the academic literature on
   administrative burden and checklist failure.

Also unverified: whether the ~33% RTA and ~67% AI-request figures hold against a primary FDA or
MDUFA performance report, and whether Australian banks earn non-refundable fees on business loan
applications (the doc-10 mechanic-F question above).

---

## Sources

**ICC — primary**
- [ICC Banking Commission, Technical Advisory Briefing No. 3, "Reducing discrepancy rates under Documentary Credits", 27 June 2022 (PDF)](https://library.iccwbo.org/content/tfb/BRIEFINGS/20220627_TA_Briefing_No3_reducing_discrepancy_rates.pdf) — credibility 10
- [Same briefing, ICC Germany mirror (PDF, the copy actually read)](https://www.iccgermany.de/wp-content/uploads/2022/10/20220627_ta_briefing_no3_reducing_discrepancy_rates.pdf) — credibility 10
- [ICC briefing addresses the topic of reducing discrepancy rates — Trade Finance Global](https://www.tradefinanceglobal.com/posts/icc-briefing-addresses-the-topic-of-reducing-discrepancy-rates/) — credibility 7

**FDA — primary and secondary**
- [510(k) Submission Process — FDA](https://www.fda.gov/medical-devices/premarket-notification-510k/510k-submission-process) — credibility 10
- [eSTAR Program — FDA](https://www.fda.gov/medical-devices/how-study-and-market-your-device/estar-program) — credibility 10
- [Refuse to Accept Policy for 510(k)s — FDA guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/refuse-accept-policy-510ks) — credibility 10
- [FDA 510(k) success rate and rejection statistics — MedDeviceGuide](https://meddeviceguide.com/blog/fda-510k-success-rate-rejection-reasons-guide) — credibility 5, vendor blog, source of the ~33% and ~67% figures

**Traydstream and trade finance automation**
- [Traydstream — for exporters](https://traydstream.com/for-exporters) — credibility 4, vendor
- [Traydstream and Surecomp partnership](https://traydstream.com/partners/surecomp) — credibility 4, vendor
- [Traydstream raises €9.3M — The BAE HQ](https://www.thebaehq.com/news/traydstream-raises-9-3m-ai-trade-finance-document-processing) — credibility 6
- [AI-driven transformation in trade finance: a roadmap for automating letter of credit document examination — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2666954425000250) — credibility 9, **not read (HTTP 403)**, flagged for a retry via another route
