# Approval package: service transport boundary rehearsal

Unapproved and unapplied. No database, role or schema has been created.

Inventory found no existing dedicated service rehearsal. The stopped `acquire-communications-standalone-postgres-1` belongs to another worktree and has a non-isolated network; it is intentionally untouched. Use a NEW empty database in the existing `acquire-hosted-demo-rehearsal-postgres` cluster, whose Docker network is `none`, system identifier `7699248227334438947`. Its existing app rehearsal database remains unchanged. The new database and three NOLOGIN, NOSUPERUSER, NOBYPASSRLS roles do not currently exist.

Review exact hashes in `manifest.json`, then approve these steps:

1. Run `000-create-target.proposed.sql` as postgres on database postgres of that exact container. Creates only the three named service roles and `acquire_communications_rehearsal`, with marker `acquire-communications-rehearsal-only`.
2. Run `001-service-schema-only.proposed.sql` as postgres on the new database. Captured with production `pg_dump --schema-only --schema=communications`; includes existing functions, constraints, RLS, policies, grants and ownership. No production rows, global roles/passwords or credentials. Dump session timeout overrides and random psql restriction tokens were removed; target checks and bounded timeouts added. Production service catalog owner is a superuser; this rehearsal owner deliberately is not. Do not weaken restricted `communications_control` tests.
3. Run the target-specific `011-dispatch-transport-boundary.proposed.sql` on the new database. The administrative guard checks system identity before assuming the restricted schema-owner role. Actual table/function/trigger/policy/grant definitions match proposed production 011.
4. Run rollback-only synthetic actual-role journal/proof tests and the two-session transport-close versus write-start race. Confirm denied foreign actor/fence/admission changes, absence of retroactive old-row proof, irreversible write barrier and no quota release. No provider requests or service activation. Compare prerequisite schema and owner/grant definitions against the capture; any missing dependency requires a corrected package.
5. Only after those pass, conditionally apply the separately approved production file to DO `acquire-communications-storage-postgres-1`, DB `acquire_communications`, system `7696498816558297120`. Production file SHA-256: `4b7523eef65e35c6491a8de29489a264824234c3f3fcd23a105a40916d44f3ba`. No deployment is implied.

Use `docker exec -i CONTAINER psql -X -U postgres -d DATABASE -v ON_ERROR_STOP=1 < FILE`, verifying SHA-256 and Docker network before each application. Stop on any error; never rerun creation blindly. Preserve captured schema and logs privately. The creation step cannot run inside one transaction because CREATE DATABASE is prohibited there; its guarded roles/database must be recorded if interrupted.
