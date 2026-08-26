# Practitioner voice — the loop, described by people inside it

20 Aug 2026. Round 1 of the deep-research run. Source: Reddit public JSON API and the HN Algolia
index, scraped to `~/Documents/research/completeness-arbitrage/`.

**Credibility caveats, up front.**
- Most of the strongest material is **US SBA 7(a) acquisition lending**, not Australian. The
  mechanic is identical and the domain is exactly ours — business acquisition finance — but the
  numbers are US programme numbers. Do not quote them as Australian.
- Of 73 Reddit queries saved, **27 returned an identical payload** (same MD5), meaning those
  searches were rate-limited or returned a generic listing rather than results. Five threads
  captured real content. Coverage is thin, not systematic.
- Some Reddit content in this corpus is transparently fabricated engagement-bait — one comment
  claims a loan was declined over a "Historical Spirit Easement" because a man buried under a
  porch in the 1920s could not sign a waiver. Entertaining, not evidence. Quotes below were
  chosen for plausibility and internal consistency, but they are anonymous internet accounts.
- The Hacker News corpus (22 files) yielded almost nothing on point — keyword matches, not
  substance. One useful analogue: **Clerky**, which productised US startup incorporation
  paperwork, is a completeness product that won a market.

---

## The quote that is the product spec

From r/loansforsmallbusiness, a lender or broker account replying to someone ten weeks into a
7(a):

> "The document list you're describing is standard — personal financial statements, debt
> schedule, lease agreements, all of it gets requested at some point, **but it shouldn't be a
> mystery. A competent lender or broker should hand you the ~full checklist on day one, not dole
> it out piecemeal every time you submit something. That part is on them, not the process
> itself.**"
> — u/sbaloansHQ

That is the thesis stated by a practitioner without prompting: the requirement set is knowable
and stable, the applicant's suffering is caused by its *piecemeal release*, and the failure is
the intermediary's, not the process's.

## Someone independently discovering the product

> "The pattern: most 'dumb' rejections aren't dumb on the bank's end. They're checkbox compliance
> from underwriters who don't have authority to make exceptions. **Once you understand the boxes,
> you can pre-clear them by asking your loan officer 'walk me through every box on the
> underwriting checklist before we submit.'**"
> — u/Uckheavy1, r/smallbusiness

The same commenter's list of what actually killed deals is the best available illustration of why
the requirement set cannot be guessed:

- A $50k equipment loan died because **the seller** — a manufacturer they had bought from for
  eight years — had no W-9 on file with a bank the borrower did not even use. Three weeks.
- Declined because the business name used "and" instead of "&" versus the secretary of state
  filing. Had to refile.
- Declined because a guarantor had a six-month employment gap **twelve years earlier** that was
  not explained in the application.
- Declined over a UCC filing from a previous lender, discharged four years earlier but never
  filed as released — not even the borrower's debt.

None of those are credit judgements. All of them are completeness failures, and none could have
been anticipated by a first-time applicant.

His closing advice is also, incidentally, a product feature: *"always ask the lender to put the
rejection reason IN WRITING. Half the time the verbal reason and the written reason are
different."*

## Half the cycle time is the loop

> "It takes ~90 days to close an SBA deal. **Half of the time is underwriting, the other half is
> preparing and supplying information from the buyer and seller.** Ideally, two or three lenders
> are working the deal through their own processes simultaneously so that the deal never loses
> time... Some banks are notorious for abandoning SBA deals in late stages."
> — u/yourbizbroker

A practitioner estimate that **~50% of deal cycle time is the collection loop**, not the credit
decision. If defensible, that is the single most useful number for the pitch — it says the
arbitrage is worth roughly 45 days on a 90-day process. Needs an Australian equivalent.

## Option decay, named by practitioners

> "**Deal fatigue starts to set in for both the buyer and the seller.** While you're right that
> 90 days is the standard, usually a delay this long means the lender is struggling with a
> specific checklist item like a messy lease assignment or a very niche environmental report...
> sometimes pivoting to a faster private lender is the only way to **save the deal before the
> seller walks.**"
> — u/wholesomesizzle

And from the buy-side, the abandonment case:

> "I found it near impossible to get the banks to loan money to buy my first business, so instead
> sold everything I owned and paid cash (including PPOR)... As soon as you're 2 years in showing
> good income the gloves come off!"
> — u/Prestigious_Jump_224, r/AusFinance *(Australian)*

## Access to authority as the hidden variable

> "The weird stuff usually comes from junior underwriters who are terrified of making exceptions,
> even logical ones. **If you can get to a senior credit officer or someone with actual
> authority, half of these technicalities disappear. But most borrowers never get that access.**"
> — u/ikosuave, r/smallbusiness

This is a mechanic doc 09 missed. The requirement set is not just tacit — it is **applied at
different strictness depending on who reads the file**. Part of what an intermediary sells is
not knowledge but *escalation*. Software can substitute for the knowledge; it cannot substitute
for the relationship. Worth being honest about that limit.

## The broker who published the checklist anyway

A Florida broker with 250+ closed transactions posted a full SBA 7(a) documentation guide —
pre-qualification items, SBA Forms 413 and 1919, the lot — and noted buyers "should expect the
process to take 60–90+ days". Elsewhere the same account lists the substantive rules that
actually decide the deal:

> "The business must cash flow on paper... **Add-backs must be provable — you can't just say
> 'the seller pays for personal stuff.'**... You need relevant experience... **Different banks do
> different deals and have their own underwriting processes. I've had many lenders reject a deal
> just for another lender to approve it.**"
> — u/FL_Biz_Broker

Two things follow. First, the clerical list *is* publishable, and brokers publish it — consistent
with the FDA finding in doc 11 that the clerical layer is not where durable value sits. Second,
"add-backs must be provable" and "different banks do different deals" are the substantive layer,
and they are exactly what a first-time buyer cannot know. **Lender-specific appetite is a
data asset**: the same deal declined by one bank and approved by another is a routine event, and
knowing which lender to approach is worth as much as knowing what to attach.

## Silent failure, in a person's own words

Not lending, but the clearest statement of the mechanic anywhere in the corpus. An applicant
refused an Australian visitor visa, having attached 39 documents including bank statements,
payslips, employment contract, title deeds and, by his own account, his dog's passport:

> "I threw the kitchen sink at them and uploaded 39 different documents... the justification for
> the refusal is a whole bunch of nothing. **I don't even know what I would change about the
> application if I had to reapply because I don't see any clear pointers on what is lacking.**"
> — u/monteezer, r/AusVisa

Top reply: *"next time use a registered migration agent, it will save you enormous headaches."*
The intermediary premium, priced by a stranger in one sentence.

Note the failure mode: this applicant did not submit *too little*. He submitted a flood. The gate
does not reward volume — it rewards **the right evidence, in the right form, against an unstated
standard.** A product that merely collects more documents makes this worse, not better. That is
a design warning for Acquired: completeness is not maximalism.

---

## What this changes

1. **The pitch has a practitioner-voiced version now.** "The checklist shouldn't be a mystery,
   and it shouldn't be doled out piecemeal" is better language than anything in docs 09–11.
2. **~50% of cycle time being collection, not assessment**, is the number to try to replicate
   with Australian evidence. It is currently one broker's estimate on Reddit.
3. **Lender-appetite routing is a second product**, distinct from pack assembly: the same file
   passes at one bank and fails at another. This supports the doc-09 argument that
   pre-qualification is the higher-value product.
4. **Completeness is not volume.** The visa case shows a maximalist submission failing. The
   Screening and Finance agents must be opinionated about *what to include*, not just thorough.
5. **We cannot sell escalation.** Part of the intermediary's value is access to someone with
   authority to make exceptions. Software does not have that. Say so rather than overclaim.

---

## Sources

All Reddit permalinks below were captured 20 Aug 2026; raw JSON retained under
`~/Documents/research/completeness-arbitrage/reddit/` and `/hn/`.

- [u/sbaloansHQ — "shouldn't be a mystery... full checklist on day one"](https://www.reddit.com/r/loansforsmallbusiness/comments/1tzyedg/comment/oqfg26d/)
- [u/Uckheavy1 — checkbox compliance and pre-clearing the boxes](https://www.reddit.com/r/smallbusiness/comments/1t8utib/comment/okyh50p/)
- [u/yourbizbroker — 90 days, half of it supplying information](https://www.reddit.com/r/loansforsmallbusiness/comments/1s9hw2i/comment/odqerej/)
- [u/wholesomesizzle — deal fatigue, seller walks](https://www.reddit.com/r/loansforsmallbusiness/comments/1s9hw2i/comment/ofe753z/)
- [u/ikosuave — junior underwriters, access to authority](https://www.reddit.com/r/smallbusiness/comments/1t8utib/comment/ol0t9pn/)
- [u/FL_Biz_Broker — SBA 7(a) buyer documentation guide](https://www.reddit.com/r/buyingabusiness/comments/1spxj06/sba_7a_buyer_overview_documentation_guide/)
- [u/FL_Biz_Broker — provable add-backs, differing lender appetite](https://www.reddit.com/r/loansforsmallbusiness/comments/1so02s1/comment/ogqzo6f/)
- [u/whitemanrunning — "drowning in forms", six weeks pre-submission](https://www.reddit.com/r/loansforsmallbusiness/comments/1rcbvfg/sba_loans_is_the_paperwork_nightmare_actually/)
- [u/monteezer — 39 documents, refused, no pointers](https://www.reddit.com/r/AusVisa/comments/1mva6t0/new_to_the_refusal_club/)
- [u/Prestigious_Jump_224 — gave up on bank finance, paid cash](https://www.reddit.com/r/AusFinance/comments/1glzzlf/comment/lw06q5m/)
- [Clerky handbook on startup incorporation — HN](https://news.ycombinator.com/item?id=36229524)
