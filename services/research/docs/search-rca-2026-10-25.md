# Local mandate research failure — 25 October 2026

The failed 24 October test did not establish that there are no suitable companies. Its discovery backend returned unrelated results; the harness rejected them and had no pages to process. The job transport and checkpoint runtime completed normally.

The investigation also found two harness defects: search transport success was not distinguished from useful discovery, and company identity normalization was incorrectly used to select crawl URLs. Both have been corrected. The upstream search mismatch has been reproduced but its internal Bing cause is not established.

## Confirmed findings

| Finding | Evidence | Consequence |
| --- | --- | --- |
| The full query survives the script and worker. | Saved mandate state contains the complete query; direct OpenSERP responses echo it in `query.text`. Verbose navigation logs show the full `q=` value. | The evidence does not support query truncation in Acquire or the harness. |
| Mismatched results occur upstream of extraction. | A separate container using the exact pinned OpenSERP image, with cache disabled, returned unrelated quantum results and unrelated implementation results. CDP captures show the complete requested query in Bing's URL, page title and search box while the result cards are unrelated. | An HTTP 200 and a nonempty result array are not sufficient evidence of useful research. |
| The behavior is query dependent and varies between runs. | Fresh requests for the support query returned Services Australia, SoftwareHQ and Lumary. The same previously failing support query later produced relevant care-software results. The implementation query produced unrelated LMS, JavaScript-library and Walmart content across observations. | Repeated blind retries are not a demonstrated fix. The provider cannot currently be treated as reliable. |
| The original harness lost the discovered page. | A failing regression test showed `https://www.caresoftware.com.au/solutions/aged-care/` becoming `https://caresoftware.com.au/`. In live run `56838068-f347-494b-9b34-23a7c5438f33`, a SoftwareHQ aged-care category result was read at the generic homepage and yielded no accepted claims. | The helper was suitable for Firmable company identity matching, not as a crawler URL. This wasted scarce page budget and removed relevant context. |
| Reader failures are an additional observed constraint. | That same run read one page; Lumary and Imploy attempts returned `page_unavailable` HTTP 502. A subsequent direct read of bare-domain Lumary returned 200 and redirected to its `www` site. | The 502s are not proven to be caused by removing `www`. Their underlying transport cause remains separate and unresolved. |

## Failure chain

For the original zero-page run: full mandate query → Bing/OpenSERP HTTP 200 with unrelated results → all 20 results rejected by the mandate filter → no seeds → zero pages/model calls/findings → terminal partial research → failed acceptance checks.

When the support query later returned useful results: coarse source filtering admitted a comparison page → harness replaced its specific URL with a homepage → extraction rejected unsupported/unrelated claims; two other reader requests failed → zero supported findings despite a completed workflow.

These are separate failures. Fixing the URL loss does not prove the search backend or reader is reliable.

## Changes and verification

`classifyDiscovery` now records received, relevant and eligible candidate counts. It distinguishes `usable`, `empty_results`, `irrelevant_results` and `no_company_candidates`, and propagates a useful warning into research progress. A physically completed search remains recorded as completed; its quality is explicit. The script still fails when useful company evidence is absent.

Crawl seeds now use `row.discovery.url`, preserving the discovered host and page path. Company-domain normalization remains available for identity deduplication. Existing public HTTPS validation still applies.

Both behaviors have regression tests. The diagnostic classification test first failed because the behavior was missing; the URL preservation test first failed with the incorrect normalized homepage. After implementation, all 13 service tests passed. No application database or migration changed, and the original Cloudflare workflow algorithms were not modified.

## Evidence and reproduction

Pinned image: `karust/openserp@sha256:9f5c5736fc7434862fa23dd0955e53d4003ffe42f151a5e1297085decf3100b7` (0.8.12, source revision `29c7b0fbe09640160efcfc1f1e04e60e0fbe60e9`). The [request parser](https://github.com/karust/openserp/blob/29c7b0fbe09640160efcfc1f1e04e60e0fbe60e9/core/common.go) reads the full `text` value; the [Bing URL builder](https://github.com/karust/openserp/blob/29c7b0fbe09640160efcfc1f1e04e60e0fbe60e9/bing/url.go) encodes that text as `q`.

Private local evidence is under `.local/rca/` and `.local/runs/`:

- `rca-browser-pages.json`: actual Bing URL, title, search input and visible result cards captured through CDP.
- `rca-debug-*.json`: direct upstream responses from the cache-disabled diagnostic instance.
- `rca-mandate.json`, `rca-control.json`: direct requests bypassing the research worker.
- `.local/rca/openserp-debug.log`: request parsing and browser navigation logs from the isolated diagnostic container.
- `56838068-f347-494b-9b34-23a7c5438f33.report.json` and `.worker.log`: live reproduction with explicit search-quality diagnostics, before crawl-URL preservation.

The temporary diagnostic container was stopped and removed. It used a separate localhost port and did not hold research database credentials. The ordinary worker and database remain available.

To rerun the bounded mandate test from this service directory:

```sh
npm run build
npm test
node test-mandate.mjs
```

For a raw backend probe from the test namespace, request `/bing/search?text=<URL-encoded full query>&limit=10`. Compare `query.text`, cache headers, result titles/URLs, and the worker's accepted candidate count. HTTP success alone is not the acceptance condition.

## Limits of the diagnosis

The fault has been localized to search content returned through Bing's browser path, and reproduced with the OpenSERP cache disabled. The evidence does not establish whether Bing's internal rewriting, edge/session behavior, localization or another upstream mechanism caused it. Adding quotes and forcing an Australian locale did not produce a reliable fix; one explicit Australian-locale probe returned no organic results.

No claim is made that the generic public-web harness has parity with the full hybrid Firmable pipeline. Revenue, EBITDA, headcount and acquisition suitability remain unverified.


## Verification after the fixes

Run `cc78d874-998d-4eeb-bb11-c09507076594` preserved the discovered paths, including `/industries/aged-care`, `/services/agedcare-details`, and `/aged-care`. One query produced eight eligible URLs; the other returned ten unrelated results and now carried an explicit `irrelevant_results` warning.

The run made three page attempts: Ambrit and Acetech returned reader HTTP 502, while Essential Tech's `/aged-care/` page was read successfully. One model call produced one accepted, source-supported company identity finding for Essential Tech. The finding did not include a supported relevant product/capability/customer claim, so the final `relevantCompanyEvidence` check remained false and the script correctly exited with failure. The workflow itself completed and research remained partial.

This verifies the corrected source URL and diagnostic behavior, not a complete resolution of provider reliability or qualification. No further live retries were performed after this verification.

## Subsequent remediation

The test now explicitly selects Tavily search and extraction in the standalone Node service. The adapters retain full queries and source paths, use the existing search reservations and bounded reader contract, and have no implicit browser fallback. This replaces the failing path for the test; it does not repair or certify Bing/OpenSERP or the old Crawl4AI reader.

Live run `e9218ec3-3404-4f61-8630-97a4b00f144a` reached Tavily and received HTTP 432 on both search calls. A direct one-result request confirmed the account's configured plan usage limit was exceeded. No page extraction or model requests ran. Available quota or a replacement key is required for successful live verification; account/billing changes were not made.

The final error handling now maps Tavily's 432/433 to service HTTP 402 with category `provider_usage_limit`, preserves the upstream status, and stops subsequent discovery queries after a known usage/authentication block. Regression tests demonstrate these outcomes without spending live API quota. All 21 tests pass. The last live run preceded that final classification change, so its historical worker report retains the earlier generic 502; its provider log records the actual upstream 432.


## OpenSERP verification — 26 October 2026

At the user's direction the default test was returned to OpenSERP/Bing, with a dedicated Crawl4AI reader using the current worktree server. Tavily is optional and no Tavily key is loaded in the worker. The host/shared reader is not used by this test.

Run `1cc2f2a4-1008-4b9b-b18f-4b63a41b1c48` passed the bounded smoke acceptance: three successful page reads, three model calls and three supported findings. Lumary's first-party page supplied company identity and a relevant aged-care software product claim. Specific search result paths and `www` hosts were preserved. The implementation query again returned irrelevant results and was explicitly rejected. The research state was partial at the three-page budget; the workflow completed normally. This is evidence that OpenSERP can support this test without Tavily, not proof that its intermittent upstream mismatch is fixed. Financial criteria remain unverified.

## Indonesia localization hypothesis — 26 October 2026

The user confirmed they are currently in Indonesia, consistent with the captured Bing page locale. A four-request comparison kept the two mandate queries unchanged and compared default settings with `lang=en-AU&region=au` on the same local OpenSERP container. Default support search returned 10 relevant results; default implementation search returned 10 unrelated results. Both explicit Australian-market requests returned zero results. All calls returned HTTP 200. Evidence: `.local/runs/indonesia-au-market-comparison.json`.

Location may influence rankings, but this comparison does not establish it as the cause of the mismatch, and Australian market parameters did not fix it. No default was changed to a configuration that returned no results. Market parameters do not change network egress; repeating the same container/query from an Australian public IP would be a separate useful control.
