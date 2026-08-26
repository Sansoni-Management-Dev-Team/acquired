# The counter-thesis, resolved — three layers, not two

> **QUALIFIED, 20 Aug 2026.** Two problems found on review. (1) The Layer 3 argument is a
> **non sequitur** — it evidences durability with *gatekeeper-side* automation failing, then sells
> *applicant-side* software; the distinction is never drawn. (2) The NSW falsification is
> **over-read**: portal lodgement became mandatory July 2021 and the paper's baseline is FY2021/22, so
> 15%→27% is portal-to-portal, not paper-to-portal. The taxonomy survives as a design heuristic; the
> headline evidence does not. See [19-critique-and-reckoning.md](19-critique-and-reckoning.md).

20 Aug 2026. Deep-research round 2. **Supersedes the two-layer model in
[11-verified-round-1.md](11-verified-round-1.md) and the rewritten section of
[10-arbitrage-instances.md](10-arbitrage-instances.md).** Both were partly wrong. The corrected
model is more useful and more uncomfortable.

Two things happened this round: the FDA numbers underpinning the old model turned out not to be
FDA numbers, and a NSW primary source falsified the model's first half outright.

---

## Part 1 — Corrections to what we published

### The FDA RTA percentages are not FDA data. Drop them.

Doc 11 claimed RTA hold rates "fell from ~60% in the early programme to ~33%", and used that as
evidence that structured submission fixes clerical completeness.

- The **~60%** figure traces to an uncited spoken claim by a consultant on a podcast. Not FDA data.
- The **~33%** figure appears only in 2025-26 vendor blogs citing "recent FDA data" with no
  primary reference.
- **The FDA does not publish an RTA rate at all.** It is not a MDUFA performance goal and appears
  in no FDA dashboard. A former FDA analyst who has extracted 40,500+ MDUFA metrics reports no RTA
  rate and no eSTAR-era Additional Information rate exists.

Retract both numbers. My earlier framing of "a gatekeeper solved it, and here is the before-and-
after" had no measured before-and-after behind it.

### The Additional Information figure is real, but it predates eSTAR

The first-cycle AI-request rate **is** traceable to MDUFA quarterly performance reports: **64% in
FY2018, 63% in FY2019, 63% in FY2020 Q2.** So roughly **two-thirds of 510(k)s draw an Additional
Information request in the first review cycle** — a solid, primary-sourced number.

But every cohort **predates the October 2023 mandatory eSTAR transition.** Doc 11 said "even under
mandatory eSTAR, ~67% still get an AI request". That inference is unsupported: the data is from
before eSTAR was mandatory. Use the figure, date-bound it, and stop claiming it demonstrates
anything about eSTAR.

What survives from the FDA material is only the *design* evidence: FDA guidance does say eSTAR
submissions "are not anticipated to undergo a refuse to accept process" because a properly
prepared template "should represent a complete submission". That tells us what the FDA *intended*
structure to achieve. It does not tell us whether it worked.

---

## Part 2 — NSW falsifies the clerical half, with its own data

The old model said: **clerical completeness is fixable by mandatory structured submission.** The
natural experiment that tests it is the NSW Planning Portal — portal-only DA lodgement, mandatory
across all 128 councils since July 2021. Five years of data.

From the NSW Department of Planning, Housing and Infrastructure's own *Improving Development
Assessment* discussion paper (exhibited 2–30 July 2026), data as at 13 February 2026:

| Measure | FY2021/22 | Current |
|---|---|---|
| Councils exceeding 14 days submission-to-lodgement | 52% | **31%** |
| Proportion of applications **"returned"** | 15% | **27%** |

**The channel got faster and completeness got worse.** Returns nearly doubled under mandatory
digital lodgement.

Worst performers, all Sydney metro, per the Department: **Fairfield 63%, Liverpool 56%,
Canterbury-Bankstown 56%, Campbelltown 55%, Sutherland 55%.** Metro return rates run roughly
double regional ones. The Department's own summary: "the quality and completeness of applications
is still a significant issue."

And the sentence that is the thesis, in a government discussion paper:

> "Applicants also note that they **only become aware of the required documentation and standards
> once they begin completing the NSW Planning Portal form.**"

Plus the variance problem, which is the planning analogue of lender appetite:

> "inconsistency regarding the content required in specific documents and drawings, with
> **different councils often requesting varying information for the same requirement.**"

And the structural reason the loop is invisible in official statistics: **the statutory assessment
clock starts at lodgement**, and returns happen *before* lodgement. A DA can sit in the
submission-to-lodgement "grey area" indefinitely — the paper calls the return process "not well
defined in legislation or policy", capable of leaving "applications being delayed without clear
timeframes", with applicants' only recourse being complaints or Land and Environment Court
proceedings to compel the council to act. None of that appears in assessment-time performance
data.

---

## Part 3 — The corrected model: three layers

The distinction is not clerical versus substantive. It is **which of three things you actually
change.**

### Layer 1 — Channel digitisation. Changes nothing.
Moving submission from paper or counter to a web portal. You still upload the documents you chose
to prepare. The form does not know what your project requires, and the portal cannot tell you what
is missing because it was never told what "complete" means for your case.

**Evidence: NSW. Returns went from 15% to 27% under mandatory portal lodgement.** Digitising the
pipe moved the failure earlier and made it more frequent.

### Layer 2 — Requirement encoding with validation at entry. This genuinely works.
The gate encodes its own requirements as machine-readable rules and refuses to accept a
submission that violates them. The requirement set stops being tacit because the form *is* the
checklist.

**Evidence: Companies House WebFiling — roughly 0.3–0.5% rejection online versus 6–9% on paper.**
An order-of-magnitude difference, because online filing validates at entry rather than accepting
and reviewing.

This is the layer where the gatekeeper can destroy a private market, and **NSW is about to attempt
exactly that** (Part 4).

### Layer 3 — Substantive evidence sufficiency. Nothing has ever fixed this.
Whether the evidence persuades against a standard that cannot be reduced to required fields.

**Evidence: US electronic prior authorisation.** Under the CMS Interoperability and Prior
Authorization rule (CMS-0057-F), decisions are now returned in a **median of under one day** — and
2025 denial rates are still **12%, 14% and 18%** across payers, with **43–67% overturned on
appeal**, and KFF finding no reduction in denials from automation.

That is the cleanest possible result. **Automation made the gate instantaneous and changed the
outcome not at all.** Speed is not sufficiency. A structured pipe carrying insufficient evidence
produces a fast decline.

---

## Part 4 — The killer case is real, imminent, and in our adjacent market

I asked for any instance of a gatekeeper solving this well enough to kill a private market. NSW is
building one now.

Announced 2 July 2026, the Department proposes:

> "an interactive online tool to provide tailored guidance on the information required for local
> development proposals. The online tool would guide users through an **address search and a
> structured questionnaire**, using inputs such as land use, site characteristics, constraints and
> hazards, and other relevant planning considerations to **generate a customised set of application
> requirements and standards.**"

Enabled by powers under the Planning System Reforms Act 2025, intended to "minimise the need for
applications to be returned", alongside **standardised statewide DA requirements**, a **deemed
lodgement** process (automatic payment processing on day 7), and **abolition of the Portal's
'return' function** entirely — replaced by lodging the DA and issuing an RFI, so the statutory
clock starts regardless.

That is a Layer-2 product, built by the state, free, with statutory backing. Anyone who had built
a NSW DA-requirements business would be reading their own obituary.

**Two mitigations, and they matter.** First, the same reform has been recommended for over a
decade — the Lambert review proposed a standard set of DA information requirements in **2015**, and
IPART's review of local government compliance burdens repeated it in **2016**. It is only now being
attempted. Gatekeepers move slowly even when they know the answer. Second, note what the tool
does: it tells you *what to submit*. It does not assemble your evidence, judge whether your noise
report will satisfy the assessor, or tell you which council reads the same requirement
differently. It attacks Layer 2 and leaves Layer 3 untouched.

---

## Part 5 — What this does to Acquired

**The good news is that our layer is the durable one.** A deal pack is not a form. There is no
address search that generates "the evidence this bank needs to be satisfied that this gym's
add-backs are real". Layer 3 is where we sit, and Layer 3 has survived every intervention found in
this research — including instantaneous AI-mediated decisioning in US healthcare.

**The discipline this imposes:**

1. **Never build a Layer-1 product.** "Upload your documents to our portal" is worth nothing. NSW
   proves digitising the channel can make completeness *worse* by moving failure earlier.
2. **Treat Layer 2 as borrowed ground.** Anything that amounts to "here is the bank's document
   checklist" can be taken by the bank at any time, and the RBA's October 2025 Bulletin already
   shows lenders "relaxing their documentation requirements" and automating approvals for smaller
   loans. Build it because it is necessary, price it as if it were free.
3. **Put the value in Layer 3, explicitly.** Provable add-backs. Normalised EBITDA a credit team
   will accept. Management-equity evidence. Which lender reads this deal favourably. Pre-empting
   the objection rather than answering it. That is the product; the pack is the delivery mechanism.
4. **The NSW variance finding transfers directly.** "Different councils often requesting varying
   information for the same requirement" is the same phenomenon as "many lenders reject a deal just
   for another lender to approve it" (doc 12) and "only 1 in 100 owners would change banks"
   (doc 14). Where the standard varies by assessor and the applicant assumes it doesn't,
   **appetite routing is a product**. This is now corroborated across three independent domains.
5. **Watch for the deemed-lodgement analogue.** NSW's cleverest reform is procedural, not
   technological: abolish the pre-lodgement grey area so the clock always runs. If a bank ever
   commits to a decision SLA that starts at submission, the option-decay argument weakens sharply.

---

## Part 6 — Framework, restated

Adding to the six screening questions in docs 09–11:

> **Question 7: which layer would our product occupy?** Layer 1 is worthless. Layer 2 is borrowed
> from the gatekeeper. Only Layer 3 is defensible.

> **Question 8: has the gatekeeper already been told how to fix it?** If a review has recommended
> requirement standardisation and it hasn't happened, you have time — Lambert 2015 and IPART 2016
> bought a decade of it in NSW. If a reform is in exhibition, you have months.

---

## Sources

**Primary — NSW Government**
- [Improving Development Assessment Discussion Paper — NSW DPHI, exhibited 2–30 July 2026](https://www.planningportal.nsw.gov.au/draftplans/under-consideration/improving-development-assessment-discussion-paper) — credibility 10
- [Discussion paper PDF — Improving development assessment (downloaded and read in full)](https://shared-drupal-s3fs.s3.ap-southeast-2.amazonaws.com/master-test/fapub_pdf/*DPPs/+Improving+Development+Assessment+Discussion+Paper/Discussion+paper+-+Improving+development+assessment+2.pdf) — credibility 10. Source of the 15%→27% return rate, the per-council figures, and the tool proposal
- Cited within it: Lambert, *Independent review of the Building Professionals Act 2005*, Final Report (October 2015, p 216); IPART, *Review of Reporting and Compliance Burdens on Local Government* (2016, p 100); *Hinkler Ave 1 Pty Limited v Sutherland Shire Council* [2022] NSWLEC 150

**FDA — corrections**
- [Refuse to Accept Policy for 510(k)s — FDA guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/refuse-accept-policy-510ks) — credibility 10
- [eSTAR Program — FDA](https://www.fda.gov/medical-devices/how-study-and-market-your-device/estar-program) — credibility 10
- MDUFA quarterly performance reports — source of the 64%/63%/63% first-cycle AI-request figures (FY2018, FY2019, FY2020 Q2). Reported via the round-2 agent; **not read directly by me**
- The retracted ~60% and ~33% RTA figures: traced to a podcast remark and to vendor blogs respectively. No primary source exists

**Other — reported by the round-2 agent, not independently verified by me**
- CMS Interoperability and Prior Authorization final rule (CMS-0057-F) outcomes: median decision under one day; 2025 denial rates 12%/14%/18%; 43–67% overturned on appeal; KFF analysis finding no denial reduction from automation
- Companies House WebFiling rejection rates: ~0.3–0.5% online versus ~6–9% paper
- Housing Industry Association submission of 29 July 2026 quoting the DPHI discussion paper

**Confidence note.** Part 2 and Part 4 are primary-sourced and I read the PDF myself; treat as
high confidence. The CMS and Companies House figures in Part 3 come from the agent and should be
verified before external use — they carry the Layer-2 and Layer-3 arguments respectively.
