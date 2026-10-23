# Local Firmable MCP company adapter

An isolated proof of concept for Codex. It does not change Acquire's provider,
production configuration or database. It is not production integration code.

Firmable's MCP discovery advertises `agents.firmable.com` as the authorization
server but that server's metadata declares `clerk.firmable.com` as issuer. This
adapter uses an explicit, pinned issuer configuration and validates Clerk's own
metadata. Issuer validation is retained. It uses S256 PKCE and validates OAuth
state and callback issuer before exchanging the authorization code.

Public authorization preflight accepted `http://localhost:3334/oauth/callback`
for the supplied client ID. The default mcp-remote callback and Codex callback
were rejected as unregistered. Full OAuth completion is a separate live check.

## Use

From this directory:

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run login
node adapter.mjs tools
npm run smoke
```

Login opens the browser and waits up to five minutes. The callback listener binds
to localhost on port 3334. Tokens are stored with mode 0600 inside the repository's
ignored `.local-data/firmable-mcp-adapter/` directory (mode 0700). Token refresh
runs before authenticated requests when expiry is near; refresh failure requires
login again. Run one adapter process at a time: refresh locking is in-process,
not across independent CLI/stdio processes.

`tools` only lists the allowed tool names. `smoke` fetches the workflow guide,
searches for Commonwealth Bank of Australia, and fetches one company profile by
domain. The company profile lookup can cost up to one enrichment credit. It
does not call people or phone-reveal tools. Raw company smoke evidence stays in
the same ignored private directory.

After login and the smoke check pass, register the local stdio adapter:

```sh
codex mcp add firmable-company-local -- node \
  /Users/callum/Documents/Development/project-acquire/scripts/firmable-mcp-adapter/adapter.mjs stdio
```

Restart Codex or reload MCP servers. Do not use `codex mcp login` for this local
server; `npm run login` handles OAuth. The existing native `firmable` entry and
connected Firmable app are separate and are not changed by these commands.

Only the workflow guide, company AI/structured searches, company filter options,
and single company profile tools are exposed. People tools and other remote
actions are rejected even if called by name. This adapter cannot be used for
contact enrichment, CRM writes, phone reveals or list mutations.

## Verification

`npm test` covers fresh PKCE/state, pinned issuer and endpoints, callback origin,
duplicate and mismatched callback parameters, company-only tool enforcement,
private credential permissions and serialized refresh with refresh-token reuse.
`npm run check` verifies live issuer metadata without requesting business data.
Passing these checks does not establish successful login, company data access,
production readiness or unattended service-account support.

## Live result: 2026-10-16 (Asia/Makassar)

- OAuth login completed using Clerk's validated metadata and the callback above.
- The provider's userinfo endpoint confirmed the authenticated, verified account.
- A refresh token was issued; refresh behavior is locally tested, not live verified.
- Official MCP initialization rejected this authenticated session with
  `MCP access is disabled for this user.` Tool discovery therefore did not run.
- Company search and profile lookup were not reached. No people tool was called.
- Private verification evidence is in
  `.local-data/firmable-mcp-adapter/verification.json`.
- The local adapter has not been registered in Codex or connected to Acquire.
- Next action: have Firmable enable MCP for the authenticated user/workspace,
  then run `node adapter.mjs tools` and `npm run smoke` sequentially. No OAuth
  discovery workaround change is needed unless provider metadata changes.
