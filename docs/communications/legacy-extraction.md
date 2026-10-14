# Legacy channel extraction and Acquire retirement

User decision D19 supersedes retaining executable direct connections in Acquire. Work is isolated in `project-acquire-unipile-replies`, branch `codex/unipile-reply-detection`. The independent repository is now published privately at [GitHub](https://github.com/callumholt/legacy-channel-services), at verified commit `08aa426`. Its local Git repository is `/Users/callum/Documents/Development/legacy-channel-services`. It has its own dependencies, build scripts, service configuration, tests and runbook; it is not an Acquire worktree. GitHub publication was explicitly requested after local extraction. No deployment or DigitalOcean decommission occurred.

## Preserved service boundary

- `services/linkedin`: original Python/Chromium operations, encrypted file state, journals, leases and policy. Twenty-three characterized files retain exact original bytes. Local HTTP composition expects a trusted caller to authorize the supplied tenant/principal; it does not implement consumer membership or physical-account consolidation.
- `services/whatsapp`: pinned Baileys runtime, sessions, encrypted delivery/reply journals, history, routing and scoped REST client. Acquire membership dependencies are replaced by a required injected authorization port and standalone server-owned grants. Grant checks fence session acquisition, handle transactions and renewal. An uncertain provider submission remains unknown/submitting; revocation never authorizes resending it.
- `packages/gmail`: direct Gmail mailbox/draft/read operations, token codec, Google OAuth/PKCE transport primitives and preserved diagnostic/health helpers. Explicit constructors accept configuration and injected transport. A consuming project still must implement authenticated OAuth nonce consumption, current-owner binding and durable token storage/authorization. This is a reusable library, not a complete standalone OAuth application.
- `packages/legacy-adapters`: neutral contracts, original Gmail/legacy adapters and dispatch/digest source, with eleven source files preserved byte-for-byte. These adapters no longer ship in Acquire's communications package.
- `examples/react`: optional connection components, with consumer BFF/CSS requirements documented. Interactive integration is not claimed.
- `provenance`: original Acquire glue/operations and changed original files archived as nonruntime `.txt` references. `docs/acquire-deletion-preservation.json` identifies byte-exact copies for all92 original deleted files. Archives are not executable standalone services. No credentials, sessions, private logs or database snapshots were transferred.

## Acquire changes

Direct Gmail, WhatsApp and LinkedIn runtimes, adapter implementations, provider UI and operational launchers are removed on this branch. Compatibility connection routes return authenticated retirement responses; legacy configuration cannot reenable them. Settings show three Unipile channel cards with setup unavailable until runtime integration exists. Google account sign-in remains available and retains its existing configuration variable names.

All actual delivery registry providers are paused. No historical campaign, enrolment, attempt, connection ID or receipt is silently rebound. Historical database columns and ownership records are retained; code extraction does not delete application data or resolve unknown sends.

Draft approval is now an application database state change with no Gmail/provider request. Approval and edits compare the exact saved state and PostgreSQL microsecond revision before writing; stale concurrent work returns409. Dispatched/terminal drafts are read-only. Independent review added regression cases for edit-versus-approval and terminal-state rewriting. Post-approval enrolment/audit work remains separate from the row CAS; this is not a complete atomic send-admission transaction. Regeneration captures pre-generation revisions, uses per-row guards and an insert-only collision path, and commits all rewrites plus audit in one transaction; a conflict rolls back all rewrites. The46 focused controller/SSR tests include14 reproduced failures. These are scripted transaction fixtures, not actual PostgreSQL draft-concurrency proof. A transaction-capable configured driver is required; unsupported Neon HTTP fails safely with503. Complete historical reuse remains read-only.

## Evidence and remaining gates

Characterization tests ran before and after extraction; new authorization/retirement/concurrency defects used genuine failing assertions before fixes. Private evidence stays ignored.

| Boundary | Evidence | Limit |
| --- | --- | --- |
| Independent Gmail + portable adapters | Fresh Linux installation/build/exports in OrbStack;56 Gmail +167 adapter tests, no application or credential mounts; test phase network disabled | No live mailbox/OAuth consumer |
| Independent WhatsApp |87 pure tests pass on host and fresh OrbStack Linux; four real restricted-role database tests pass on approved5447. Peer grant/role checks pass | Approved5447 now initialized/migrated; four actual restricted-role DB cases pass; no pairing/sending |
| Independent LinkedIn |193 Python cases and six real-Chromium fictional smoke checks before/after and in independently built OrbStack image | No live login/account state; optional model-agent workflow excluded |
| Acquire PostgreSQL prerequisites |183 cases/13 files, zero skips on existing approved5445; recorded source hashes match | Synthetic identity/provider ports, bounded journal; dispatch remains disabled |
| Service-only communications PostgreSQL | Approved5446 real storage, independent copied modules, all three channels' encrypted journal/capture/event/outbox replay and commit-before-ACK | Application receipt is synthetic memory; no real Acquire policy transaction or fresh coverage claim |
| Acquire regressions/build | Current full suite/types/lint/build results are in [verification](verification.md) | Opt-in skips are not passes; Webpack build used because shared dependency symlink prevents Turbopack in this worktree |

The specifically approved5446 initialization and exact001/002 migrations completed once, with a fresh validated private backup, exact target/system-ID/hash checks and catalog/RLS postchecks. A proof rerun restarted only that existing verified cluster; no schema operation occurred.

The separate WhatsApp fixture `127.0.0.1:5447/legacy_channels` was subsequently **specifically approved, initialized and migrated**. All four real restricted-role tests pass. Exact approved artifacts:

| Artifact in independent repository | SHA-256 |
| --- | --- |
| `services/whatsapp/ops/compose.storage.local.yml` | `d49c82279fddde5badef7df92af6623963bec3c068dfa2dd877c84b719748f74` |
| `services/whatsapp/ops/001-whatsapp-storage.local.sql` | `3a094a66e80483d96c9744a3dcfc17d1c661a08f1e3f81889998a3fd9227b5e5` |

Initialization/migration followed exact target/hash/image/empty namespace checks and a fresh validated private backup. System identifier `7696273365081522210`. The subsequent explicit5447 approval covered this target and these unchanged bytes; prior5446 approval did not. See the [independent storage verification](../../../legacy-channel-services/docs/whatsapp/storage-verification.md). Its service role is intentionally trusted across tenants; API authorization owns scope. SQL prevents deletion/cascading loss but does not provide semantic immutable-column or terminal-state triggers. Do not describe it as a fully untrusted database security boundary.

The Unipile build remains unfinished: authoritative account ownership/alias binding, lifecycle/hosted setup composition, complete history/coverage/checkpoints, email send integration, application/service admission and quotas, uncertain-send reconciliation, authenticated UI/runtime wiring and live capability checks are still required. No sending or setup is enabled merely by providing the key. See [progress](progress.md) and [send admission design](send-admission-design.md) for the next authorized code slice and specific schema approval gates.
