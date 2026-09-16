# Crawl4AI reader evaluation — 16 September 2026

## Result

Both readers returned usable content for 23 of 30 URLs. The pooled reader completed in 129.8 seconds versus 138.2 seconds for the original reader. Median request latency was essentially unchanged: 7.764 versus 7.732 seconds. This does not establish an access-rate or meaningful latency improvement from pooling. Browser reuse and isolated-context cleanup were separately confirmed with a live integration check.

## Method and limitations

- Same fixed 30-domain sample from research sources, run sequentially at concurrency two on the local machine using Crawl4AI 0.8.9. Manifest: `scripts/reader-benchmark-urls.json`.
- Pooled reader: separate Docker container capped at 2 CPUs and 4 GiB RAM; original reader: existing local container with no matching resource cap. Both Linux/amd64 images run through OrbStack. Timings are directional, not a controlled capacity comparison.
- Sample includes company sites, directories, a PDF, a malformed discovered URL and an unavailable domain. This represents encountered sources, not 30 verified company homepages.
- Usable means at least 32 characters and no known challenge markers in the opening text. It is not qualification evidence or a guarantee of complete page content.
- Both implementations read commercialcleaning.au and wanless.com.au. Earlier production failures were verification and HTTP 429 respectively; they were not repeated as a simultaneous Cloudflare control.
- The local network, egress IP and current site state may explain differences from production. A benchmark from the selected host is required before activation or changing the primary reader.
- No searches, AI calls, database writes or migrations. Two 30-request benchmarks; additionally two example.com reads confirmed browser reuse and context cleanup. Actual hosting cost was not measured.

## Per-URL results

| URL | Original | Pooled | Original ms | Pooled ms |
|---|---|---|---:|---:|
| https://commercialcleaning.au/ | usable | usable | 6297 | 22322 |
| https://wanless.com.au/ | usable | usable | 7576 | 24430 |
| https://ancr.com.au/wp-content/uploads/project_gallery/lxrp_bell_to_moreland.pdf | failed (reader_error) | failed (page_unavailable) | 6443 | 9078 |
| https://www.linkedin.com/company/csa-specialised-services | failed (reader_error) | failed (origin_http_error) | 2302 | 476 |
| https://csaspecialised.com.au/contact-us/%TRACK_LINK% | failed (reader_error) | failed (origin_http_error) | 4823 | 3206 |
| https://wiza.co/d/csa-specialised-services/8fa5/scott-russell | failed (reader_error) | failed (page_unavailable) | 6608 | 5280 |
| https://www.cbinsights.com/company/csa-specialised-services/people | usable | usable | 8377 | 8492 |
| https://www.datanyze.com/companies/csa-specialised-services/357860151 | usable | usable | 6990 | 7305 |
| https://pitchbook.com/profiles/company/541626-04 | usable | usable | 7115 | 8626 |
| https://csaspecialisedqld.com.au/about-us/ | usable | usable | 7867 | 5878 |
| https://cleanaway.com.au/ | usable | usable | 21323 | 8311 |
| https://www.simplexwastesolutions.com.au/location/melbourne/ | usable | usable | 13102 | 7864 |
| https://www.comcleanaustralia.com.au/category/specialist-cleaning/ | usable | usable | 7654 | 5281 |
| https://pjwastesolutions.com.au/industrial-waste-management-melbourne/ | usable | usable | 9069 | 6791 |
| https://mertonenv.com.au/services/ | usable | usable | 6888 | 5435 |
| https://www.epa.vic.gov.au/managing-industrial-waste | usable | usable | 7273 | 5818 |
| https://onixgroup.com.au/ | usable | usable | 8885 | 10809 |
| https://federationcouncil.nsw.gov.au/ | usable | usable | 21998 | 7834 |
| https://urlebird.com/user/kclean.com.au/ | usable | usable | 14929 | 14459 |
| https://builtwith.com/kclean.com.au | unusable | unusable | 9223 | 5868 |
| https://brycocivilconstruction.com/ | usable | usable | 9583 | 8986 |
| https://bettergrow.com.au/ | usable | usable | 8012 | 5400 |
| https://cleaningedge.com.au/ | usable | usable | 13893 | 18009 |
| https://cleanworks.com.au/ | usable | usable | 7054 | 8812 |
| https://platinumindustrial.au/ | usable | usable | 13021 | 8618 |
| https://cleancorp.com/ | usable | usable | 12452 | 7693 |
| https://capitalcitywaste.services/ | usable | usable | 7419 | 5017 |
| https://mwrrg.vic.gov.au/ | failed (reader_error) | failed (reader_error) | 4 | 640 |
| https://centralwestwaste.com.au/ | usable | usable | 7056 | 11811 |
| https://envirofs.com.au/ | failed (reader_error) | failed (origin_http_error) | 7810 | 6112 |

## Deployment decision

Retain Cloudflare Workflows and primary reads. Prepare Crawl4AI as an authenticated secondary reader on a Docker VM. Warm browser processes are shared but request cookies and storage are not. Persistent human profiles and CAPTCHA handoff are a separate future capability.

The user selected Cloudflare Containers and explicitly approved `crawl-reader-v1`. Deployment and hosted validation are now complete; the service is enabled as the production fallback. Actual billing and a full end-to-end research run remain unverified.

## Hosted Cloudflare benchmark and activation

On 16 September 2026 the same sample returned **22/30 usable pages**, in **59.2 seconds**,
with a **3.403-second median**. Both commercialcleaning.au and wanless.com.au returned
usable company content. Datanyze was the one additional failure relative to local
Crawl4AI. These sequential samples do not establish a universal speed or coverage advantage.

Deployment: MLAI account, one standard-3 instance, three browser slots, one-minute
idle sleep. Endpoint: `https://acquire-crawl4ai.mlai-530.workers.dev`. Authenticated
health returned 200, unauthenticated crawl returned 401, and a private-address URL
returned 400. The service token is held in Cloudflare secrets, not source control.

`acquire-research` was updated in its original account to version
`704966cd-965e-43cd-bb75-76057114fe91` with the cross-account fallback settings.
No workflows were running at deployment time. Primary reading remains unchanged.

A separate Neon data-transfer quota error (HTTP 402) prevented querying active
jobs through the database. Running workflows were instead checked through
Cloudflare (none). Full research-run validation requires restoring Neon access;
the page benchmark did not use the database.

| URL | Hosted result | Latency ms |
|---|---|---:|
| https://commercialcleaning.au/ | usable | 10436 |
| https://wanless.com.au/ | usable | 10261 |
| https://ancr.com.au/wp-content/uploads/project_gallery/lxrp_bell_to_moreland.pdf | failed | 4463 |
| https://www.linkedin.com/company/csa-specialised-services | failed | 335 |
| https://csaspecialised.com.au/contact-us/%TRACK_LINK% | failed | 1797 |
| https://wiza.co/d/csa-specialised-services/8fa5/scott-russell | failed | 2079 |
| https://www.cbinsights.com/company/csa-specialised-services/people | usable | 3308 |
| https://www.datanyze.com/companies/csa-specialised-services/357860151 | failed | 2313 |
| https://pitchbook.com/profiles/company/541626-04 | usable | 4879 |
| https://csaspecialisedqld.com.au/about-us/ | usable | 2842 |
| https://cleanaway.com.au/ | usable | 3560 |
| https://www.simplexwastesolutions.com.au/location/melbourne/ | usable | 2240 |
| https://www.comcleanaustralia.com.au/category/specialist-cleaning/ | usable | 2606 |
| https://pjwastesolutions.com.au/industrial-waste-management-melbourne/ | usable | 4581 |
| https://mertonenv.com.au/services/ | usable | 2416 |
| https://www.epa.vic.gov.au/managing-industrial-waste | usable | 2916 |
| https://onixgroup.com.au/ | usable | 7595 |
| https://federationcouncil.nsw.gov.au/ | usable | 3435 |
| https://urlebird.com/user/kclean.com.au/ | usable | 4554 |
| https://builtwith.com/kclean.com.au | unusable | 4020 |
| https://brycocivilconstruction.com/ | usable | 4264 |
| https://bettergrow.com.au/ | usable | 2249 |
| https://cleaningedge.com.au/ | usable | 9674 |
| https://cleanworks.com.au/ | usable | 2095 |
| https://platinumindustrial.au/ | usable | 4615 |
| https://cleancorp.com/ | usable | 5009 |
| https://capitalcitywaste.services/ | usable | 2814 |
| https://mwrrg.vic.gov.au/ | failed | 194 |
| https://centralwestwaste.com.au/ | usable | 3433 |
| https://envirofs.com.au/ | failed | 3372 |
