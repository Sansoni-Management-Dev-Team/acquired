# Self-critique

20 Aug 2026. **Provenance caveat, stated first:** three critique agents were commissioned
(skeptical practitioner, adversarial reviewer, implementation engineer). None delivered despite
repeated prompting. What follows is my own audit of my own research, which is structurally weaker
than independent review — I am checking work I have an interest in defending. Treat it as a list of
known weaknesses rather than as adversarial validation. The TPD correction in
[doc 09](09-completeness-arbitrage.md) came out of this process and is the most substantive result.

---

## 1. Is the three-layer model falsifiable, or have I built an escape hatch?

**The honest answer: it has one genuine pre-registered test and is otherwise post-hoc
classification. That is weaker than it reads.**

The escape hatch is obvious once named. If a gate encodes its requirements and substantive denial
rates *fall*, I could always say "then that requirement was encodable all along, so it was Layer 2,
not Layer 3" — which makes the model unrefutable by construction. I have not made that move yet, but
nothing in the framework as written prevents me from making it.

**Closing it requires committing to the classification criterion in advance.** So, committing now:

> A requirement is **Layer 2** if an applicant can verify their own compliance *before submission*
> without any judgement about persuasiveness. It is **Layer 3** if compliance can only be assessed
> by someone forming a view about whether the evidence is convincing.

By that criterion, and stated in advance so it can be held against me:
- "Two years of BAS lodgements attached" — **Layer 2**.
- "Add-backs are provable" / "normalised EBITDA a credit team will accept" / "the buyer can run this
  business" — **Layer 3**.

**The pre-registered falsifier.** From 1 January 2027, CMS-0057-F requires payers to publish
documentation requirements through a mandated API — Layer 2 encoding imposed federally, with CY2025
denial and overturn metrics already published as a baseline. If denial rates fall materially and
overturn-on-appeal rates fall with them, **Layer 3 durability is refuted** and I should say so. I am
naming that before the data exists, which is the strongest version of this the model currently
supports.

**What remains weak.** Every other layer assignment in the research was made after seeing the
outcome. NSW is a clean Layer-1 falsification because the prediction (digitising the channel does
nothing) was contradicted in the direction that hurt — returns *rose*. But the Companies House case
was classified as Layer 2 *because* it worked, which is circular. I should hold the model as a
**design heuristic with one real test attached**, not as an established finding.

## 2. Selection and confirmation bias

I went looking for a pattern and found it in roughly fifteen places. That is exactly what
confirmation bias looks like from the outside.

**In defence, the rejection rate was real, not token.** Of the candidates examined: patents rejected
as a negative case; NDIS rejected on the capture test; ACCC rejected as a bad market; letters of
credit and commercial insurance rejected as already taken; DSP rejected for having no buyer; VA/DOCA
downgraded when the statutory clock turned out to be purchasable; equipment finance rejected as
already solved. That is roughly a third of examined candidates rejected, on stated criteria, several
of them ones I had initially been enthusiastic about.

**But the deeper objection stands.** I never sampled bureaucratic processes systematically — I
selected ones I already suspected. The base rate is unknown, and I suspect the pattern *would*
"find" itself in most institutional gates if I looked. **Which means the framework's discriminating
power does not come from the pattern at all. It comes from the screening questions** — particularly
the intermediary boundary condition, the billing-model test, the layer question, and "whose P&L
carries the loop". The pattern identifies candidates; the screens do the actual work. I should
present it that way rather than leading with the pattern.

## 3. Can software learn substantive sufficiency from outside an institution?

This is the question I most wanted a practitioner to answer and did not get. My own honest attempt:

**Partially, and the defensible claim is narrower than doc 15 implies.**

*Learnable from outside:* the recurring objection taxonomy. Contested add-backs, BAS lodgement gaps,
unreleased PPSR interests, lease assignment problems, missing vendor statements, unexplained
employment gaps. These repeat across deals, are observable from declines and RFIs, and are exactly
what the practitioner corpus in [doc 12](12-practitioner-voice.md) is full of. A system that has
seen a few hundred files knows them; a first-time buyer cannot.

*Not learnable from outside:* this particular officer's current risk appetite, the bank's confidential
exceptions policy, where the discretion boundaries sit this quarter, and — per doc 12 — access to
someone senior enough to grant an exception. Credit policy is confidential and moves with appetite
cycles.

**And Westpac's evidence cuts both ways.** "Over three-quarters of simple deals are now
auto-decisioned" supports the segmentation argument — but it is equally consistent with the residual
being hard for reasons that defeat software too. If judgement-intensive files resist automation *by
the bank, with full access to its own policy and data*, an outsider has a harder problem, not an
easier one.

**The mitigation, which I think is genuinely sound:** we do not need to predict the decision. We need
to remove the *removable* causes of iteration. Every objection that was foreseeable and pre-empted is
value delivered, regardless of the final answer. That is a weaker claim than "we know what the bank
will accept" and it is the one the product should make.

## 4. The liability question, which the research ignored entirely

Nowhere in docs 09–17 did I address what happens when the system says "complete" and the bank
declines anyway. That is a real gap and it has three parts:

1. **"Complete" is a representation.** Asserting completeness against a lender's requirements
   invites reliance. If the pack is deficient and the deal dies, the user's loss is concrete.
2. **Licensing.** Telling a buyer their deal is bankable, or which lender to approach, sits
   uncomfortably close to credit assistance. Whether it crosses into regulated territory depends on
   framing and needs actual advice, not my inference.
3. **Professional indemnity.** Any guarantee mechanism of the kind HCPA uses ("money back after three
   attempts") is an insurance product in substance and needs pricing as one.

**This retrospectively justifies a rule already in the brief.** The language discipline —
"lender appetite", never "pre-approved finance" — reads in doc 01 like a communications preference.
It is actually a liability control, and it should be enforced in the product as a hard constraint on
generated text, not as a style guide. Similarly, the human gate is not just a trust feature: it is
the mechanism that keeps a person accountable for the assertion. **Add to the questions for Mark.**

## 5. Source bias, counted honestly

Of roughly sixty sources assessed: **primary government, regulator, court and central bank sources
number around twenty**, and they now carry every load-bearing claim — ICC, RBA (×2), ASBFEO, NSW
DPHI, NSW Supreme Court (×3), NSW regulation, TGA (×2), DVA, ASIC (×2), ACCC (×2), APRA, Treasury
(×2), FDA (×3), Ahpra (×2), Queensland Health, Commonwealth Health, AustLII, Judo's ASX filing.

The remainder — the clear majority by count — is vendor marketing, law-firm content, lender content
marketing, recruitment-platform data and anonymous forum posts. **Flagging that does not launder
it.** What has improved over the project is that the *load-bearing* claims migrated to the primary
set while the marketing sources were demoted to colour or dropped. What has not improved is the raw
ratio.

Specific admissions: the AHPRA ~60% figure is still unsourced and should not be used. Doc 12's own
corpus contains fabricated content. The strongest practitioner material is US, not Australian. Two
central Australian sources are from 2018.

## 6. "If it's real, why has nobody captured it?" — the best objection, now answerable

Round 1 offered "nobody owns the loop" and "the intermediary bills by the hour". Those were thin. The
research since has produced a better answer, which is that **it does get captured — just not as
software sold to applicants.**

- **Traydstream captured it outright** in trade finance: ~US$66m raised, claiming 75% discrepancy
  reduction.
- **HCPA captured it as a guaranteed service** across ~30 gates, and built software only for its one
  recurring vertical.
- **Gilbert + Tobin captured it internally**, as a tool for its own lawyers.

So the pattern is real and monetisable, and the market has repeatedly told us *how*: inside the
intermediary, or with a guarantee attached, or in the one place where obligations recur. **The
correct conclusion is not "nobody has done this" — it is "everyone who has done this did it as a
service or an internal tool, and we should have a specific reason for thinking direct-to-applicant
software is different."** For Acquired the candidate reason is that the buy-side partner is not
episodic even though the individual buyer is. That is testable with Mark, and it should be tested
rather than assumed.

---

## What I would most want an independent reviewer to attack

1. The claim that the recurring objection taxonomy is learnable from outside without deal history —
   because if false, there is no cold start and the product needs a design partner's back catalogue
   before it works at all.
2. Whether "we remove the removable causes of iteration" is enough of a promise to sell, or whether
   buyers only pay for outcome certainty — in which case a guarantee is mandatory, not optional.
3. The three-layer model's post-hoc classifications, per section 1.
