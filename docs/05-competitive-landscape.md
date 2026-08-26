# Competitive landscape — who already does this

SERP sweep run 19 Aug 2026 across deal sourcing, ETA/search-fund tooling, owner outreach,
succession signals, lender-pack generation, and the Australian market specifically.

## The short answer

Nobody does the whole thing. The market splits into four buckets, and **Acquired's shape — one
pipeline running sourcing through to a lender-ready pack — spans three of them.** The fourth
bucket, the lender leg, is essentially empty as a product category.

## The four buckets

### 1. Listing aggregators — on-market, commoditised

**Kumo** (`withkumo.com`) is the reference. Aggregates 100,000+ listings from thousands of
brokers and marketplaces across North America, Europe, Asia, South America, Africa and
Australia. Cleans unstructured listing data, dedupes, adds AI summaries, deal alerts, saved
searches, CSV export. From ~$149–200/month.

What it doesn't do: outreach, financial modelling, lender packs. And critically it's
**on-market** — it aggregates businesses already for sale. Mark's search is off-market by
design: the point is reaching an owner who hasn't listed yet.

Also in this bucket: BizBuySell/BizQuest as the underlying inventory, and DueDilio-style
directories.

### 2. Data and screening platforms — off-market, enterprise-priced

**Grata**, **SourceScrub**, **Cyndx**, **Conceptor** (`conceptor.ai`, from ~$50/month, 1M+
company dataset with similarity search). These sell the company universe plus AI screening and
list-building. ~$5K–15K/year at the mid tier, materially more for Grata/SourceScrub.

Strong on discovery and similarity search. Nothing on outreach, nothing on financing, and all
US/Europe-first. None has Australian ASIC/ABR depth.

### 3. AI agent platforms for deal teams — the closest competitors

**Q2Q (YC W26)** is the nearest thing to Acquired. Described as an AI-native deal sourcing
engine for private equity and search funds using "autonomous AI agents for sourcing, outreach,
screening". Sourcing plus outreach plus screening, agent-driven, exactly the front half of
Acquired's pipeline. US-focused, PE and search funds, six months old.

**Reuben AI** (`goreuben.com`) — AI deal sourcing plus AI due diligence for small business
acquisitions; also portfolio monitoring, LP reporting, fund governance. Fund-oriented.

**DealOrb** (`dealorb.ai`) — the broadest single product found. On- and off-market sourcing,
document analysis (CIMs, tax returns, P&Ls, balance sheets, "98%+ accuracy in under 30
seconds"), deal pipeline stages, LOI generation, **and** SBA lender connections with
pre-qualification. Serving 100+ buyers. US-only in practice — SBA is a US Small Business
Administration programme with no Australian equivalent.

**Viaductus** (Germany) — generates M&A longlists using AI over commercial register data,
explicitly framed around *business succession*. Same insight as Acquired's ripeness score,
applied to the German Handelsregister. Proof the register-driven succession approach works;
also proof it's jurisdiction-locked, which cuts both ways.

**OffDeal (YC)** — often cited as the AI deal sourcing company, but it's **sell-side**. An
AI-native investment bank for owners selling businesses at $5–100M revenue, matching them to
buyers, success-fee only. Opposite side of the table from Acquired.

### 4. The lender leg — empty

Searching for software that generates a credit submission or lender pack for SME acquisition
finance returns **no products at all**. Only consultancies, accounting firms and mortgage
brokers offering it as a manual service, plus a broker in an industry publication noting the
opportunity is "standardising a credit submission so that when brokers sent it to banks it would
fit right into" the bank's process — described as a workflow problem, not something anyone has
productised.

DealOrb's SBA lender connections are the closest, and that's referral matching, not pack
generation, and it's US-only.

**This is the genuinely defensible part of the brief.** It's also the part M0 defers.

## Australia specifically

Thin to the point of absent.

- No Australian equivalent of Kumo, Grata or Q2Q surfaced.
- The AU market is brokers (Xcllusive, Insight Business Sales), advisory firms (William Buck's
  succession and exit practice), and **Capitaliz** — Sydney-based, venture-funded, digital exit
  and succession planning, valuation and exit-readiness. Capitaliz is **sell-side**: it works
  with advisers preparing owners to exit. It's the mirror image of Acquired, and arguably a
  future partner or acquisition target rather than a competitor.
- The macro is well documented and repeatedly cited: roughly one in three Australian small
  business owners planning to retire within the decade, and a succession wave with no
  institutional buyer coverage at the $1–5M EBITDA band.

So the thesis is consensus. The tooling is not built here.

## Where Acquired is differentiated, honestly assessed

**Genuinely defensible:**

1. **The lender leg.** Structured deal pack generated from evidence, aimed at a named bank's
   credit process. No product anywhere does this. Combined with Mark's ANZ relationship, it's
   the moat.
2. **Australian register depth.** ASIC director records, ABR, industry association member
   registers. Viaductus proves register-driven succession detection works; nobody has built the
   AU version. The AMCA-register sourcing already in the prototype is exactly this instinct.
3. **Evidence-or-nothing as an architectural commitment.** Every competitor claims accuracy;
   none makes provenance a first-class field with missing data visibly missing. For a bank-facing
   product that's not a nicety, it's the thing that makes the output underwritable.

**Contested — competitors already do this, and some are ahead:**

4. Sourcing and ranking against a mandate — Grata, SourceScrub, Conceptor, Q2Q.
5. AI-drafted owner outreach with human approval — Q2Q, and a cottage industry of ETA
   outreach systems.
6. Document analysis and financial extraction — DealOrb claims 98%+ in under 30 seconds.

**Weakest position:** if Acquired is judged as a sourcing tool, it's entering a crowded,
well-funded, US-led market late. If it's judged as the thing that turns an off-market Australian
SME into a bankable credit submission, it has no direct competitor.

## What this implies

The three constraints in the brief that read as friction — evidence or nothing, real human
gates, generate the pack from structured data — are actually the differentiation. They're what
a bank needs and what no sourcing tool provides. The sourcing and outreach layers are table
stakes that have to work but won't win anything.

Worth saying to Mark plainly: **the ordering of the M0 criteria optimises for the commoditised
half of the product.** That's defensible for a first environment he can put real work through,
and I'd still build it that way. But the question worth putting to him is whether a lender-pack
prototype in front of ANZ is a faster path to validation than a target list in front of himself —
because he can already source targets manually, and no software anywhere produces the pack.

## Named products for the file

| Product | Side | Coverage | Geography |
|---|---|---|---|
| Kumo | Buy | On-market listing aggregation | Global incl. AU |
| Grata / SourceScrub / Cyndx | Buy | Off-market data + screening | US/EU |
| Conceptor | Buy | Data + similarity search, low cost | US/EU |
| Q2Q (YC W26) | Buy | Agents: sourcing, screening, outreach | US |
| Reuben AI | Buy (funds) | Sourcing + diligence + fund ops | US |
| DealOrb | Buy | Sourcing → diligence → LOI → SBA lender referral | US |
| Viaductus | Buy | Register-driven succession longlists | DE |
| OffDeal (YC) | **Sell** | AI investment bank for owners | US |
| Capitaliz | **Sell** | Exit/succession planning for advisers | **AU** |
| — | — | **Lender pack generation** | **nobody** |
