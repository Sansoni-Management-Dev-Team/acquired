# Reddit signal — what practitioners actually say

Scraped 19 Aug 2026 from r/buyingabusiness (17.3k), r/searchfunds (264), r/smallbusiness (2.5m),
r/sweatystartup (209k), r/AusFinance (838k). Searches on deal sourcing tools, off-market
outreach, succession signals, and Australian acquisition finance.

This is the layer the SERP sweep couldn't reach: SERP shows what vendors claim, Reddit shows
what buyers find when they use it.

---

## 1. The finding that most threatens the Outreach agent

> *"Cold email outreach has gotten so easy that it barely works. We used to get >30% reply rates
> and now it's sub 5%. IMO, showing that you're willing to work hard and experience a little
> discomfort can differentiate you from the many, many people using AI and email campaign
> software to spam owners. So things like handwritten letters, networking live at conferences and
> tradeshows, cold calling, etc. work better these days."*
> — r/buyingabusiness

Corroborated by the highest-response tactic anyone reported in the sweep, which involved no
software at all:

> *"I went to about 10 of them in my area and asked to speak to the owner. Of course, the
> receptionist won't allow that so I had a letter ready. The letter explained what I was looking
> for and explained that I was local to the area and not PE. I got almost a 50% response rate."*

**~50% for a hand-delivered letter versus sub-5% for AI-assisted email.**

This does not kill the Outreach agent, but it reframes it. The agent's value cannot be *volume of
personalised email* — that's the commoditised, actively-decaying channel, and Mark's own outbound
background means he'll recognise this faster than most. The defensible version is:

- **Multi-channel by design.** Letter and call are the channels that work. The agent should draft
  a *letter* — physical, addressed, printable — as a first-class output, not an email with a
  fallback. Merge-to-print is trivial; nobody does it because everyone is building email tools.
- **Evidence-driven specificity, not tone.** The one thing AI genuinely does better than a busy
  searcher is read the target's website, reviews, register history and tenure, and surface the
  one specific detail that makes the approach land. That's the Screening agent's evidence feeding
  the draft — which is exactly the architecture in the brief.
- **The reframe of the ask.** Best-received phrasing in the sweep: not *"are you selling?"* but
  *"would you ever consider a succession conversation if the fit and transition plan were
  right?"*

Worth raising with Mark explicitly at kickoff. It's a product risk, not an engineering one.

---

## 2. Register-driven sourcing is validated — and it's what the prototype already does

A full playbook posted in r/buyingabusiness, independently arriving at the AMCA approach already
in Mark's prototype:

> *"If you're running off-market sourcing for a fragmented vertical … and you're buying lists
> from brokers or scraping Google Maps, you're probably overpaying and underperforming. Every
> state maintains public business licensure databases."*

Their process: pull the state licensure registry (verified name, owner, address, often email) →
enrich each website with an LLM for a one-or-two-sentence specific detail → rotate sending
domains → 2–3 sentence email, one specific detail, single ask, no attachment or calendar link →
drip over time.

Echoed in the top comment on the Northern Virginia thread:

> *"Start narrower than 'businesses in Northern Virginia'. Pick 2–3 boring service niches …
> build a list from Google Maps / state licensing / local trade groups, then enrich it with
> owner age cues, tenure, weak web presence, and review patterns."*

**Owner age cues, tenure, weak web presence, review patterns.** That is the ripeness score,
described by a practitioner who has never seen Acquired. The AU equivalents are ASIC director
records, ABR, state licensing (VBA for building, ESV for electrical, plumbing registers) and
industry association member lists — exactly the AMCA pattern.

Two things follow. The approach is correct and independently converged upon. And it is not
secret — which makes execution and Australian data depth the moat, not the idea.

---

## 3. The ripeness score's defensibility, challenged by a broker

> *"This is a feature in certain databases but all they do is look at age of owner or years
> since recent acquisition. The good contact lists aren't cheap. As a broker we spend a ton of
> time here. No silver bullet. If there was, it would be sold, overused, and value diluted away
> fairly quickly."*
> — broker, responding to someone asking whether a "find owners likely to sell" tool exists

Two claims worth separating. The first — that existing tools only use owner age and years since
last transaction — is an *opportunity*: the prototype's five-signal model (tenure, GM in place,
age band, no next-generation family, paused capex) is already richer than what he describes.

The second — that any effective signal gets arbitraged away — is a genuine strategic argument
and Mark should have an answer to it. The strongest counter is that the moat isn't the signal,
it's the closed loop: signal → approach → reply → documents → model → **funded deal**. A list
vendor can copy a score. They cannot copy a bank relationship.

---

## 4. Australia has a real, documented acquisition-finance gap

The single most on-point thread found, in r/AusFinance (39 points, 48 comments):

> *"My current employer is retiring and has offered my partner and I the option to buy the
> business … We've tried the big 4, Bendigo, and a couple other mid-tiers but no one will touch
> it. Our finances and the business's profitability are not the issue. We have enough home equity
> to buy the business in cash, and the purchase price is around 3x NPAT. Each bank took me on an
> hour-long phone call asking every question under the sun only to say 'We're only loaning to
> existing business owners to grow, not to new owners to purchase'."*

A creditworthy buyer, a profitable business, a sane 3x multiple, an owner who wants to sell — and
the major banks would not lend. Top responses: use a broker, and try **Judo Bank**. Another
commenter: *"I found it near impossible to get the banks to loan money to buy my first business,
so instead sold everything I owned and paid cash."*

This is the clearest commercial validation in the whole sweep, and it isn't in any vendor's
marketing. **Australian SME acquisition finance is broken at the origination layer** — not on
credit quality, but because the deal never arrives at the bank in a form the bank can process.
That is precisely the gap the deal pack fills, and it explains why a bank is engaged as a design
partner rather than a customer.

Note also the contrast with the US threads, which are saturated with SBA mechanics — 7(a) caps,
504 stacking, SOP changes, pari passu structures. Australia has no SBA equivalent, so every US
competitor's financing layer (DealOrb's SBA lender referrals, for instance) is structurally
inapplicable here. The moat is partly regulatory.

---

## 5. What the Finance agent must handle, per practitioners

From the highest-scoring analytical post in the sweep (91 points, *"The Silver Tsunami Illusion"*):

- **Finding is 10% of the work.** *"The other 90% is managing the seller's psychology and
  structural mess."*
- **The EBITDA mirage.** Over 21% of broken LOIs are caused by financial discrepancies. Owners
  add back the spouse's leased SUV, the country club membership, consulting fees to their kids.
  Rule of thumb offered: **if add-backs exceed 20% of total cash flow, walk or reprice.**
- **The ego multiple.** Sellers anchor at 5–6x SDE; actual Main Street closings sit at **2.7–2.8x**.
- **The GM-salary acid test**, top comment, 29 points: *"Take the SDE and subtract a realistic
  market salary for a competent GM. $300k reported SDE minus a $120k GM salary leaves $180k. You
  aren't buying a $300k cash-flowing asset, you're buying a $180k business that requires a
  grueling 60-hour week."*

Three concrete requirements fall out of this, and all three are testable:

1. **Add-backs must be itemised, sourced, and totalled as a percentage of cash flow** — with the
   >20% threshold flagged. This is exactly "evidence or nothing" applied where it earns its keep.
2. **Normalise for a market GM salary** as a standard adjustment, shown explicitly.
3. **Show the multiple against a market benchmark**, not just the asking multiple.

Worth noting the prototype's `GM-IN-PLACE` flag and `ownerOutOfBusiness` field are already the
right instinct — a GM in place is what makes reported SDE real rather than a disguised salary.
The prototype treats it as a succession signal; it's also a financial-quality signal.

---

## 6. Nobody is building this, and the searcher tech stack is a mess

A searcher asking what an ideal "searcher's operating system" would look like — CRM, email
parsing, enrichment, workflow automation — drew almost nothing. The top reply:

> *"My search tech stack consisted of a cellphone and a broker's name and number."*

Consistent with the SERP finding. The market is under-tooled, but the incumbents are relationship
channels, not software: repeatedly across threads, the highest-yield sources named were **CPAs
and lawyers** (*"they will usually know which of their clients are considering an exit before
anyone else"*), local ETA communities, and industry conferences.

Software's honest position is that it wins the **long tail** — the hundreds of businesses nobody's
accountant introduces you to — while relationships still win the best single deal. Acquired
should not claim to replace the network.

---

## What I'd change in the plan because of this

1. **Draft a letter, not just an email.** Cheap to build, matches the channel that actually
   works, and immediately differentiates from every US competitor.
2. **Put the add-back test, GM-salary normalisation and benchmark multiple in the Finance
   agent's acceptance criteria** — these are the specific things that break real deals.
3. **Raise the cold-email decay finding with Mark at kickoff.** He ran outbound programs; he
   will either already know this or will want to know it before we build for that channel.
4. **The AusFinance thread is worth showing the bank.** A creditworthy buyer turned away by four
   lenders is a better argument for the pilot than any deck.

## Sources

- r/buyingabusiness — [Silver Tsunami Illusion](https://reddit.com/r/buyingabusiness/comments/1uy01rk/), [7 months stuck](https://reddit.com/r/buyingabusiness/comments/1ulj2rt/), [Northern Virginia off-market](https://reddit.com/r/buyingabusiness/comments/1uxav5k/), [Florida register playbook](https://reddit.com/r/buyingabusiness/comments/1t00pqw/), [tool that finds owners likely to sell](https://reddit.com/r/buyingabusiness/comments/1nnyp1v/), [proprietary vs brokered](https://reddit.com/r/buyingabusiness/comments/1ux7a73/), [search fund tech stack](https://reddit.com/r/buyingabusiness/comments/1nyemnr/)
- r/AusFinance — [Where do I get a loan to BUY a business?](https://reddit.com/r/AusFinance/comments/1glzzlf/)
