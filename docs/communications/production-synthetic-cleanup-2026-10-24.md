# Production synthetic provider test cleanup — 24 October 2026

The three-channel simulator provider tests completed with genuine model replies. This follow-up verifies that synthetic test events do not leave the normal Acquire channel review UI blocked. It does not claim a full automated acquisition/outreach journey.

At 14:22 UTC, the exact standalone WhatsApp lead428 and LinkedIn lead445 test replies were resolved through the normal authenticated `/api/channels/reviews` endpoint using current fingerprints, timestamps and request IDs. The existing source inventory showed no application conversation route or dispatch intent for those channel/person pairs. Both had `identity_pending` and `canReviewUnrelated=true`; no other review was changed. Both resolutions returned HTTP 200. The normal LinkedIn cleanup queued five existing history refreshes; no send, resume or approval was requested. A subsequent normal GET returned HTTP 200 with an empty review list.

At 14:23:13 UTC, a bounded read-only check of the hosted communications database confirmed the original EMAIL lead428 `mail_sent` capture, received at 14:16:23 UTC, had reached `processed` / `ignored_outgoing_message`, with no remaining lease. It was 410 seconds old. This is the normal five-minute-grace canonical external-outbound recovery, not a forced acknowledgement or database repair. It demonstrates that an unrelated unresolved send on another recipient does not prevent this verified external callback from completing.

The exact provider replies were WhatsApp `sim-message-840f7c77-1689-4d0a-ad74-6b239187ef2b` at 13:35:44.065 UTC and LinkedIn `sim-message-839d6603-3833-4acc-8004-3eb00d8ff11f` at 13:36:48.382 UTC. Existing unresolved sends were preserved. No migration, direct SQL write, new provider send or policy/timer change was performed during cleanup. The temporary operator SSH rule used for the read-only callback check was removed and verified in the helper's finalizer.

Private evidence remains outside Git:

- Acquire `.local-data/production-channel-canary/resolve-raw-whatsapp.private.json`
- Acquire `.local-data/production-channel-canary/resolve-raw-linkedin.private.json`
- Acquire `.local-data/production-channel-canary/reviews-cleanup-read.private.json`
- Simulator `.local-data/idempotency-release/final-email-callback.private.json`

These records prove normal review cleanup and hosted callback recovery. They do not imply that unrelated historical unknown outcomes have been resolved.

Core persona acceptance is recorded separately in the simulator repository's `docs/local-provider-roundtrip.md`, `docs/provider-roundtrip-release-20261024.md`, and `docs/provider-idempotency-persona-separation.md`. The local raw email/WhatsApp/LinkedIn replies took 5.602 / 5.364 / 5.172 seconds; all used completed model decisions and preserved their original provider threads. The subsequent local-first idempotency regression on `f91ac78` verified an email reply in 5.509 seconds and exact-key replay without another message/model call. On hosted `f91ac78`, the retained WhatsApp/LinkedIn pairs and the recovered same-key email pair were independently reverified: six messages and three completed model decisions; the final email reply took 18.513 seconds. This is the requested minimal provider/persona contract, separate from full agent orchestration. Acquire app and primary communications revision `3dd1979` and simulator `f91ac78` were reported healthy by their deployment owners; this cleanup did not change either runtime.
