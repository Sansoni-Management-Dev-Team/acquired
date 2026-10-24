# Rerunning channel acceptance

Use `scripts/acquisition-three-channel-canary.mjs` to run email, WhatsApp and LinkedIn sequentially through normal Acquire routes. It wraps `acquisition-channel-canary.mjs`, retaining separate request IDs, operation IDs and resumable journals. It never calls a provider send endpoint directly.

Create an ignored `.local-data/<run>/configuration.private.json` with these fields:

```json
{
  "origin": "https://acquire-isolated.orb.local",
  "cookieFile": "/absolute/path/.local-data/auth/session-cookie.txt",
  "evidenceDir": "/absolute/path/.local-data/fresh-channel-run",
  "expectedOwnerId": "owned-test-user",
  "expectedOrganizationId": "owned-test-workspace",
  "simulatorRun": "agent-owned-test-run",
  "bindings": {"email": "binding-uuid", "whatsapp": "binding-uuid", "linkedin": "binding-uuid"},
  "acceleratedSimulation": true
}
```

Obtain actual identities and bindings from the intended isolated workspace and simulator handoff. The cookie file contains only the session cookie header. Do not commit credentials, request bodies or private evidence.

```sh
node --use-system-ca scripts/acquisition-three-channel-canary.mjs --execute --config .local-data/<run>/configuration.private.json
```

Resume using the identical command and directory. A fresh test uses a new evidence directory, preserving earlier results. Do not delete ambiguous pending markers to force a retry: inspect the original normal-route receipt and outcome first. LinkedIn may stop for acceptance of its exact invitation through the simulator's supported interface; resume the same journal afterwards. Never assume connection acceptance or alter relationship timestamps.

A runner pass requires a canonical initial outbound and subsequent saved inbound in Acquire. Independently verify the simulator's exact new message and AI decision IDs against the pre-run baseline. Existing historical inbound is not fresh acceptance. Three isolated direct-adapter passes do not prove the separate hosted remote-authority callback path; that path has its own HTTP regression and production acceptance.

For an explicitly chosen clean saved source, configuration may contain `legacySource: {mandateId, brief}` obtained from the owned mandate API. This uses the existing `/api/mandates/agent` cached-copy route and records `admissionKind: legacy_cached_demo`; it does not claim v2 workflow admission coverage. Creation receipts, source identity and brief digest remain pinned on resume. Do not use a research-only or no-contact brief for message acceptance, and do not edit that source to bypass its restriction.
