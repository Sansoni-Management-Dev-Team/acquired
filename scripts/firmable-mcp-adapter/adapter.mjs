import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export const ISSUER = 'https://clerk.firmable.com';
export const MCP_URL = 'https://agents.firmable.com/mcp';
export const RESOURCE = 'https://agents.firmable.com';
export const REDIRECT_URI = 'http://localhost:3334/oauth/callback';
const CLIENT_ID = 'rkI2RHxS55F7qKp8'; // Public, pre-registered OAuth client identifier.
const SCOPES = 'email profile user:org:read public_metadata offline_access';
const PRIVATE_DIR = fileURLToPath(new URL('../../.local-data/firmable-mcp-adapter/', import.meta.url));
const ALLOWED_TOOLS = new Set(['get_workflow_guide', 'ai_search', 'filter_search', 'get_filter_options', 'get_company']);
const COMPANY_FILTERS = new Set(['country', 'location', 'hq_location', 'hq_country', 'industry', 'company_size', 'global_company_size', 'company_type', 'revenue', 'year_founded', 'keywords', 'services', 'products', 'technographics', 'company_id']);

export function validateMetadata(metadata) {
  if (metadata.issuer !== ISSUER) throw Error('Pinned OAuth issuer mismatch');
  if (metadata.authorization_endpoint !== `${ISSUER}/oauth/authorize`
    || metadata.token_endpoint !== `${ISSUER}/oauth/token`) throw Error('Unexpected OAuth endpoints');
  if (!metadata.code_challenge_methods_supported?.includes('S256')) throw Error('S256 PKCE is required');
  if (!metadata.token_endpoint_auth_methods_supported?.includes('none')) throw Error('Public OAuth client is not supported');
  return metadata;
}

async function discover() {
  // Explicit provider configuration, not a disabled issuer check or altered provider metadata.
  const response = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Error(`Issuer discovery failed (HTTP ${response.status})`);
  return validateMetadata(await response.json());
}

export function makeFlow(metadata) {
  validateMetadata(metadata);
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES,
    state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', resource: RESOURCE,
  }).toString();
  return { verifier, state, url, issuer: metadata.issuer,
    issuerRequired: metadata.authorization_response_iss_parameter_supported === true };
}

export function validateCallback(url, flow) {
  if (url.origin + url.pathname !== REDIRECT_URI) throw Error('Unexpected OAuth callback URL');
  for (const name of ['state', 'code', 'iss', 'error']) {
    if (url.searchParams.getAll(name).length > 1) throw Error('Duplicate OAuth callback parameter');
  }
  const state = Buffer.from(url.searchParams.get('state') || '');
  const expected = Buffer.from(flow.state);
  if (state.length !== expected.length || !timingSafeEqual(state, expected)) throw Error('OAuth state mismatch');
  const issuer = url.searchParams.get('iss');
  if ((flow.issuerRequired && !issuer) || (issuer !== null && issuer !== flow.issuer)) throw Error('OAuth callback issuer mismatch');
  if (url.searchParams.has('error')) throw Error('Firmable authorization was declined or failed');
  const code = url.searchParams.get('code');
  if (!code) throw Error('Missing OAuth authorization code');
  return code;
}

export class TokenStore {
  constructor(path = resolve(PRIVATE_DIR, 'tokens.json')) { this.path = path; }
  async load() {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async save(tokens) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.path), 0o700);
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(tokens), { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.path);
  }
}

export class OAuthSession {
  constructor(metadata, store = new TokenStore(), fetcher = fetch) {
    this.metadata = validateMetadata(metadata); this.store = store; this.fetcher = fetcher;
  }
  async exchange(parameters, previous = {}) {
    const body = new URLSearchParams({ ...parameters, client_id: CLIENT_ID, resource: RESOURCE });
    const response = await this.fetcher(this.metadata.token_endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!response.ok) throw Error(`OAuth token request failed (HTTP ${response.status}); login again`);
    const result = await response.json();
    if (!result.access_token || result.token_type?.toLowerCase() !== 'bearer'
      || !Number.isFinite(Number(result.expires_in)) || Number(result.expires_in) <= 0) {
      throw Error('Unexpected OAuth token response');
    }
    const tokens = { ...previous, ...result, issuer: ISSUER, client_id: CLIENT_ID,
      expires_at: Date.now() + Number(result.expires_in) * 1000 };
    await this.store.save(tokens);
    return tokens.access_token;
  }
  async accessToken() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const tokens = await this.store.load();
      if (!tokens) throw Error('Firmable is not authenticated; run the adapter login command');
      if (tokens.issuer !== ISSUER || tokens.client_id !== CLIENT_ID) throw Error('Saved OAuth identity mismatch; login again');
      if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
      if (!tokens.refresh_token) throw Error('OAuth token expired without a refresh token; login again');
      return this.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, tokens);
    })();
    try { return await this.refreshing; } finally { this.refreshing = undefined; }
  }
}

export function companyArguments(name, args = {}) {
  if (!ALLOWED_TOOLS.has(name)) throw Error('This adapter only permits company search and company profiles');
  if (['ai_search', 'filter_search', 'get_filter_options'].includes(name)) {
    if (args.category && args.category !== 'company') throw Error('People data is disabled in this adapter');
    if (name === 'get_filter_options' && !COMPANY_FILTERS.has(args.identifier)) throw Error('Only company filter options are enabled');
    return { ...args, category: 'company' };
  }
  return args;
}

async function login(metadata, store) {
  const flow = makeFlow(metadata);
  const session = new OAuthSession(metadata, store);
  let accepting = true;
  let finish, fail;
  const completion = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (!accepting || request.method !== 'GET' || request.headers.host !== 'localhost:3334'
      || new URL(request.url, REDIRECT_URI).pathname !== '/oauth/callback') {
      response.writeHead(404); response.end('Not found'); return;
    }
    let code;
    try { code = validateCallback(new URL(request.url, REDIRECT_URI), flow); }
    catch { response.writeHead(400); response.end('Invalid OAuth callback. Retry login from the terminal.'); return; }
    accepting = false;
    try {
      await session.exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: flow.verifier });
      response.end('Firmable connected. You can close this tab and return to Codex.'); finish();
    } catch (error) {
      response.writeHead(502); response.end('Token exchange failed. See the terminal for the HTTP status.'); fail(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3334, 'localhost', resolve);
  });
  const timer = setTimeout(() => fail(Error('Login timed out after five minutes; retry login')), 300_000);
  const interrupt = () => fail(Error('Login cancelled'));
  process.once('SIGINT', interrupt);
  console.error(`Opening Firmable sign-in; callback is ${REDIRECT_URI}.`);
  const browser = spawn('/usr/bin/open', [flow.url.toString()], { stdio: 'ignore' });
  browser.once('error', () => fail(Error('Could not open the browser')));
  try { await completion; console.error('Firmable OAuth login completed. Tokens saved in the ignored private directory.'); }
  finally { clearTimeout(timer); process.off('SIGINT', interrupt); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

async function connect(metadata, store) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const session = new OAuthSession(metadata, store);
  await session.accessToken();
  const client = new Client({ name: 'acquire-firmable-company-adapter', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: async (url, init) => {
      if (new URL(url).href !== MCP_URL) throw Error('Unexpected MCP request destination');
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${await session.accessToken()}`);
      const response = await fetch(url, { ...init, headers, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(30_000) });
      if (!response.ok) throw Error(`Firmable MCP HTTP ${response.status}`);
      return response;
    },
  });
  try { await client.connect(transport); return client; }
  catch (error) { await client.close().catch(() => {}); throw Error(`Firmable MCP connection failed: ${safeError(error)}`); }
}

function safeError(error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  // Do not forward provider response bodies or authorization material to logs.
  const status = message.match(/\b(?:HTTP\s*)?([45]\d\d)\b/);
  if (status) return `HTTP ${status[1]}`;
  if (/token|authorization|bearer/i.test(message)) return 'Authentication failed; retry login';
  return message.split('\n')[0].slice(0, 180);
}

async function companyTools(client) {
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools.filter(tool => ALLOWED_TOOLS.has(tool.name)));
    cursor = page.nextCursor;
  } while (cursor);
  return tools.map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: {
    ...tool.inputSchema.properties,
    ...(['ai_search', 'filter_search', 'get_filter_options'].includes(tool.name)
      ? { category: { type: 'string', enum: ['company'], default: 'company' } } : {}),
  } } }));
}

async function smoke(client) {
  const tools = await companyTools(client);
  console.log(JSON.stringify({ connected: true, companyTools: tools.map(t => t.name) }));
  for (const name of ['get_workflow_guide', 'ai_search', 'get_company']) {
    if (!tools.some(tool => tool.name === name)) throw Error(`Expected company tool is missing: ${name}`);
  }
  const guide = await client.callTool({ name: 'get_workflow_guide', arguments: {} });
  if (guide.isError) throw Error('Firmable workflow guide failed');
  const search = await client.callTool({ name: 'ai_search', arguments: {
    query: 'Commonwealth Bank of Australia', country: 'AU', category: 'company',
  } });
  const company = await client.callTool({ name: 'get_company', arguments: { domain: 'commbank.com.au' } });
  await mkdir(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(resolve(PRIVATE_DIR, 'company-smoke.json'), JSON.stringify({ capturedAt: new Date().toISOString(), search, company }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ aiSearch: !search.isError, companyLookup: !company.isError,
    evidence: '.local-data/firmable-mcp-adapter/company-smoke.json', peopleCalls: 0 }));
  if (search.isError || company.isError) throw Error('A company smoke check failed; inspect private evidence');
}

async function stdio(client) {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const server = new Server({ name: 'firmable-company-local', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await companyTools(client) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const args = companyArguments(request.params.name, request.params.arguments);
      return await client.callTool({ name: request.params.name, arguments: args });
    } catch (error) { return { isError: true, content: [{ type: 'text', text: safeError(error) }] }; }
  });
  server.onclose = () => { void client.close(); };
  await server.connect(new StdioServerTransport());
}

async function main() {
  const command = process.argv[2] || 'check';
  if (!['check', 'login', 'smoke', 'stdio', 'tools'].includes(command)) throw Error('Use check, login, tools, smoke or stdio');
  const metadata = await discover();
  const store = new TokenStore();
  if (command === 'check') {
    console.log(JSON.stringify({ issuer: metadata.issuer, callback: REDIRECT_URI,
      authenticated: Boolean((await store.load())?.access_token), peopleData: 'disabled' })); return;
  }
  if (command === 'login') return login(metadata, store);
  const client = await connect(metadata, store);
  if (command === 'stdio') return stdio(client);
  try {
    if (command === 'tools') console.log(JSON.stringify({ tools: (await companyTools(client)).map(t => t.name) }));
    else await smoke(client);
  } finally { await client.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
}
