# Firmable implementation plan

Reviewed against Firmable's published API documentation on 26 Aug 2026:

- [API overview](https://docs.firmable.com/api-reference/overview)
- [Authentication](https://docs.firmable.com/api-reference/authentication)
- [Rate limits](https://docs.firmable.com/api-reference/rate-limits)
- [Company enrichment](https://docs.firmable.com/api-reference/endpoint/company-get)
- [People search](https://docs.firmable.com/api-reference/endpoint/people-search)
- [People enrichment](https://docs.firmable.com/api-reference/endpoint/people-get)
- [OpenAPI specification](https://docs.firmable.com/api-reference/openapi.json)

## 1. What the documented API can actually do

Firmable exposes three endpoints, authenticated with `Authorization: Bearer <key>` against
`https://api.firmable.com`. The published limit is 50 requests per second per API key.

| Endpoint | Role in Acquired | Important constraint |
|---|---|---|
| `GET /company` | Company enrichment | Requires a known Firmable ID, LinkedIn identifier, FQDN, ABN, or website |
| `POST /people/search` | Find likely decision makers inside an enriched company | `companyId` is required; this is not company discovery |
| `GET /people` | Enrich one known person | Returns real names, work/personal email, phone, LinkedIn, role history, location and DND data |

The consequence is now settled: **Firmable is not the documented mandate-to-company discovery
source.** A register, supplied list, Apollo, or a future commercial Firmable endpoint must produce
known companies first. Firmable then enriches those companies and discovers contacts inside them.

`People Search` is useful, but it does not change that conclusion. It is scoped to a required
Firmable company ID and supports position, seniority, department, offset and page size.

## 2. Correct the adapter boundary

The existing `TargetSource` interface still combines two vendor capabilities that are not the same.
Split it before adding live code:

```ts
interface CompanyDiscoverySource {
  search(mandate: Mandate): Promise<TargetCandidate[]>;
  capabilities(): DiscoveryCapabilities;
}

interface CompanyEnrichmentProvider {
  enrichCompany(identifier: CompanyIdentifier): Promise<CompanyEnrichment>;
}

interface ContactProvider {
  searchPeople(companyId: string, filters: ContactSearchFilters): Promise<PersonCandidate[]>;
  enrichPerson(identifier: PersonIdentifier): Promise<PersonEnrichment>;
}
```

Implementations for the first live pass:

- `SeedDiscoverySource` and later `RegisterDiscoverySource`
- `FirmableCompanyEnrichmentProvider`
- `FirmableContactProvider`
- Apollo remains a separate discovery/contact implementation rather than leaking Apollo response
  fields into the domain contracts

This makes capabilities truthful: Firmable has `companyDiscovery: false`,
`companyEnrichment: true`, `contactSearch: true`, and `contactEnrichment: true`.

## 3. Live pipeline

```text
mandate
  → register/seed/Apollo company candidates
  → normalise ABN, domain and LinkedIn identifiers
  → GET /company?country=AU&abn=... (or fqdn/id)
  → map only allow-listed company fields into provenance-bearing domain values
  → score company fit
  → POST /people/search for owner/founder/director/general-management candidates
  → rank candidate summaries without revealing contact details
  → GET /people?id=... only at the approved personal-data boundary
  → fictionalise or persist according to environment policy
  → derive succession Signals, then score ripeness
```

Identifier priority for company enrichment:

1. Firmable ID
2. ABN
3. FQDN
4. LinkedIn slug or URL
5. Website URL

Send one primary identifier per request so matching behaviour is auditable. Always send
`country=AU`, even though AU is the documented default.

## 4. Domain mapping rules

Every mapped value receives provenance containing the endpoint, lookup identifier type,
`capturedAt`, source label `Firmable`, and a confidence derived from match quality—not from the
mere presence of a response.

| Firmable field | Acquired field | Rule |
|---|---|---|
| `id` | `identifiers.firmableId` | Required after a successful company match |
| `industry_codes.abn` | `identifiers.abn` | Normalise to 11 digits; compare to requested ABN |
| `fqdn`, `website` | `domain`, website evidence | Canonicalise hostname and strip tracking/query data |
| `industries`, `industry_codes.anzsic` | sector evidence | Keep vendor label and ANZSIC separately; do not silently map one into the other |
| `employee_count` | headcount | Firmable documents this as region-specific for the requested country |
| `revenue` | revenue band evidence | It is a string such as `>$1B+`, not an exact number; never parse it into a false point estimate |
| `year_founded` | established year | Store as a sourced value, not proof of owner tenure |
| `states`, `locations`, `hq_location` | geographic evidence | Do not assume the first state is the headquarters state |
| `company_type`, `abn_operation_status` | eligibility signals | An inactive ABN becomes a hard exclusion candidate |
| `org_registers`, `keywords`, `nextGen` | raw evidence candidates | Map selectively; do not persist the entire vendor response |

The current `revenue: DerivedValue<number>` type must become a value that can represent an exact
amount, a range, or a vendor band. Scoring should only use an exact/range value when its bounds are
known. A display string must not enter arithmetic.

## 5. Contact search and personal-data boundary

For succession-oriented searches, begin with these documented IDs:

- Seniority `2`: Owner / Founder
- Seniority `1`: Board Member / Company Director
- Seniority `3`: C-Suite / Partner
- Department `1`: General Management
- Department `4`: Operations

Run narrow queries in that order and deduplicate by `person_id`. Use `from`/`size` as stringified
offset and page size because that is how the published schema defines them. The response has no
documented total or next cursor, so stop when a page contains fewer results than requested and
enforce an application maximum.

`POST /people/search` returns candidate metadata and availability flags without exposing the
actual email or phone. Use that cheaper and safer shape for selection. Only call `GET /people`
after a candidate is selected and the environment is allowed to handle real personal data.

Development and test policy:

- Never write a raw people response to logs, fixtures, traces, errors, audit payloads, or the DB.
- Transform in memory immediately at the adapter boundary.
- Replace name, email, phone and social profile fields with stable fictional values.
- Preserve non-identifying role, seniority and tenure evidence only when it cannot re-identify the
  person in the development dataset.
- Treat `phones[].is_dnd` as a compliance stop, not as an informational field.

Production remains disabled until the real-person handling decision and security controls are
approved.

## 6. HTTP client behaviour

Create one server-only `FirmableClient` with:

- base URL from `FIRMABLE_BASE_URL`, defaulting to `https://api.firmable.com`
- key from `FIRMABLE_API_KEY`; never expose it through a `NEXT_PUBLIC_` variable
- a 10-second request timeout
- a conservative application limiter below the published 50 requests/second limit
- bounded concurrency for batch enrichment
- retries for `429` and transient `5xx` responses only, with exponential backoff and jitter
- no retries for `400`, authentication errors, or schema-validation failures
- structured errors that contain endpoint, status and a redacted identifier, never headers or body
  fields containing personal data

The docs only explicitly describe `200` and `400` endpoint responses. Treat all other status
handling as defensive implementation, and capture real behaviour in integration tests without
assuming undocumented semantics.

## 7. Validation, storage and audit

Use Zod schemas at the vendor boundary. Parse an allow-listed subset and tolerate unknown response
keys so an additive Firmable change does not break ingestion. A missing or mistyped required field
must fail closed and create an operational event.

Persist mapped domain data, not raw responses. Audit metadata should include:

- provider and endpoint
- target/contact ID
- identifier type with the value hashed or redacted
- response status and duration
- mapped field names
- captured timestamp
- whether personal fields were fictionalised or discarded

Do not persist the API key, request headers, raw response body, personal email, or phone inside an
`AuditEvent`.

Before storing live results, confirm Firmable contract terms for credit consumption, retention,
permitted outreach use, and caching. None of those commercial rules are specified in the public
API reference.

## 8. Implementation sequence

1. Split the adapter contracts and update the seed implementation.
2. Add `FirmableClient`, request schemas, response schemas and typed error mapping.
3. Implement company enrichment and the domain mapper with synthetic contract fixtures.
4. Change the revenue domain type so vendor bands cannot masquerade as exact numbers.
5. Add an adapter contract-test suite shared by seed and Firmable implementations.
6. Add contact search with bounded pagination and candidate deduplication.
7. Add the personal-data transformer and prove with tests that raw PII cannot escape it.
8. Add a manual integration test command requiring `FIRMABLE_API_KEY`; never run it in the normal
   unit-test suite or CI without an explicit opt-in.
9. Wire one server action to enrich a selected synthetic/register target and display source,
   captured time and missing fields in the target drawer.
10. Add persistence and audit events only after the database migration for those fields is
    explicitly reviewed and approved. Do not generate or apply that migration by implication.

## 9. Acceptance tests

- Company lookup supports Firmable ID, ABN, FQDN, LinkedIn and website identifiers.
- AU is always passed explicitly.
- Missing revenue/headcount remains missing.
- A revenue band never becomes a fabricated number.
- Every mapped field has source and capture time.
- Raw vendor payloads and authorization headers never reach logs or audit rows.
- People search cannot run without a Firmable company ID.
- Pagination terminates on a short page and at the configured maximum.
- Duplicated people are collapsed by Firmable person ID.
- Development/test output contains no real name, email, phone or social URL.
- DND phone data produces a stop signal.
- `429` and transient `5xx` retry within bounds; `400` does not retry.
- Firmable being unavailable leaves the existing target intact and visibly marks enrichment as
  failed/stale rather than replacing known data with nulls.

## 10. Open commercial questions

- Does this account have an undocumented company/audience search product beyond the public API?
- Which calls consume credits: search, enrichment, or field reveal?
- What storage and retention terms apply to company and people data?
- Does the contract permit using retrieved contact data for the intended outreach workflow?
- Are bulk endpoints or higher-throughput jobs available for the account?

Until those are answered, register/seed discovery plus Firmable enrichment remains the safe
critical path.
