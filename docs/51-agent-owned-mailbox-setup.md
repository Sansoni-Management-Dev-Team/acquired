# Isolated owned-mailbox connection setup

17 October 2026: the user authorised configuring real account connection setup in
the agent worktree. Sending, production changes and mailbox OAuth consent remain
separate from this configuration. The local connection UI now reaches Google's
account chooser through Unipile. The user must select their owned account and
complete the provider's consent flow. No mailbox was connected by the agent.

## Runtime

- Application: `http://acquire-agent.orb.local/settings`, original local auth origin.
- Existing exact database: `acquire_agent_mode`, host `127.0.0.1:5437`, marker
  `acquire-agent-mode-local-only`. Migration0036 adds the independent service
  schema to this local database; see [storage evidence](50-agent-owned-mailbox-setup.md).
- Communications service: loopback5461 inside the app's Docker network namespace;
  no host port. The unrelated other worktree's host5461 service is untouched.
- Callback gateway: host loopback5462, Cloudflare Quick Tunnel HTTPS ingress.
  Only capability-authenticated setup notifications can reach the service.
  Fixed return routes redirect the browser to local settings. The tunnel exposes
  neither the app nor the general communications API or send endpoint.
- `COMMUNICATIONS_RUNTIME_ENABLED=true`, `AGENT_NATIVE_EXECUTION_ENABLED=false`.
  Account/application hourly/daily limits are all0. Connection setup grants no
  application sending capacity. No outbound email was sent.
- Actual public callback checks: health200, private API/send paths404,
  fixed browser return303, unauthenticated synthetic notification401.

## Start and restart

```sh
node scripts/start-agent-mode-mailbox-setup.mjs --connect-only
```

This explicit command uses the existing private Unipile v1 API endpoint/key for
initial setup, creates separate local encryption/authentication material, starts
or reuses the narrow tunnel and runs the normal OrbStack launcher. It never
imports provider accounts, sessions, old cryptographic keys or another database.
It runs no migration and sends no email. Future starts reuse saved key material.

Private settings are ignored, mode0600:
`.local-data/agent-mode-orbstack/communications.private.env`,
`communications-service.env`, `runtime.env`, and `mailbox-tunnel.json`.
Never source these dotenv files as shell scripts or print their contents.

The ordinary `start-agent-mode-orbstack.mjs --restart-app` reads the explicit
worktree-private opt-in settings, preserves keys and rebinds all network-sharing
containers. Without an opt-in file, communications stay disabled. With the
connect-only file, native execution is forced off and all send limits remain0.
The launcher probes the actual service, not just the callback gateway, before
reporting readiness.

Quick Tunnel URLs are temporary. If the tunnel exits or the computer restarts,
rerun the mailbox setup command to obtain/update its URL, then generate a fresh
Connect Email link. Existing account ownership and encryption keys are retained.
The host tunnel is a detached local process, not an installed login service.
To disable setup, stop the dedicated communications/setup-callback containers,
stop the recorded tunnel process after checking its identity, remove the private
opt-in configuration, and restart the app. Removing settings alone does not stop
already-running profile containers or the tunnel.

## Verification

- Actual isolated PostgreSQL:187/187 tests across32 files, zero skips, including
  all previous184 agent cases and3 actual service schema/grant checks.
- Environment/serialization/local database checks:14 Node tests; callback gateway
  real HTTP checks:3 Node tests in an isolated network-disabled container (including provider account-id returns).
- Existing settings/management/configuration regression:22 Vitest tests.
- Scoped lint, syntax and Compose configuration checks pass.
- Google account chooser visibly reached from the existing signed-in settings UI;
  screenshot `output/opendots-architecture-review/mailbox-google-connection-ready.png`.

The initial startup exposed the old JSON-string dotenv writer truncating keyring
JSON under Node `parseEnv`. A behavioural RED reproduced it; a literal dotenv
serializer now roundtrips JSON, empty strings, base64 and dollar signs without
interpolation. The original newly-generated local keys were recovered from the
raw private file and preserved; no service had used them before the correction.

This verifies setup availability, link creation and callback reachability. It
does not claim mailbox OAuth consent, successful account binding, complete inbox
history, real sending/receiving, meeting handoff UAT or production release.

Next: user completes the owned-mailbox connection. Then obtain the exact sender,
owned recipient and test-send authority before enabling any send capacity.

## Gmail return and first account binding verified

The user completed Gmail consent. Unipile appended an opaque `account_id` to
`/setup/returned`; the original gateway accepted only a bare return path and
returned404. A real-HTTP behavioural RED reproduced that exact format. The
gateway now accepts only the existing return paths with an optional bounded
opaque account-id parameter, discards that identifier, sets no-referrer, and
redirects to the same fixed local settings address. Duplicate/unknown parameters,
encoded controls, oversized identifiers and redirect injection remain rejected.
Account binding still requires the authenticated durable notification, fresh
owner scope and provider owner verification; browser query data supplies no
authority. All3 gateway tests pass, scoped lint and diff checks pass.

Read-only provider verification for the exact just-connected account returned
valid Account and AccountOwnerProfile records, but both Mail and Calendar
sources were present. The verifier correctly refused ambiguous selection.
Configured the exact verified Mail source in the worktree-private
`COMMUNICATIONS_GMAIL_SOURCE_ID`, preserving keys and existing source safeguards;
no parser/capability fallback was introduced. This setting is platform-wide and
currently serves the single-mailbox pilot. Additional Gmail accounts with
different source IDs will require separately scoped source selection.

Rebound the isolated services via the launcher. The original captured callback
then processed successfully under owner polling: one saved Gmail connection and
metadata row, processed notification, zero service send journal operations.
Browser navigation through the supplied return URL now lands on local settings
and shows the account as **Syncing**. Screenshot:
`output/opendots-architecture-review/mailbox-gmail-return-fixed.png`.
No reconnection or repeat consent was needed.

Runtime remains communications=true, native=false, four send limits0. Setup and
account binding are live verified; inbox completeness and actual sending/receiving
UAT remain pending. No email was sent and no migration was required for this fix.
