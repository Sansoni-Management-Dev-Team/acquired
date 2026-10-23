# Hosted demo communications: application integration handoff

Core hosted source was deployed as `42f268c` behind disabled configuration; production Run demo is not activated or end-to-end verified. The service origin is `https://acquire-simulator.mlai.au`; the application origin is `https://acquire.mlai.au`. A read-only inspection inside the actual production app established its PostgreSQL17 Supabase database. Native agent/company identity tables are absent there; hosted demo flags are unset. Follow-up callback-origin, provisioning-status and persistent-worker repairs are recorded in the progress log. The [production database review](../../ops/agent-mode/production-proposals/README.md) names exact unapplied proposals, a separate isolated rehearsal and remaining approval gates.

The native agent retains its existing source revision checks, human reviews, original account bindings, quotas, history barriers and final admission. Its provider-free hosted facade uses the normal communications SDK and authenticated service APIs. Acquire alone accesses its application database. The simulator receives scoped recipient projections on demand, not a database credential or a lead/profile export. Its simulated addresses stay reserved identities; no real email, WhatsApp or LinkedIn delivery is introduced by this path.

## Application configuration

Keep `AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED` disabled until the release prerequisites and actual acceptance below pass. Private server configuration uses:

| Variable | Meaning |
| --- | --- |
| `NODE_ENV=production`, `APP_URL` | Actual canonical application HTTPS origin |
| `COMMUNICATIONS_RUNTIME_ENABLED=true` | Existing communications application boundary |
| `AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED=true` | Explicit hosted capability; no implicit local override |
| `AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON` | Strict version1 descriptor: mode hosted-demo, provisioning/active phase, owned run, actor, origins, integration/configuration, capabilities and exact original binding vectors |
| `AGENT_HOSTED_DEMO_APP_AUTH_KEY` | Private independent incoming application-authority credential |
| `AGENT_HOSTED_DEMO_SERVICE_AUTH_KEY` | Private normal scoped communications signing key; distinct from incoming key and app codec keys |
| `AGENT_HOSTED_DEMO_SUBSCRIBER_ID` | Same durable subscriber on both services; default `acquire-hosted-demo-replies` |
| `ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION`, `ACQUIRE_COMMUNICATIONS_KEYRING_JSON` | Existing durable application codec; retain old versions for original evidence |
| `AGENT_DEMO_CONTACTS_ENABLED=true`, `AGENT_DEMO_COMMUNICATIONS_ENABLED=true`, `AGENT_DEMO_TARGET=hosted` | Select normal Run Demo mapping preparation through the scoped participants API |

The descriptor has no provider admin key, provider database URL or localSimulatorOrigin. The original primary communications environment remains separate. Unknown/changed hosted generations fail closed. Generic local/shared-service runtime callers refuse hosted bindings rather than route them to primary; native history, admission and submission projection use the explicit hosted ports. This release scope does not claim hosted campaign or legacy draft execution support.

A single persistent Node/Next process must own live held admission handles. Restart rolls those transactions back and unknown handles fail closed. Multiple replicas, serverless requests or a load balancer that moves a live session between processes are unsupported without a separate ownership design. Do not automatically retry uncertain sends or reopen a lost handle. Descriptor/key changes require a controlled process restart; the runtime refuses silent hot replacement.

## Authenticated application APIs

All are POST JSON. The independently configured application credential uses `Authorization: Bearer …`, `X-Acquire-Demo-Run` and `X-Acquire-Demo-Audience: acquire-hosted-demo-v1`. Scope comes from the private descriptor; request bodies cannot choose another actor. Responses are bounded and no-store; failures never return raw provider/SQL errors.

| Application path | Boundary |
| --- | --- |
| `/api/agent/hosted-demo/access` | Restricted read-only current membership probe; active phase also requires the exact enabled registered run through the installed read-only schema guard. No organization writer gate, so service revalidation cannot deadlock a held application permit. |
| `/api/agent/hosted-demo/authority` | Strict prepared-coverage lookup and opaque short-lived held admission session open/commit/abort. The original application transaction stays live; no detached approval. |
| `/api/agent/hosted-demo/recipient` | Exact owned pre-send mapping lookup, normal effective-contact/source CAS and minimal whitelisted persona facts. Optional original operation correlation; no arbitrary body/name lookup. |
| `/api/agent/hosted-demo/coverage` | Existing application coverage projector. The service retains its real coverage transaction until application commit; full original wire digest revalidation is mandatory. |
| `/api/agent/hosted-demo/events` | Existing application reply consumer and exact durable receipt/ACK. The service retains the actual outbox lease; full original event wire digest revalidation is mandatory. |

Behind the deployed HTTPS proxy, Next's request URL may name the internal listener. The runtime explicitly pins the existing production listen metadata and accepts that internal origin only with the independently configured public Host and HTTPS proxy protocol. Request and forwarded headers never choose the trusted public origin. All private credentials, run, audience and current membership checks still apply. Unknown public/listener origins refuse before data access.

Provisioning phase permits only the membership `/access` probe. Authority, recipient, coverage and event callbacks are refused until active. Ordinary signed SDK account setup/list/status are available through the separately configured service. Provisioning cannot send.

## Setup and registration order

1. Revalidate the deployed application SHA, environment and actual database/ledger immediately before release. The read-only inspection above confirmed `communication_bindings` exists and native agent/demo tables and helpers do not. Main branch presence or an unauthenticated HTTP401 is not route/schema evidence.
2. Review and separately approve any native-agent application/schema release required by that inventory. Do not apply local-only migration files wholesale to production. They contain explicit local target guards and clocks.
3. Release the reviewed app APIs and service source behind explicit provisioning configuration, with independent credentials and real HTTPS. Keep native/send authority disabled until registration is reviewed.
4. Use `prepareDemoAccountConnection` for one normal explicit setup per channel. Complete owned hosted authorization normally. Record the resulting original bindings through the existing application binding path; do not fabricate account identifiers, generation metadata or current status.
5. Capture the exact three binding vectors in the private provisioning descriptor. `verifyHostedDemoAccountRegistration` verifies normal SDK statuses, `/v1/hosted-demo/accounts/attest`, owned immutable application records/digests, actual provider/source identities and bounded observation time. It returns registry input plus the authenticated attestation; it writes nothing and grants no send.
6. Independently review target metadata and exact predecessor hashes, then obtain approval for the final registration SQL artifact. `ops/agent-mode/proposals/hosted-demo-registration.proposed.sql` is an **unapplied proposal**, pinned to reviewed local bodies. It rejects missing/different production bodies. Its target selector is not approval. The owner-only registry retains original attestation/senders; the owner can disable a run but cannot mutate/re-enable/delete its evidence. The active membership probe additionally requires its installed read-only registration guard; an absent schema or disabled owner registration refuses service access. The proposal adds only an exact mapped hosted-demo route sending-hours exception. It does not enable acceleration, mark hosted bindings local, change the 24-hour cold cadence or remove any other authority guard.
7. Privileged reviewed registration records the exact attestation and sender vector, then the normal `agent_demo_runs` row. Switch both services to the exact active descriptor through controlled restart. There is no browser-supplied registration or automatic approval.
8. Run normal Run Demo research/mapping preparation. Only minimal source IDs/revisions/fingerprints cross the participants endpoint; returned reserved recipients retain existing ordered manifest/digest validation. Use ordinary native budget configuration, target reviews and exact message reviews. Starting a session or preparing aliases never approves a message.

## Evidence and remaining acceptance

Source-only application validation currently covers held handle ownership/expiry/replay, exact actor/binding routing, private hosted setup capability, minimal recipient projection, proof callback/revalidation composition, Run Demo transport/receipt validation, read-only membership probes and the fallback-compatible scoped window probe. Focused app and adjacent shared validation:162tests/23files pass, fresh nonincremental TypeScript and scoped ESLint pass. Shared authority/proof protocols also have separately recorded peer tests. SQL proposal tests are static guard/inverse-source checks, not a PostgreSQL execution proof.

Source ordering explicitly closes `withCampaignDb` binding/member/identity transactions before `/history/read` or `/coverage/project`. The callbacks subsequently acquire the normal application projector/consumer transaction. Native submission lookup precedes its append transaction. This avoids an obvious callback writer-gate cycle in source; unit mocks do not establish actual cross-process PostgreSQL lock behavior.

Provisioning status checks use only the explicit hosted setup client and exact privately captured application bindings. Operational routing remains inactive until registration. This allows fresh account verification before the run exists, without granting send/readiness/lookup authority. Production background work uses the existing adaptive loopback tick driver, disabled until its separate registered runtime configuration is installed; it does not depend on a browser tab.

Before activation, verify actual HTTPS setup, three exact account attestations, owner registration, fresh coverage projection, real held admission commit/abort, a human-reviewed simulated native send, persona reply after the configured minimum delay, durable original outbox/ACK/history consumption, and original receipt recovery after restart. Include revoked membership, foreign scope, stale generation, changed proof/expired handle and unknown-send negative cases. No actual hosted startup/setup/send/reply, production migration or deployment is claimed by this application source handoff.
