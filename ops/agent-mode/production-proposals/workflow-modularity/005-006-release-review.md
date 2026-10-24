# Original workflow dispatch and incoming reply context — production proposal

Status: **not approved, not applied**. Production was inspected read-only on24 October2026. Both changes are prerequisites for deploying the latest Acquire workflow communications code. Existing local verification does not authorize production execution.

| File | SHA-256 | Purpose |
|---|---|---|
|005-communications-workflow-context.proposed.sql|e61332a165e2acedd2f30c54a052e890ac6bd0433b297c106697799b10255327|Add narrowly scoped SECURITY DEFINER reader for the immutable original operation/enrolment workflow, with actor membership and held-send-gate validation. No broad table grants.|
|006-incoming-workflow-context.proposed.sql|fab78d886accd19d2b7c443df047bc51c1e1cdc5cfb45fbc3eb8581aae1762c9|Bind each incoming event's original conversation execution, then restore caller context. Preserve real production clocks and existing receipt/ownership/replay guards.|

Target: Supabase project `njasjqpztiteionfxxul`, database `postgres`, system identifier `7678071634733212629`. Each file checks exact target and schema ownership;15-second statement and3-second lock limits apply.005 was freshly verified absent.006 was generated from fresh production definitions rather than copied from the local simulator database. It requires these exact predecessors:

- `agent_channel_communications_change(jsonb)`: MD5 `de971f1976ad57eb737b890b527b6616`.
- `agent_communications_change(uuid,text,text,text,text,text,timestamp with time zone,boolean)`: MD5 `0882119b8fe00e71c69d354df5d0282f`.

Private read-only capture and minimal diff: `.local-data/workflow-modularity/production-next/`. No production DDL or row changes were performed. Local007–010 are exact local test-lane exceptions and are explicitly excluded from production.

## Required rehearsal and approval sequence

1. Exact rehearsal-target variants are prepared under `rehearsal/`; hashes are in `005-006-approval-manifest.json`. Only the target guard differs. Read-only inspection confirmed network `none`, database/marker/system identity, required grant roles, absent005, and both006 predecessor hashes identical to production. No production rows were imported.
2. Obtain approval for those exact rehearsal files and conditional production005/006 files. A future dispatch-recovery migration is a separate proposal and must be added explicitly if selected; it is not implicitly covered here.
3. Rehearse005 using restricted campaign/agent roles: exact original agent/campaign/draft source, explicit legacy null, membership, foreign-source denial, held-gate requirement and immutable original identity. Rehearse006 with synthetic routed/legacy incoming receipts, multiple conversations belonging to different executions, duplicate replay, foreign scope denial, and caller-GUC restoration. Reuse the local regression scenarios with production function definitions; preserve production clock behavior.
4. Require all meaningful tests and predecessor checks to pass before applying the exact approved production files atomically with migration journal evidence. If predecessors change, stop and prepare a new review package.
5. Build latest reviewed Acquire source directly for DigitalOcean, update its separately pinned hosted simulator adapter artifact where required, and deploy through the established direct-image path. GitHub Actions deployment remains disabled; do not trigger it. Preserve rollback image/config and verify readiness before a hosted normal-route canary.
6. Prove one simulator-only outbound and AI reply through Acquire for email/WhatsApp/LinkedIn, including durable receipts and exact owned conversation history. Local three-channel success is not hosted-production proof.

Fresh deployment inventory: Acquire application revision `e63c2d7924da79e523481bb53536b959e2297214`, image `sha256:291c53b2b88e8f91ff6a613d7ba2cbdf0f44a869b0f794c97705ca4520604729`, healthy. Standalone communications image revision `447e0b90b03d727262e9cd7f4fd08342d33d8763`, healthy. Neither is evidence that current main has been deployed. Temporary operator SSH access used for inspection was removed and verified; other firewall rules were preserved.
