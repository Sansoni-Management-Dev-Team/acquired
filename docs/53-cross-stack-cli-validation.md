# Cross-stack CLI validation

17 October 2026. Tested the existing app stack against the instructions and limits
in `../project-acquire-agent-testing/ops/agent-testing/cross-stack.md`.
Source and actual CLI/database evidence are distinguished below. This is a local
simulator check, not native-agent journey or live-provider certification.

## Results

| Boundary | Actual result |
| --- | --- |
| Target | Running `acquire-agent-testing` VM; isolated/network-isolated, selective worktree mount; app DB remains marker-checked `acquire_agent_mode:5437` |
| Run | Exact `agent-mode-20261017`; five documented fictional contacts retained; both saved mandate-name fields exactly match `Simulator — OrbStack local test` |
| Connections | Email, WhatsApp and LinkedIn connected, Ready and default after explicit scoped history refresh; original simulator bindings unchanged |
| TLS/profile | Exact loopback simulator/provider endpoints, normal certificate verification; existing bridge reused |
| CLI inbound | One additional explicitly scripted reply; provider webhook delivery1/failed0, repeat deliver0/failed0 |
| Durable app ingress | Exact new provider ID has one processed webhook, one semantic inbound event, one immutable app **review** receipt and one acknowledged outbox row |
| Reply identity | Receipt remains `identity_pending`, unresolved. No native conversation/reply/handoff is claimed |
| Model budget | Simulator prospect ceiling20 total,2 per lead;0 actual model calls, all remaining capacity unchanged |
| Clock | Processed one due event with `advance --by 0s`; provider time unchanged, application/Postgres/n8n clock integration remains false |
| Execution | Native flag remains false; nine older ready responsibilities remain untouched; simulator fixture has zero threads, operations, conversations, enrolments and send intents |
| Historical account | Both saved original Gmail connection/generation row fingerprints still match the pre-simulator evidence |
| Contract regression |126 tests pass across both worktrees, zero skips |
| CLI/artifact assertions |22 assertions pass against freshly collected machine, scope, history, account, reply, budget and clock results |

The first connection read found only email Ready; social history had aged out,
which is expected under the documented five-minute coverage window and email-only
automatic maintenance. The documented `sync` command completed history refreshes
for all three channels, followed by Ready/default status reads. Those results
describe their saved check timestamps, not a promise that social coverage never
expires.

## Commands exercised

In the testing worktree:

```sh
node testing/agent-simulator/orbstack.mjs status
node testing/agent-simulator/orbstack.mjs report --run .local-data/agent-simulator/agent-mode-20261017 --format json
node testing/agent-simulator/orbstack.mjs report --run .local-data/agent-simulator/agent-mode-20261017 --format text
node testing/agent-simulator/orbstack.mjs inbox --run .local-data/agent-simulator/agent-mode-20261017 --address lead-001@agent-mode-20261017.leads.acquire.test
```

Selected the existing outbound transport-smoke message from the saved CLI inbox,
then used `decide --message ORIGINAL_ID --action reply --text SCRIPTED_TEST_TEXT
--delay 0s`, without an inference configuration. Its saved decision is explicitly
`inference.kind=scripted`. `advance --by 0s` processed exactly that due reply,
without advancing the provider clock or claiming accelerated app execution.

```sh
node testing/agent-simulator/orbstack.mjs deliver --run .local-data/agent-simulator/agent-mode-20261017 --target https://127.0.0.1:5491/v1/webhook
```

Repeated delivery after success returned zero deliveries and zero failures. This
checks the delivery queue's settled state; it is not a second forced webhook replay
against application deduplication. The exact-ID SQL audit separately verifies one
durable semantic row, app receipt and ACK, with ACK following receipt persistence.

In the agent-mode worktree:

```sh
docker exec project-acquire-agent-mode node /workspace/.local-data/agent-mode-orbstack/simulator-probe.cjs state
docker exec project-acquire-agent-mode node /workspace/.local-data/agent-mode-orbstack/simulator-probe.cjs sync
```

Also verified `prospects --limit 1` without `--config` exits1 with the documented
`model_config_required` JSON error and makes no model call. An initial audit oracle
looked for that JSON in stderr; the CLI correctly emits it to stdout. Corrected
the artifact assertion, without changing production code or inventing a CLI bug.
The existing Node module-type warning is nonfatal and separate from command results.
A separate fixture-name oracle initially searched the descriptive text; corrected
it to check both actual saved name fields, which match the exact documented label.
No fixture or application data was changed to satisfy either corrected oracle.

## Evidence

Ignored private artifacts in agent-mode `.local-data/agent-mode-orbstack/evidence/`:

- `agent-mode-cli-recheck-{flags,history,state-before,state-after-sync,state-final}.json`
- `agent-mode-cli-recheck-assertions.json`
- `independent-cross-stack-audit.json`
- `independent-scripted-inbound-verification.json`
- `simulator-independent-{contract,env}-regression.log`

Testing-worktree `.local-data/agent-simulator/evidence/`:

- `agent-mode-cli-recheck-*`: machine/report/inbox before and after, scripted
  decision, due event, delivery, no-config rejection, final text/JSON report.
- `agent-mode-independent-contract-regression.log` and
  `agent-mode-independent-readonly-counts.json`.

The independent SQL baseline's second saved snapshot overlapped delivery and
already included the new reply. The earlier read observed one prior event/receipt/
ACK; the exact-ID postcheck is authoritative for this fresh reply. No accelerated
before/after timing or second webhook injection is claimed.

## Limits preserved

- No bridge copy, account setup, new default, new outbound simulator send, real
  provider message, model inference, migration or worker activation was started.
- The old raw-transport `mail_sent` association remains unresolved/retrying. It has
  no Acquire intent; no tracking acknowledgement or approved receipt was invented.
- The new inbound receipt is a human-review outcome, not contact-resolved native
  processing. Fixture qualification/approval and native execution remain unstarted.
- The simulator run still labels `agentJourney`, database durability certification
  and live-provider parity as unverified. The exact receipt audit verifies this
  ingress persistence slice, not the independent harness's broader certifications.
- A future native run must be restricted to the simulator mandate before enabling
  execution; globally enabling this app worker could resume nine older responsibilities.
  The separate testing-DB shared-clock/native proofs do not transfer to this app run.
