# Research UI verification

Use a signed-in isolated test account and the current local app. Do not start outreach.

1. Record Settings → Business research → default. A desired company count is not a hard discovery cap.
2. On Home enter a narrow business brief explicitly prohibiting outreach. Leave Agent mode off, click Find companies, and verify navigation to Companies.
3. Observe the saved run with the read-only collector below. Verify real company profiles, people and evidence, then Stop research through the normal UI/API once bounded evidence is available. Cancellation is not a naturally completed run.
4. Repeat from Home with Agent mode on. Verify the agent conversation displays research progress and its Companies panel renders the saved results.
5. Restore the original research setting. Retain IDs, screenshots, stop receipts and final inactive states. Never reset failed jobs or manufacture research results.

```sh
node --use-system-ca scripts/observe-research-ui-run.mjs \
  https://acquire-isolated.orb.local PRIVATE_COOKIE_FILE MANDATE_UUID PRIVATE_EVIDENCE_DIRECTORY
```

The collector only performs authenticated GETs and writes private evidence (which may contain business/contact details). Browser clicks remain necessary to establish actual UI entry coverage.

## Verified 24 October 2026

Local app12353bc: normal workflow0606212f saved13 companies,4 people,7 findings; Agent presentation dbf7cbd7 saved6 companies,16 people,4 findings. Both used the shared live hybrid Firmable/web path and were normally cancelled after positive enrichment evidence; final active=false and workflow cancelled. Original setting20 restored. Screenshots and normal API receipts are under ignored `.local-data/research-ui-verification/`.

The initial b550 workflow exposed a development reload defect: globally cached pool wrappers retained an older module-local AsyncLocalStorage accessor. PostgreSQL correctly refused writes without explicit workflow authority. Commit12353bc shares the async storage across module reloads, retaining per-request isolation. Red regression reproduced undefined context;24 focused tests, TypeScript and ESLint passed. App-only restart replaced pre-fix cached wrappers. Failed original run retained, no SQL repair or migration.

These are local UI/start/discovery/enrichment checks, not production acceptance or full natural completion. Agent presentation's initial shared workflow is not nativeAgent classification, so its desired count is also not a strict profile cap.
