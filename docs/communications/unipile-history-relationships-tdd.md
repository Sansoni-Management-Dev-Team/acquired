# Unipile history, reply coverage and LinkedIn relationships

P3.3/P3.5 implementation handoff; acceptance A06/A09/A14/A18. This record covers the independent communications service source. It does not certify live accounts, provider writes, enabled campaign dispatch or unapplied PostgreSQL behavior.

## Concrete runtime

`createConfiguredUnipileV1History` combines the configured account runtime, authenticated owner reader, original-source v1 HTTP reads, peer profile/retained alias verification, full reply enrichment, outbound evidence, checkpoint storage and worker. Its API is `{repository, source, refresh(query), normalizeWebhook(raw,binding), relationships}`. `refresh` accepts only the exact recorded connection generation, an explicit scope and starting time, `cursor:null` and `refresh:true`. Invitations require the host's durable held-admission callback; there is no raw mutation fallback.

Every bounded refresh reads the exact provider account and canonical owner before and after exhaustive pagination. GET requests are uncached; email requests include complete headers and omit folder filters. Exclusive provider timestamp filters are widened by one millisecond, then original records are bounded to the inclusive immutable scan interval. A cycle, truncated inventory, unresolved identity, hidden/deleted ambiguity, incomplete original-message evidence, initial-sync absence or ownership change prevents complete coverage. Failed scans restart their anchored window; partial pagination is not advertised as a resumable completed checkpoint.

The worker starts its interval with a PostgreSQL-clock ticket, invalidates previous readiness and records the tenant ingress revision before provider reads. Successful persistence commits encrypted normalized reply events and the subscriber outbox before the cursor/checkpoint. Semantic collisions preserve the original event and publish a separate encrypted review/outbox/latch. Pending service ingress, reviews and unconsumed outbox records remain a separate barrier: committing a complete source scan does not mean its replies have already stopped campaigns.

Social initial completion comes only from an authenticated original-generation `AccountStatus.SYNC_SUCCESS` receipt, its owned processing lease and encrypted source evidence. Google/Outlook use a **service query baseline**: an exhaustive exact-account/window query with original full-message evidence and stable canonical owner. This is supported synchronous query coverage, not an invented provider-global initial-sync notification. A future historical range is not silently included in an earlier baseline.

`repository.assertCoverage(client,{binding,scopeDigest,requiredSince,maxAgeSeconds,serviceRevision,recipient})` verifies retained encrypted source metadata and cursor timestamps within the caller's existing held service transaction. Five minutes is the maximum age; future timestamps, expired grants and changed generations fail closed. Matching-recipient outbound observations after `requiredSince` require authenticated original submitted-journal association. Unrelated personal outreach does not block the account. Reply completeness alone never proves absence of a manual outbound to the campaign recipient.

`repository.withCoverage(query,work)` holds service tenant/account authority before the application projection transaction. Its callback receives `{coverage,scopeDigest,serviceRevision,signal,revalidate}` and must await `revalidate()` immediately before a definite application commit. The concrete application projector must preserve that sequencing; this trusted callback is not a sandbox or a boolean proof of a database commit. Deadline/unknown service commit cannot authorize provider writes. Dedicated SQL sessions are physically retired through the driver's `release(error)` termination contract.

Scope HMAC and encryption versions are separate. `scopeKeyVersion` can retain an original scope digest during encryption rotation; original encryption/digest materials must remain available. A scope-key change requires explicit recapture and application binding reconciliation, rather than silently switching captured campaign coverage scope.

## Verified peer and relationship semantics

Authenticated numeric WhatsApp PN profiles corroborate the documented `phone@s.whatsapp.net` identity even when the profile has no optional `phone_number`. An opaque LID is never converted into a phone. LinkedIn verified public profile URLs/public identifiers use the established `https://www.linkedin.com/in/<slug>` form without a trailing slash; escaped slugs are preserved after strict host/path validation. Display names do not create identities.

LinkedIn relationship inspection uses an uncached account-scoped profile with notifications disabled and bounded sent-invitation pagination. Contradictory relationship/distance evidence becomes unknown. Sent invitations are a pending inventory; absence does not prove acceptance or rejection. Exact invitation receipt lookup returns only an authenticated original ID/recipient and a real nonfuture `parsed_datetime`. Nullable/missing dates and relative text do not become fabricated campaign timestamps.

Initial release supports the documented single-source classic LinkedIn and WhatsApp paths. Multiple social `Account.sources` fail closed because the account-wide messages endpoint does not scope each message to a product. Premium mixed-source coverage is not certified. Vendor pagination has no globally consistent snapshot/watermark guarantee: later-arriving records, deletion races, retention limits and inaccessible older history remain provider limitations. A bounded scan is exhaustive for the available exact account/query at the observed source times; it cannot recover unavailable history.

## Test-first evidence and final batch

Ignored private logs under `.local-data/communications/verification/` preserve genuine failures and subsequent passes for missing source/worker/repository/runtime behavior, incomplete folder evidence, semantic conflicts, malformed binding getters, key accessors, missing email query baseline, authenticated sync capture, archived owner-sent mail, wrong-channel recipients, mixed social sources and the documented minimal WhatsApp profile. The native loopback test executes the actual GET-only source/enricher transport and asserts uncached reads; it does not contact Unipile.

Owned inventory: **71 executable unit/native cases in 13 test files**, plus **11 prepared actual PostgreSQL cases** in `src/db/communications-history-local.integration.test.ts`. The earlier cases have distributed scoped RED/GREEN logs, not a single final frozen-source run. The latest canonical URL, retained scope-key, outbound-window and retire-before-abort-notification checks were added for the user's final combined-batch cadence; no prechange execution or final pass is claimed for them here. The root's final combined suite will supply the frozen-source result. Scripted SQL fixtures do not prove RLS, transactions, clocks, leases or PostgreSQL durability.

Existing `v1-events.ts`/`v1-reply-enrichment.ts` now accept only the trusted `historyAllFolders:true` context. Default webhooks retain their previous uncertain-folder review behavior; raw caller flags cannot enable this context. The existing normalizer/enricher and new folder cases passed together before the final batch.

## Prepared database stage

Only `ops/communications/standalone/007-history-checkpoints.local.sql` is introduced by this slice. SHA-256: `e2406e5e2455856db703360123b7a352e4a7152cfad22ea50aa58b7930390d3e`.

Exact intended target: existing approved OrbStack `127.0.0.1:5446/communications_fixture`, container `acquire-communications-standalone-postgres-1`, system identifier `7696118996713136162`. Requires original standalone001/002 and the separately pending003 retirement artifact. Adds FORCE-RLS history refresh/initial-sync tables, restricted ACLs, current-generation/grant/retirement checks and deferred precommit coverage/alias authorization guards. No Acquire/public relations, bootstrap, historical deletion or inferred backfill. Static parsing passed **35 statements and five PL/pgSQL units**; this is syntax evidence only.

**Unapproved and unapplied.** The user's build-first instruction defers migration execution until the complete code is reviewable and each exact artifact is approved. Do not alter or apply pending003/004/005/006 as part of this handoff. Existing complete-cursor synthetic fixtures on5446 must be updated to real007 checkpoint provenance once this schema is specifically approved; direct complete flags are intentionally insufficient.

After explicit approval, validate exact target/system/roles/hash and a fresh private backup, then apply only the unchanged approved artifact with `ON_ERROR_STOP`. Execute the prepared suite with both `COMMUNICATIONS_STANDALONE_AUDIT=1` and `COMMUNICATIONS_HISTORY_AUDIT=1`, using direct installed Vitest. Until then the prepared suite remains inert/skipped and reads no private database configuration. The 11 cases cover three channel atomic event/outbox/cursor commits, lease concurrency, ingress revision changes, grant revocation, outbox rollback, semantic review, sync receipt authenticity/product scope and explicit invalidation. No live sends, invitations, pairing, provider deletion or webhook registration are authorized by these tests.

## Primary protocol sources

- [v1 messages pagination/account/time filters](https://developer.unipile.com/reference/messagescontroller_listallmessages)
- [v1 full-header email queries](https://developer.unipile.com/reference/mailscontroller_listmails)
- [Account lifecycle and provider sync support](https://developer.unipile.com/docs/account-lifecycle)
- [Provider-backed user profiles](https://developer.unipile.com/reference/userscontroller_getprofilebyidentifier)
- [WhatsApp documented phone/JID profiles](https://developer.unipile.com/docs/users-overview)
- [Sent pending invitations](https://developer.unipile.com/reference/userscontroller_listalluserinvitationssent)
- [LinkedIn invitation request](https://developer.unipile.com/reference/userscontroller_adduserbyidentifier)
- [Message polling guidance](https://developer.unipile.com/docs/get-messages)

The retained public v1 OpenAPI snapshot supplies exact schemas; adjacent private credentials were not read. v2 history/LID documentation is used only to explain known limitations, never to invent v1 request or response fields.
