# Opportunity qualification model

Derived on 26 Aug 2026 from the deployed `acquired-deal-engine.vercel.app` prototype and the
repository research, especially `03-client-context.md`, `04-prototype-teardown.md`, and
`07-lender-requirements.md`.

## The decision

A good opportunity is not one blended score. It must be evaluated on three independent axes,
plus evidence confidence:

1. **Fit** — does the company satisfy the buyer's mandate?
2. **Ripeness** — is there credible evidence that the owner may engage on succession?
3. **Financeability** — can the business and likely structure survive lender screening?
4. **Confidence** — how much of the required evidence is actually known?

The axes must be displayed separately. An owner-dependent company can be highly ripe but poorly
financeable. A professionally managed company can be financeable with no evidence that its owner
wants to sell. Averaging either tension away destroys useful information.

## Data layers

| Layer | Core data | Likely source |
|---|---|---|
| Discovery | legal/trading name, ABN, domain, location, sector/register membership | Apollo, ASIC and industry registers |
| Company enrichment | headcount, revenue band, industry codes, locations, company status | Firmable |
| Owner/contact | role, tenure, seniority, management layer and contact availability | Firmable people search, ASIC, website and approved professional sources |
| Succession evidence | director tenure, owner age band, sole-director structure, GM in place, successor evidence | ASIC, LinkedIn/website evidence and explicitly labelled inference |
| Operating quality | recurring/service revenue, concentration, margins, capital intensity, customer/contracts profile | management accounts, RFI documents and company evidence |
| Financeability | stressed DSCR, goodwill type, add-backs, concentration, lease term, BAS currency and buyer equity | lender model, finance agent and RFI documents |
| Provenance | source, URL, capture time, confidence and inference status | stored with every derived value |

Firmable's documented API is not company discovery. It enriches a known company and searches
people within a known Firmable company. Apollo is therefore the optional broad discovery layer;
Firmable is the AU company/contact enrichment layer. Register-led discovery remains valuable for
defined verticals because it can produce a licensed, auditable universe.

## Qualification rules

Hard mandate failures or suppression produce `excluded`. Missing information produces `research`,
not a fabricated score or silent failure.

- `priority`: fit >= 75, ripeness >= 70, financeability >= 60, confidence >= 60
- `develop`: fit >= 60, ripeness >= 45, financeability unknown or >= 50, with usable confidence
- `research`: evidence or one axis is insufficient; enrich before outreach
- `excluded`: hard mandate constraint failed or the target is suppressed

Initial financeability evidence weights:

- stressed DSCR >= 1.25x: 30
- business rather than personal goodwill: 20
- largest customer <= 20% of revenue: 15
- independent GM in place: 15
- recurring/service revenue >= 35%: 10
- add-backs <= 20% of cash flow: 10

These lender values are hypotheses from secondary market research, not an Australian bank's
published policy. They remain configurable until validated against a real lender checklist and
redacted declined transactions.

## What was harvested from the prototype

The prototype's valuable vocabulary is retained: `PRIORITY`, `SUCCESSION-SIGNAL`, `GM-IN-PLACE`,
`FINANCIALS-AVAILABLE`, `SINGLE-STATE`, `EPONYMOUS`, `REGIONAL`, and `NEEDS-ENRICHMENT`.
In the production model these are derived labels over evidence, not manually assigned sources of
truth.

The prototype's first target included revenue/EBITDA ranges, capital intensity, owner tenure,
management depth, recurring service revenue and sourced succession signals. Its remaining target
scores were largely hard-coded and many records shared the same score, so those numeric values
are not imported. The schema and evidence concepts are useful; the ranking implementation is not.
