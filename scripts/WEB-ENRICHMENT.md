# Public company enrichment pilot

Run `node scripts/repair-web-enrichment-pilot.mjs` to reprocess the archived v1 pilot without provider calls. It preserves the original at `.local-data/manufacturer-web-enrichment-pilot.v1.json` and writes the corrected schema to `.local-data/manufacturer-web-enrichment-pilot.json`.

`node scripts/experiment-manufacturer-web-enrichment.mjs` performs a new ten-company Crawl4AI experiment with the same normalizer. It saves page bodies and SERP snippets with retrieval metadata. The old pilot discarded page bodies and individual retrieval timestamps; repair uses surviving snippets/excerpts and leaves those timestamps unknown. Batch completion is not the publication or retrieval date.

The v2 document contains retrievals, company observations, resolved profiles and separate estimates. Accepted means an entity-matched reported claim, not verified accuracy. Rejected observations remain available with reasons. Source preference is first-party, LinkedIn, ZoomInfo, other; it is a deterministic heuristic, not a numerical probability. Differing accepted values are flagged. Sources may share upstream data.

Headcount point/range/bound semantics are preserved. `headcount` is unspecified geographic scope; `headcountAU` and `headcountGlobal` are resolved separately. Headquarters location does not establish workforce scope. Unspecified revenue currency remains null. Estimates remain null until an explicit validated benchmark model is provided. Repeated claims from the same URL share one observation and retain retrieval references.

Run `pnpm vitest run scripts/lib/web-enrichment.test.mjs` for extraction/schema regression checks. The optional local-data regression also checks the archived pilot when present.

## Firmable comparison

`node --env-file=.env --env-file=.env.local scripts/fetch-firmable-pilot.mjs` requests five company profiles and saves raw response bodies, HTTP status, request identifiers and actual retrieval timestamps to `.local-data/firmable-enrichment-pilot.json`. It skips recorded requests on subsequent runs and stops on authentication, throttling or insufficient-credit errors. No credentials are written to the output.

The September 7 comparison returned insufficient-credit errors for all five requested domains. No successful company profile was obtained, so actual Firmable field shapes, currency semantics and employee-scope mapping have not been validated in this experiment. Failed responses must not become enriched targets. Database persistence is pending successful responses and clarification of the target organisation (the configured local database contains multiple organisations with the same name).

These scripts do not change the application's live search flow or apply database migrations. Outputs and raw evidence remain local under the ignored `.local-data` directory.
