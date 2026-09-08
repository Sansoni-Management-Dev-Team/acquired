# Public firmographics and estimated EBITDA: feasibility test

Research date: 9 September 2026. Metric: EBITDA, as confirmed by the user.

## Finding

Public web research can retrieve headcount ranges, founding years, locations and business activities. A local live test found these source fields for all three sampled manufacturers. However, the application's current Workers AI model did not reliably bind every extracted fact to the correct company and verbatim evidence. This is a feasibility result, not a production-ready enrichment or a validated earnings prediction model.

Use public facts to select a benchmark, then calculate a separately labelled **estimated EBITDA**. Do not ask an LLM to invent financial values or turn an estimate into reported financial evidence.

## Live experiment

The sample reused three names from the pre-existing ten-company pilot, selected before the live provider runs: Circuitwise, Delta Laboratories and Novaplas. They span electronics, cosmetics/therapeutic contract manufacturing and plastics. The sample is small, non-random and drawn from previously researched businesses; 3/3 source availability is not an expected market-wide coverage rate.

The first Tavily request failed with HTTP 432. The experiment then used the existing local Crawl4AI MCP with DuckDuckGo search and fresh page retrieval. It made six successful search calls and twelve bounded single-page crawl submissions, resulting in eleven distinct page documents. Search snippets were used to locate pages, not accepted as evidence. Each retrieved page was capped at 12,000 characters. Raw retrievals and outputs are archived locally.

Extraction used the same model as the application, `@cf/meta/llama-3.1-8b-instruct-fast`, through the Workers AI API, at temperature 0. Three experiments used three calls each:

1. Expanded prompt, JSON object output: wrong field structure, duplicate claims, followers returned as headcount, unsupported AU workforce scope.
2. Explicit JSON schema: one malformed response; remaining outputs still contained follower counts, rewritten quotes and unsupported scope.
3. Focused four-field prompt, schema, at most three documents / 12,000 input characters: all three headcount ranges were correctly located with matching quotes. Scope was left unspecified. Other errors remained: paraphrased evidence, an invented founding-year calculation, and a customer's founding year assigned to Delta.

The most informative failure was Delta's customer case study. The model extracted The Herbologist's 1988 founding statement as Delta's founding year. The passage genuinely appears on Delta's website: quote matching and first-party domain matching alone cannot establish the subject of a claim.

This experiment tested a modified extraction prompt and a local discovery/crawl fallback. It did **not** exercise the deployed Cloudflare Workflow, app persistence, or scoring. No production code, database records or migrations were changed. The earlier local pilot was preserved.

## Source facts confirmed by review

These are publicly reported, undated profile claims, not verified current employee totals. Workforce geography and exact group/subsidiary scope remain unresolved. A headquarters address does not resolve them.

| Company | Reported company-size range | Reported founding year | Location / business activity | Source |
| --- | --- | --- | --- | --- |
| Circuitwise | 51–200 employees | 1987 | Bella Vista, NSW; contract electronics manufacturing | [Company profile](https://au.linkedin.com/company/circuitwise-electronics-manufacturing), [company history](https://circuitwise.com.au/about-circuitwise/) |
| Delta Laboratories | 51–200 employees | 1982 | Profile headquarters: Sydney, NSW; cosmetics, pharmaceutical and veterinary contract manufacturing | [Company profile](https://au.linkedin.com/company/delta-laboratories-pty-ltd), [company activities](https://deltalabs.com.au/about-us/) |
| Novaplas Group | 11–50 employees | 1980 | Canning Vale, WA; plastic injection moulding | [Company profile](https://au.linkedin.com/company/novaplas-group), [company activities](https://novaplas.com.au/about-us/) |

The founding-year column was confirmed by human-style source review here; the model did not successfully extract all three years. Circuitwise's expanding Australia/New Zealand group and the explicit Novaplas Group label require entity-scope resolution before company-specific financial calculations. LinkedIn's “view all employees” count is not the company-size field.

## Benchmark research

The latest ABS Australian Industry release retrieved was **2024–25**, released **19 June 2026**. Source: [release and downloads](https://www.abs.gov.au/statistics/industry/industry-overview/australian-industry/2024-25), [Australian Industry workbook](https://www.abs.gov.au/statistics/industry/industry-overview/australian-industry/2024-25/81550DO001_202425.xlsx).

Table 1 supplies EBITDA and employment by ANZSIC division/subdivision. Table 5 supplies both by industry division and employment-size band. They do not jointly identify narrow subsector × employee band. The separate four-digit manufacturing workbook provides employment, sales, wages and industry value added, **not EBITDA**; industry value added must not be substituted for EBITDA.

Calculated from Table 1's 2024–25 figures:

| Benchmark | EBITDA (A$m) | Employment ('000 people) | EBITDA per person (A$/year) | Source cells: employment, EBITDA |
| --- | ---: | ---: | ---: | --- |
| Polymer and rubber products | 1,611 | 40.9 | 39,389 | B93, H93 |
| Fabricated metal products | 5,357 | 114.8 | 46,664 | B105, H105 |
| Machinery and equipment | 6,849 | 106.4 | 64,370 | B113, H113 |
| Basic chemicals and chemical products | 3,827 | 50.0 | 76,540 | B89, H89 |

These are aggregate ratios, not median SME earnings. In Table 5, manufacturing businesses with 5–19 employees yield A$39,651/person (D31, Y31); 20–199 yield A$38,482 (D51, Y51); 200+ yield A$74,176 (D71, Y71). This size effect is material. Do not multiply separate size and subsector adjustments together and present the result as an observed joint benchmark.

The polymer/rubber ratio was A$52,995 in 2022–23, A$48,900 in 2023–24 and A$39,389 in 2024–25, using the revised history in the same release. This illustrates time sensitivity; it is not a distribution of individual company outcomes.

ABS defines employment as persons working in the last June pay period, including working proprietors and some payroll contractors. It is not annual average FTE. Match numerator/denominator periods and workforce definitions. ABS EBITDA also excludes items classified as “other income”; it is not automatically a seller's adjusted EBITDA. See [methodology and glossary](https://www.abs.gov.au/methodologies/australian-industry-methodology/2024-25).

## Proposed estimate

```text
benchmark EBITDA per person = industry EBITDA / industry employment
estimated EBITDA = comparable company headcount × benchmark EBITDA per person
```

For a **hypothetical** polymer-products company with 30 comparable employees, the 2024–25 subdivision ratio gives approximately **A$1.18m annual EBITDA**. With only an 11–50 employee band, holding that ratio fixed yields **A$0.43m–A$1.97m**. This is a conditional headcount calculation, not a confidence interval, an estimate of Novaplas's actual earnings, or a bound on possible losses.

Estimating revenue first using sales/person and then multiplying by the same cohort's EBITDA/sales margin gives exactly the same result algebraically. It is not independent corroboration. Keep reported revenue unknown when unavailable; an optional estimated revenue should remain separate.

For an initial product, expose a benchmark-based range and the input assumptions. Use industry and size benchmarks as separate scenarios where no joint cohort exists. Explicitly flag stale/undated headcount, group scope, workforce definition, mixed activities, automation, outsourcing and foreign operations. Preserve loss scenarios; do not imply a positive industry average proves the target is profitable.

## Implementation recommendation

1. Add a dedicated firmographic research pass with about/history/contact pages and publicly accessible structured company profiles. Preserve headquarters, operating locations, founding dates and headcount scopes separately. Prefer narrow activity descriptions over a generic “Manufacturing” label.
2. Parse reliable labelled fields deterministically; use AI for business-activity interpretation and locating evidence. Validate entity, field semantics, quoted passage and date separately. Treat page content as untrusted. Keep disagreements and missing values visible.
3. Preserve headcount point/range/bound semantics. Do not silently turn 51–200 into a precise midpoint or treat an undated range as current AU headcount. Unknown identity/scope should prevent an automatic target estimate until reviewed.
4. Store derived estimates separately from reported fields, with source URLs, observation dates, headcount range, proposed ANZSIC match, benchmark year/table/cells, model version and scenarios. Map industry via reviewed activity evidence; customer industries do not define the supplier's industry.
5. Display “Estimated EBITDA — industry/headcount benchmark”. Use it for research prioritisation. Do not feed it into current qualification, financeability or verified-financial criteria as if it were observed EBITDA.
6. Before using numeric probabilities or narrow intervals, back-test on comparable Australian companies with actual matched headcount and EBITDA. Hold out companies/years, include losses, measure bias and interval coverage, and compare against simple size-band baselines. No predictive accuracy has been established in this experiment.

The source-backed approach is feasible; automatic unreviewed enrichment using the present small model is not yet reliable.

## Reproduce and inspect

Run `node --env-file=.env scripts/experiment-agentic-firmographics.mjs --focused`. The experiment uses local Crawl4AI with DuckDuckGo for discovery and crawling, and Cloudflare Workers AI for extraction. It requires the user's existing local Crawl4AI MCP configuration and Cloudflare credentials. There is no Tavily path or fallback in this script. Searches, crawls and model outputs are cached separately, so rerunning an unchanged variant reuses evidence and responses. `--strict` reproduces the middle variant; omitting both extraction flags reproduces the initial variant. The former `--crawl4ai` flag remains harmless but is no longer required.

Artifacts: `.local-data/agentic-firmographics-2026-09-09/`. `results-focused.json` contains mechanical checks, **not semantic approval**; `reviewRequired` intentionally remains true. `abs-benchmarks.json` records extracted units, source cells and calculated ratios. Downloaded workbooks are retained alongside it. Syntax and scoped ESLint checks passed. There were nine live Workers AI calls; no production test or database test was run.

## Funeral-sector pilot and application integration (9 September 2026)

The six companies in mandate `b0de19cc-3a17-482f-afc7-c444426058e5` were examined with local Crawl4AI retrieval and Cloudflare Workers AI. The narrow headcount experiment matched four labelled counts and abstained on the two pages without a count. These were selected, reviewed pages: this is a six-case extraction check, not a measured success rate for autonomous discovery.

| Company | Observed headcount | Material qualification |
|---|---|---|
| Ashton Manufacturing | 51–200 on its public LinkedIn company profile | Company website matches. Acquired by Reilly+Best in December 2024 according to its sell-side adviser; acquisition availability is unknown. |
| Killara Co Australia | 11–50 on its public LinkedIn company profile | Profile declares killara.com.au; the mandate uses victoriancoffinscaskets.com.au. The legal/brand mapping requires review before attaching this count. |
| Wholesale Funeral Products Australia | 2–10 on its public LinkedIn company profile | Source is undated; workforce geography and legal-entity scope are not established. |
| Sydney Coffins | 2 in a Datanyze profile | Weak, undated third-party data. The production extractor currently accepts matching company websites and LinkedIn company profiles, so this provider-only number remains outside automatic extraction. |
| Memorial Urns Australia | Not found | Current website ABN and provider identifiers conflict; resolve the operator before financial qualification. |
| Scientia | Not found independently | Possible overlapping Killara group/brand. Do not duplicate the Killara workforce or infer ownership solely from website branding. |

Sources: [Ashton LinkedIn](https://au.linkedin.com/company/ashton-manufacturing), [Ashton acquisition adviser](https://www.oasispartners.com.au/track-record/ashton-manufacturing-acquired-by-reilly-best/), [Killara LinkedIn](https://au.linkedin.com/company/killaraco), [WFPA LinkedIn](https://au.linkedin.com/company/wholesale-funeral-products-australia), [Sydney Coffins provider profile](https://www.datanyze.com/companies/sydney-coffins/472380246), [Memorial about page](https://cremationurnsdirect.com.au/about-us/), [Scientia contact page](https://scientia.com.au/contact-us/).

Application changes:

- Business research offers a company-details follow-up for up to two researched companies, three page attempts/model calls and one search per company. This runs before the separately selected people phase. Cancelled follow-ups stop the automatic chain; failed jobs count against its allowance.
- Existing targets can start a five-page company-details run from their review panel. The server derives identity from the mandate membership, scopes findings to the organization/mandate/target, and revalidates facts against the saved page. Website changes prevent attaching findings from an outdated job to a different identity.
- Headcount uses a dedicated Workers AI extraction, checked independently against explicit company statements or the Company size field on a LinkedIn profile that declares the reviewed domain. Other labelled fields capture industry, headquarters and founded year. The extractor intentionally abstains on unsupported third-party data and unresolved domain aliases. Failed AI calls retain directly observed labelled evidence with a partial-run warning.
- Findings keep their source quote and retrieval date in the existing research findings table. Source dates and legal-entity scope remain unverified. No target revenue, headcount, EBITDA, qualification, or score fields are overwritten.
- The review panel calculates an explicitly labelled, conditional EBITDA scenario from bounded positive headcount and the selected ABS industry cohort. Conflicting/open-ended headcounts block calculation. No revenue is fabricated. Benchmark selection is a session-only scenario input, not a saved financial assertion.
- App business/people/profile searches now call the authenticated Cloudflare worker `/search` endpoint. Browser Run reads DuckDuckGo's public HTML results; only result URLs are used as seeds, never snippets as evidence. Unsupported/blocked searches return an unavailable warning and preserve supplied websites. No production Tavily fallback remains.

The application and Cloudflare worker need to be released together, preferably worker first, because the app uses the new `/search` endpoint. Existing worker secrets and Browser Run permissions are required. No database migration is required for this change; none was run. The implementation is local and has not been deployed.

Validation: 246 automated tests passed, app/worker TypeScript and ESLint passed, Next production build and Wrangler dry run passed. A live Cloudflare search returned Ashton Manufacturing's company profile and website. An immediate follow-up Browser Run profile request returned HTTP 429. A later bounded request succeeded; the production headcount prompt and validator then passed against that fresh Cloudflare retrieval, returning 51–200 employees, founded 1977, Manufacturing and Molendinar, Queensland. These checks cover the live provider stages in separate calls, not a deployed Workflow/app callback or browser UI run. The opt-in smoke test is `RUN_CLOUDFLARE_SMOKE=true node --env-file=.env node_modules/vitest/vitest.mjs run src/domain/company-facts.live.test.ts` (up to three billable provider calls, no database writes). To resume just extraction against the archived live Cloudflare page, additionally set `CLOUDFLARE_SMOKE_PROFILE=.local-data/cloudflare-company-smoke/profile.md` (one model call).

## ASIC and ownership-tree feasibility

[ABN Lookup](https://abr.business.gov.au/Documentation/WebServiceResponse) can resolve ABN, legal/trading names, entity status and location. It does not supply a director/shareholder ownership graph. [ASIC current/historical company extracts](https://www.asic.gov.au/about-asic/freedom-of-information-foi/foi-requests/information-and-documents-on-asics-public-registers) provide director and member/shareholder information, available through ASIC or an information broker. The [ASIC company register](https://www.asic.gov.au/online-services/search-asic-registers/company-and-organisation-registers) distinguishes free identity data from paid extracts.

A proposed ownership workflow would resolve a trading name to a legal entity and ACN, read the extract, and follow each corporate shareholder through another extract. Keep `director-of`, `registered-shareholder-of`, and `business-name-held-by` as separate dated relationships. Record share class, count and beneficially-held flag where available; do not turn share-count proportions into voting/control assertions without supporting rights information. Detect cycles, retain unresolved nodes and cap paid lookups. [ASIC's members-register guidance](https://www.asic.gov.au/for-business-and-companies/companies/company-share-and-shareholder-rules-and-changes/members-register-requirements-and-changes) distinguishes beneficial and non-beneficial holdings; nominees, trusts and foreign entities may leave the ultimate natural-person owner unresolved. This registry workflow is a proposal, not implemented or purchased as part of the company-details change.
