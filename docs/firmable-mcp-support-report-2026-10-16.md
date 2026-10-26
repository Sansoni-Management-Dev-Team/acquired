# Firmable MCP connection failures: ChatGPT app and Codex CLI

Prepared: 16 October 2026, Asia/Makassar (UTC+08:00).

## Summary for support

We are trying to use the official Firmable MCP for company search and company
profile retrieval. The connected Firmable app previously returned successful
search results. The account owner subsequently upgraded the account to obtain
MCP access, but access remains blocked.

We have observed three different failures:

1. **Connected Firmable app:** initially returned HTTP 403,
   `MCP access is disabled for this user.` Later attempts returned
   `Unknown tool` from the ChatGPT app tool layer.
2. **Native Codex CLI and mcp-remote:** both reject Firmable's OAuth discovery
   metadata because the advertised authorization server and declared issuer
   disagree.
3. **Local adapter with explicitly configured Clerk issuer:** successfully
   completed browser authorization and token exchange, then received HTTP 403
   when initializing the official Firmable MCP. The provider response said
   `MCP access is disabled for this user.`

The local adapter establishes that completing OAuth does not resolve the
remaining MCP access denial. We need help with both the account entitlement and
the discovery configuration. The later app `Unknown tool` failure may require
separate investigation by the ChatGPT app integration team.

## Account and environment

| Item | Value |
| --- | --- |
| Account owner | Callum Holt |
| Account email | Provide the authenticated account email privately in the support ticket; the OAuth userinfo response confirmed a verified Gmail account |
| Account plan | Owner reports upgrading to a plan with MCP access; entitlement has not been independently confirmed |
| Official MCP URL | `https://agents.firmable.com/mcp` |
| Supplied OAuth client ID | `rkI2RHxS55F7qKp8` |
| Operating system | macOS `27.0.1` |
| Codex CLI | `codex-cli 0.162.1` |
| Node.js | `v22.23.1` |
| mcp-remote version used | `0.15.1`, resolved by `mcp-remote@latest` at test time |
| SDK used by local adapter | `@modelcontextprotocol/sdk` `1.32.1` |
| Intended smoke test | AI company search for Commonwealth Bank of Australia, then company lookup for `commbank.com.au` |

The client ID above is a public OAuth application identifier, not an access
token or client secret. This report excludes access tokens, refresh tokens,
cookies, authorization codes, PKCE verifiers, OAuth state values and private
credential files.

## 1. Evidence that the connected app previously worked

Local Codex conversation history contains these completed calls through the
connected Firmable app (`codex_apps`). Dates and times in this table are UTC.

| Date/time | Tool | Observed result |
| --- | --- | --- |
| 2026-09-17 01:21:04 | `firmable.get_workflow_guide` | Completed successfully |
| 2026-09-24 07:12:14 | `firmable.ai_search` | `success: true`; one invocation returned one record, another returned zero records |
| 2026-10-01 05:09:31 | `firmable.get_workflow_guide` | Completed successfully |
| 2026-10-01 05:10:20 | `firmable.ai_search` | `success: true`, `totalCompany: 2894`, 20 returned records |
| 2026-10-01 05:11:04 | `firmable.filter_search` | `success: true`, `totalCompany: 2859`, 3 returned records |
| 2026-10-02 03:17:27 | `firmable.get_workflow_guide` | Completed successfully |

These historical successes were through the connected app. They were **not**
successful logins to the separately configured native CLI MCP server.

## 2. Connected Firmable app: access denied, then tools unavailable

### Initial and repeated access tests

On 15 October UTC / 15–16 October local time, we attempted:

```json
{"tool":"firmable.get_workflow_guide","arguments":{}}
```

```json
{
  "tool": "firmable.ai_search",
  "arguments": {
    "category": "company",
    "country": "AU",
    "query": "Commonwealth Bank of Australia"
  }
}
```

```json
{
  "tool": "firmable.get_company",
  "arguments": {"domain":"commbank.com.au"}
}
```

Observed provider error:

```text
McpServerError: MCP access is disabled for this user.
```

The app's structured error included:

```json
{
  "error_code": "FORBIDDEN",
  "error_data": {
    "type": "http_error",
    "code": 403,
    "message": "MCP access is disabled for this user.",
    "payload": {
      "error": "permission_denied",
      "error_description": "MCP access is disabled for this user."
    },
    "upstream_error_code": "permission_denied",
    "url": "https://agents.firmable.com/mcp"
  }
}
```

The account owner reported upgrading the account. Retesting still produced the
same access-denied response.

### Reconnection troubleshooting and subsequent retries

We advised reconnecting the existing Firmable app through ChatGPT settings using
the upgraded account, then retried when the user requested it. We did not
independently verify the complete reconnection flow or which connection the app
platform selected after that attempt.

The later retries returned a different error:

```text
tool call error: tool call failed for `codex_apps/firmable.get_workflow_guide`

Caused by:
    Mcp error: -32001: Unknown tool({"name":"firmable.get_workflow_guide"})
```

```text
tool call error: tool call failed for `codex_apps/firmable.ai_search`

Caused by:
    Mcp error: -32001: Unknown tool({"name":"firmable.ai_search"})
```

```text
tool call error: tool call failed for `codex_apps/firmable.get_company`

Caused by:
    Mcp error: -32001: Unknown tool({"name":"firmable.get_company"})
```

These errors establish that the app tools were unavailable to that conversation.
They do not establish that a request reached Firmable or that the entitlement
problem had been resolved. Fresh-chat testing was suggested; no independently
verified successful fresh-chat result is recorded here.

## 3. Native Codex CLI registration and OAuth login

We ran:

```sh
codex mcp add firmable \
  --url https://agents.firmable.com/mcp \
  --oauth-client-id rkI2RHxS55F7qKp8
```

Output:

```text
Added global MCP server 'firmable'.
OAuth callback URL: http://127.0.0.1/callback/3IjzD_ag71rA
MCP server may or may not require login. Run `codex mcp login firmable` to login.
```

Then:

```sh
codex mcp login firmable
```

Output:

```text
Error: Metadata error: OAuth metadata discovery failed for https://agents.firmable.com/.well-known/oauth-authorization-server
  Caused by: OAuth authorization server issuer does not match authorization metadata origin
```

The account owner reproduced the same error directly in their terminal.

We inspected the global configuration and confirmed the URL, supplied client ID
and callback above. There was no project-level Firmable MCP override.

Historical CLI setup attempts on 7 September and a retest on 8 September also
failed with this exact issuer mismatch. Thus the native CLI failure predates the
successful connected-app searches listed above.

## 4. Public discovery metadata checks

The following are selected fields from the public responses, not complete
documents. No authentication was required to retrieve them.

### Protected resource metadata

```text
GET https://agents.firmable.com/.well-known/oauth-protected-resource/mcp
```

```json
{
  "resource": "https://agents.firmable.com",
  "authorization_servers": ["https://agents.firmable.com"],
  "scopes_supported": [
    "email", "profile", "user:org:read", "public_metadata", "offline_access"
  ]
}
```

### Authorization metadata on the advertised server

```text
GET https://agents.firmable.com/.well-known/oauth-authorization-server
```

```json
{
  "issuer": "https://clerk.firmable.com",
  "authorization_endpoint": "https://agents.firmable.com/oauth/authorize",
  "token_endpoint": "https://clerk.firmable.com/oauth/token",
  "registration_endpoint": "https://agents.firmable.com/oauth/register",
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic", "none", "client_secret_post"
  ]
}
```

### Clerk's own metadata

```text
GET https://clerk.firmable.com/.well-known/oauth-authorization-server
```

Selected fields:

```json
{
  "issuer": "https://clerk.firmable.com",
  "authorization_endpoint": "https://clerk.firmable.com/oauth/authorize",
  "token_endpoint": "https://clerk.firmable.com/oauth/token",
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic", "none", "client_secret_post"
  ]
}
```

An unauthenticated request to the MCP endpoint returned HTTP 401 with this
challenge:

```text
Bearer error="invalid_token", error_description="No authorization provided", resource_metadata="https://agents.firmable.com/.well-known/oauth-protected-resource/mcp", scope="email profile user:org:read public_metadata offline_access"
```

The root URL `https://agents.firmable.com/.well-known/oauth-protected-resource`
returned HTTP 404; the path-specific `/mcp` metadata URL above returned data.

**Observed inconsistency:** the resource metadata advertises
`https://agents.firmable.com` as the authorization server, but its authorization
metadata identifies `https://clerk.firmable.com` as issuer. Both tested standard
clients reject this chain. A correct issuer at Clerk's own endpoint is reachable.

## 5. mcp-remote bridge attempt

We tried the diagnostic client, preserving the supplied client ID:

```sh
npx -y -p mcp-remote@latest mcp-remote-client \
  https://agents.firmable.com/mcp \
  --static-oauth-client-info '{"client_id":"rkI2RHxS55F7qKp8"}'
```

Relevant output, with process IDs and stack trace frames omitted:

```text
Using static OAuth client information from string
Using callback port derived from the server URL: 20847
Discovering OAuth server configuration...
Discovered authorization server: https://agents.firmable.com
Initializing auth coordination on-demand
OAuth callback server running at http://127.0.0.1:20847
Connecting to remote server: https://agents.firmable.com/mcp
Using transport strategy: http-first
Connection error: IssuerMismatchError: Issuer mismatch in authorization server metadata (RFC 8414 §3.3): expected "https://agents.firmable.com", received "https://clerk.firmable.com"
```

The fatal error carried:

```text
kind: 'metadata'
expected: 'https://agents.firmable.com'
received: 'https://clerk.firmable.com'
```

This workaround failed before tool discovery or data access. We did not register
this failed bridge as a replacement Codex server.

## 6. Callback URL preflight after explicitly selecting Clerk

We tested authorization requests against Clerk using the supplied client ID,
S256 PKCE, a fresh state value, the advertised scopes, and
`resource=https://agents.firmable.com`.

We followed the authorization redirect to `/oauth/authorize/continue` to inspect
the outcome. We did not treat the initial HTTP 302 as proof of acceptance.

| Callback URL | Observed outcome |
| --- | --- |
| `http://127.0.0.1:20847/oauth/callback` | HTTP 400: unregistered redirect URI |
| `http://localhost:20847/oauth/callback` | HTTP 400: unregistered redirect URI |
| `http://127.0.0.1/callback/3IjzD_ag71rA` | HTTP 400: unregistered redirect URI |
| `http://127.0.0.1:3334/oauth/callback` | HTTP 400: unregistered redirect URI |
| `http://localhost:3334/oauth/callback` | HTTP 302 to `https://app.firmable.com/sign-in`; subsequently used for a successful complete OAuth login |

Rejected callbacks returned:

```json
{
  "error": "invalid_request",
  "error_description": "The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed. The 'redirect_uri' parameter does not match any of the OAuth 2.0 Client's pre-registered redirect urls."
}
```

The native CLI currently stops at discovery, so callback rejection is a separate
compatibility issue identified during the explicit-issuer preflight.

## 7. Local explicit-issuer adapter: OAuth succeeded, MCP still denied

We built an isolated local proof of concept, leaving Acquire's production
provider configuration unchanged.

Configuration:

```text
MCP endpoint:       https://agents.firmable.com/mcp
Pinned issuer:     https://clerk.firmable.com
Authorization:     https://clerk.firmable.com/oauth/authorize
Token endpoint:    https://clerk.firmable.com/oauth/token
Client ID:         rkI2RHxS55F7qKp8
Redirect URI:      http://localhost:3334/oauth/callback
Resource:          https://agents.firmable.com
Client auth:       none (public client)
PKCE:              S256
Scopes:            email profile user:org:read public_metadata offline_access
```

The adapter validates the pinned issuer and endpoint URLs, uses fresh PKCE and
state for each login, and validates callback state and issuer when applicable.
It does not disable issuer validation. It sends the access token in the
Authorization header to the official MCP endpoint and rejects redirects on
authenticated requests.

### Login

Command from the adapter directory:

```sh
node adapter.mjs login
```

Output:

```text
Opening Firmable sign-in; callback is http://localhost:3334/oauth/callback.
Firmable OAuth login completed. Tokens saved in the ignored private directory.
```

Post-login check:

```json
{
  "issuer": "https://clerk.firmable.com",
  "callback": "http://localhost:3334/oauth/callback",
  "authenticated": true,
  "peopleData": "disabled"
}
```

A request to the userinfo endpoint from Clerk's validated OpenID configuration
also succeeded. It confirmed the authenticated account's email with
`email_verified: true`. A refresh token was present in the OAuth response.
No token values are included here.

Private verification evidence was captured at **2026-10-15 23:06:40 UTC**, or
**2026-10-16 07:06:40 Asia/Makassar**.

### MCP initialization

We then attempted to connect and list the allowed company tools:

```sh
node adapter.mjs tools
```

The initial diagnostic output was:

```text
Firmable MCP connection failed: Streamable HTTP error: Error POSTing to endpoint: {"error":"permission_denied","error_description":"MCP access is disabled for this user."}
```

We subsequently tightened error logging to avoid forwarding arbitrary provider
response bodies. A repeat confirmed the HTTP status:

```text
HTTP 403
```

Initialization failed before tools could be listed. The planned AI company
search and company profile lookup were therefore **not attempted through this
adapter**.

### Local validation versus live verification

| Check | Status |
| --- | --- |
| Five local tests: PKCE/state, issuer/endpoints, callback validation, company-only calls, private storage and serialized refresh | Passed |
| Live Clerk metadata validation | Passed |
| Live browser login and authorization-code exchange | Passed |
| Live authenticated userinfo request | Passed |
| Refresh token issued | Confirmed |
| Actual live token renewal | Not tested; refresh behavior is locally tested only |
| Official MCP initialization | Failed: HTTP 403, MCP access disabled |
| Tool discovery through local adapter | Not reached |
| Company search and enrichment through local adapter | Not reached |
| Local adapter registered in Codex | No |
| Acquire production integration changed or deployed | No |

## 8. Requested investigation and resolution

Please help with the following:

1. **Verify MCP entitlement for the authenticated user and workspace.** The
   account owner reports upgrading, yet a newly authorized OAuth access token
   still receives `permission_denied` / `MCP access is disabled for this user.`
   Please check any user-level flag, workspace entitlement, role restriction,
   selected-organization requirement or client-application restriction.
2. **Correct or clarify the supported OAuth discovery chain.** Please make the
   resource metadata's advertised authorization server consistent with the
   issuer in the authorization metadata, or provide a supported alternate MCP
   endpoint/configuration that strict clients can use.
3. **Document the registered callback URLs.** The supplied client ID accepted
   `http://localhost:3334/oauth/callback`, but rejected the callback generated by
   native Codex and the default mcp-remote callback. Please provide a compatible
   client registration or the exact supported CLI configuration.
4. **Investigate the connected-app regression.** It previously returned valid
   company search results, later returned a provider access-denied error, then
   returned `Unknown tool` through the ChatGPT app layer. Please confirm whether
   the published app/tool registration or connection needs repair or relinking.
5. **Confirm the verification account/workspace.** We can supply the exact
   account email privately and reproduce a fresh OAuth login if necessary.

Once the access denial is resolved, our next verification will be tool discovery,
AI company search, and one company lookup. Current retests do not include people
search, contact enrichment or phone reveals. No database migration or production
deployment was performed as part of this investigation.

## Retest: 19 October 2026

Resumed from Codex thread `01a13f5c-2d53-7f40-9157-df4fad2bac51`,
“Assess official MCP capabilities”. Its latest prior retest was 18 October
2026 (Asia/Makassar); all three connection paths were still blocked.

Fresh checks completed by **2026-10-19 02:58:16 UTC**
(**10:58:16 Asia/Makassar**):

| Connection/check | Observed result |
| --- | --- |
| Connected app: `get_workflow_guide` | HTTP 403, `MCP access is disabled for this user.` |
| Connected app: `ai_search`, Commonwealth Bank of Australia, country AU, category company | Same HTTP 403 access denial |
| Connected app: `get_company`, domain `commbank.com.au` | Same HTTP 403 access denial |
| Saved local adapter: `node adapter.mjs tools` | HTTP 403; tool discovery not reached |
| Native CLI: `codex mcp login firmable` | OAuth discovery rejected: authorization server issuer does not match authorization metadata origin |

The connected app tools are callable in this fresh conversation, but Firmable
continues to deny access. No successful company result was returned. No people
data was requested, and no database migration, production configuration change
or deployment was performed.

Next action remains provider resolution of the authenticated user/workspace's
MCP access and the OAuth discovery mismatch. After resolution, repeat company
tool discovery, company search and the single company lookup above.

## Retest: 20 October 2026

Fresh checks completed by **2026-10-19 22:51:41 UTC**
(**20 October 2026, 06:51:41 Asia/Makassar**). All three paths remain blocked:

| Connection/check | Observed result |
| --- | --- |
| Connected app: `get_workflow_guide`, company `ai_search` for Commonwealth Bank of Australia (AU), and `get_company` for `commbank.com.au` | Each returned HTTP 403, `MCP access is disabled for this user.` |
| Saved local adapter: `node adapter.mjs tools` | HTTP 403; tool discovery not reached |
| Native CLI: `codex mcp login firmable` | OAuth discovery rejected: authorization server issuer does not match authorization metadata origin |

No company data was returned. No people tools, database migrations, production
configuration changes or deployments were performed. Next action remains
provider resolution of MCP access and OAuth discovery, followed by the same
company-only verification.

## Retest: 21 October 2026

Fresh checks completed by **2026-10-21 11:26:23 UTC**
(**19:26:23 Asia/Makassar**). Results remain unchanged:

| Connection/check | Observed result |
| --- | --- |
| Connected app: `get_workflow_guide`, company `ai_search` for Commonwealth Bank of Australia (AU), and `get_company` for `commbank.com.au` | Each returned HTTP 403, `MCP access is disabled for this user.` |
| Saved local adapter: `node adapter.mjs tools` | HTTP 403; tool discovery not reached |
| Native CLI: `codex mcp login firmable` | OAuth discovery rejected: authorization server issuer does not match authorization metadata origin |

No company data was returned. No people tools, database migrations, production
configuration changes or deployments were performed. Next action remains
provider resolution of MCP access and OAuth discovery, followed by the same
company-only verification.

## Retest: 23 October 2026

Fresh checks completed by **2026-10-23 00:24:09 UTC**
(**08:24:09 Asia/Makassar**). Results remain unchanged:

| Connection/check | Observed result |
| --- | --- |
| Connected app: `get_workflow_guide`, company `ai_search` for Commonwealth Bank of Australia (AU), and `get_company` for `commbank.com.au` | Each returned HTTP 403, `MCP access is disabled for this user.` |
| Saved local adapter: `node adapter.mjs tools` | HTTP 403; tool discovery not reached |
| Native CLI: `codex mcp login firmable` | OAuth discovery rejected: authorization server issuer does not match authorization metadata origin |

No company data was returned. No people tools, database migrations, production
configuration changes or deployments were performed. Next action remains
provider resolution of MCP access and OAuth discovery, followed by the same
company-only verification.

## Retest: 26 October 2026

Fresh checks completed by **2026-10-26 01:41:07 UTC**
(**09:41:07 Asia/Makassar**). Results remain unchanged:

| Connection/check | Observed result |
| --- | --- |
| Connected app: `get_workflow_guide` with topic `all`, company `ai_search` for Commonwealth Bank of Australia (AU), and `get_company` for `commbank.com.au` | Each returned HTTP 403, `MCP access is disabled for this user.` |
| Saved local adapter: `node adapter.mjs tools` | HTTP 403; tool discovery not reached |
| Native CLI: `codex mcp login firmable` | OAuth discovery rejected: authorization server issuer does not match authorization metadata origin |

The connected app now requires an explicit workflow-guide topic; this retest
used the current schema. No company data was returned. No people tools,
database migrations, production configuration changes or deployments were
performed. Next action remains provider resolution of MCP access and OAuth
discovery, followed by the same company-only verification.

## References

- [Firmable: MCP URL and Client ID](https://help.firmable.com/where-to-find-your-firmable-mcp-url-and-client-id)
- [Firmable: developer tools setup](https://connect.firmable.ai/mcp/developer-tools/)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [RFC 8414, section 3.3: metadata validation](https://www.rfc-editor.org/rfc/rfc8414#section-3.3)
- [mcp-remote documentation](https://github.com/punkpeye/mcp-remote)
- [Related Codex discovery report, issue 42427](https://github.com/openai/codex/issues/42427)
- [Related Codex macOS OAuth report, issue 34684](https://github.com/openai/codex/issues/34684)

The linked Codex reports concern other deployments. They were research leads,
not proof that the same Codex defect caused Firmable's failures. The direct
observations and exact error outputs above are the evidence for this case.
