# Isolated agent owned-mailbox setup

## Storage provisioned locally; runtime and provider setup tracked separately

The user authorised preparing the owned-mailbox connection surface, with zero live sending. The standing migration exception in this worktree's AGENTS.md covers only `127.0.0.1:5437/acquire_agent_mode`, marker `acquire-agent-mode-local-only`. It does not cover another database, production deployment or a message send.

Initial read-only inspection found no `communications` schema, no service tables/functions and no `communications_control` or `communications_scoped` roles. The existing184 agent PostgreSQL acceptance cases exercised application persistence and synthetic transport boundaries; they did not provision a real communications-service database. The original isolated launcher also kept communications disabled and removed its service URL/provider configuration. Consequently the previous disabled connection screen was accurate.

## Applied migration0036

`ops/agent-mode/migrations/0036-agent-isolated-communications-storage.sql`

SHA256: `e048fa042abbfaa4f800424a4e5a62d02263a2c1928a21f18682740010f47e32`

The selected local runner applied this exact new forward artifact once under standing authority after exact database/marker verification and independent root review. It creates the complete service-only schema in the already approved isolated database, alongside the preserved application schema. It does not point at the separately owned standalone fixture, main worktree, shared or production databases.

- The reviewed service-only standalone001–008 post-guard bodies remain byte-for-byte intact, with only their outer transaction wrappers removed. `ops/agent-mode/service-schema-source-manifest.json` records original complete-file hashes and copied body hashes. A static provenance test independently extracts and compares all eight bodies.
- Their fixture-specific database/empty-public guards are replaced by exact local database/user/marker checks and absent namespace/role checks. The008 trigger-repair prerequisites are retained with the new local schema owner. The application tables are neither rewritten nor granted to service roles.
- All27 service tables use FORCE RLS. Both service roles remain restricted NOLOGIN/NOBYPASSRLS/nonsuperuser. Only local runtime login membership is added; every repository transaction still explicitly switches to its restricted role. Read-only postchecks found zero PUBLIC function EXECUTE grants and no DELETE grants to either restricted service role.
- No provider account, credential, owner grant, default account, quota capacity, application binding, operation or history is seeded. The service's signed-auth host verifies current application membership and creates/renews an original application/tenant/owner grant for at most60seconds. There is no long-lived wildcard or manually seeded owner grant.

A fresh custom-format PostgreSQL17 backup was made with the matching existing container tools before application, its archive catalog listed successfully, and private files set0600. Backup SHA256: `6cd50febf100b63a7598a0ab28aff433a1c1d4e2544db9e14b05796ef317dfac`. Private receipt: `.local-data/agent-mode-orbstack/pre-0036-communications-storage-backup.json`. No restore was executed or claimed verified. Application receipt: `0036-communications-storage-apply.json` in the same ignored evidence directory. Existing applied migration bytes remain unchanged.

## Verification

Meaningful RED: the actual `createPostgresAccountRuntime().preflight()` returned false before service storage existed, and restricted service roles were absent (`service-0036-postgres-red.log`).

GREEN: `RUN_AGENT_COMMUNICATIONS_SERVICE_LOCAL_INTEGRATION=true` runs three actual isolated PostgreSQL cases covering successful runtime preflight, all27 FORCE-RLS tables/restricted role membership, bounded durable owner grants, foreign/missing/revoked grant rejection, denial of service-role access to public mandates and absence of service DELETE grants. The synthetic grant is removed on cleanup. Postchecks found zero service grants/connections/setup states/defaults/operations/quota rows. No provider I/O occurs in these tests (`service-0036-postgres-green.log`).

The copied-source provenance/runtime/scoped-auth unit set passes14 tests. TypeScript and scoped ESLint pass. A combined serial run enables all existing agent PostgreSQL flags plus `RUN_AGENT_COMMUNICATIONS_SERVICE_LOCAL_INTEGRATION=true`; its evidence is `native-with-service-0036-postgres.log`. It passes187/187 tests across32 files with zero skips/failures, preserving the original184 cases after service schema/roles were added.

## Runtime boundary

The local service can use the new `communications` schema in this exact database with a separate pool and enforced restricted roles. The production configuration preflight explicitly requires separate application/service databases and an HTTPS service URL; it is unchanged and this local collocated setup is not production validation.

Before the connection screen is available, the isolated runtime needs private mutually distinct encryption/identity/callback/scoped-auth key material, the correct provider endpoint/key, a local service listener and reachable HTTPS notification/return origins. No secret values belong in this document. The current source entry is `scripts/communications-service-entry.ts` and its build-only command is `scripts/build-communications-service.mjs`; startup runs schema preflight and performs no migrations. The standalone fixture entry is synthetic/memory-only and is unsuitable for owned accounts.

All four account/application hourly/daily send quotas must remain0 and native execution remain disabled during connection setup. Setup/list/status/profile verification is separate from sending. Creating a connection does not authorise a default-account switch for existing work, a sequence enrolment or a message. Runtime activation, HTTPS callback setup and actual owned-account connection proof are recorded by the root operator as separate steps; this storage change made no live/provider request or flag change.
