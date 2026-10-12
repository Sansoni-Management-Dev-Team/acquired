import { createHash, randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { assertSameBinding, type AccessScope, type Channel, type Platform, type ConnectionBinding } from '../../contracts/src';
import type { SqlPool, SqlClient } from './webhook-repository';

export interface AuthStateSnapshot {
  scope: AccessScope;
  channel: Channel;
  platform: Platform;
  backend: 'unipile';
  redirectOrigin: string;
  createdAt: string;
  expiresAt: string;
  expectedConnectionId: string;
  expectedGeneration: number;
  reconnectBinding?: ConnectionBinding;
}
export interface AuthStateRepositoryOptions {
  /** release(error) MUST physically retire/terminate the checked-out session, as pg.PoolClient does.
   * Returning that connection to the pool cannot safely implement timeout/callback isolation. */
  pool: SqlPool;
  scope: AccessScope;
  channel: Channel;
  platform: Platform;
  backend: 'unipile';
  redirectOrigin: string;
  ttlSeconds?: number;
  allowLoopbackRedirect?: boolean;
  authenticationTimeoutMs?: number;
  transactionTimeoutMs?: number;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  /** Required backend authentication AND exact notification-name/state correlation to this ephemeral nonce.
   * Never accept a boolean authority claim in the callback body; never log this input. */
  authenticateNotification(input: Readonly<{ nonce: string; notification: unknown }>): Promise<boolean>;
  /** Trusted server composition only: verify actual provider identity/ownership and persist the exact
   * account/connection/generation through this client. Never treat callback account IDs as ownership proof.
   * The supplied client permits one SELECT/INSERT/UPDATE/WITH statement per call; transaction control,
   * direct role statements, multiple statements and release are forbidden. This is not an SQL sandbox:
   * SELECT/WITH functions may have side effects. Await queries sequentially; the callback client expires
   * when the callback settles. Sessions are discarded after binding. Parameterize data.
   * This repository cannot perform or certify provider verification and provides no default binder. */
  bindNotification(client: SqlClient, state: Readonly<AuthStateSnapshot>, notification: unknown): Promise<ConnectionBinding>;
}
export type AuthCompletion = { status: 'completed'; binding: ConnectionBinding } |
  { status: 'consumed'; binding?: ConnectionBinding; needsReconciliation?: true } |
  { status: 'rejected'; code: 'unauthenticated' | 'invalid' | 'expired' | 'forbidden' | 'reconnect_changed' };
const scopeFields = ['applicationId','tenantId','ownerId'];
const bindingFields = [...scopeFields,'connectionId','accountId','generation','channel','platform','backend'];
const id = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
function fail(): never { throw Error('Auth-state repository unavailable'); }
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string,unknown> = {};
  if (required.some(key => !Object.hasOwn(descriptors,key)) || Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' ||
      ![...required,...optional].includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail();
  for (const key of Object.keys(descriptors)) result[key] = descriptors[key].value;
  return result;
}
function date(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== 'string') fail();
  const parsed = new Date(value).getTime(); if (!Number.isFinite(parsed)) fail(); return new Date(parsed).toISOString();
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }

/** Generic persisted setup authorization, not a hosted-auth HTTP route or live provider owner verifier.
 * Nonces never enter SQL. Exact deterministic result addresses make lost-response replay read-only;
 * a later generation never replaces the recorded original result. No migration or provider fallback. */
export function createPostgresAuthStateRepository(options: AuthStateRepositoryOptions) {
  let scope: AccessScope;
  try {
    const fixed = record(options.scope,scopeFields);
    if (scopeFields.some(key => !id(fixed[key]))) fail();
    scope = { applicationId: fixed.applicationId as string, tenantId: fixed.tenantId as string, ownerId: fixed.ownerId as string };
  } catch { throw Error('Invalid auth-state repository configuration'); }
  const channel = options.channel, platform = options.platform, backend = options.backend, redirectOrigin = options.redirectOrigin;
  const ttlSeconds = options.ttlSeconds ?? 600;
  const authenticationTimeoutMs = options.authenticationTimeoutMs ?? 3000, transactionTimeoutMs = options.transactionTimeoutMs ?? 20_000;
  const statementTimeoutMs = options.statementTimeoutMs ?? 5000, lockTimeoutMs = options.lockTimeoutMs ?? 1000;
  let redirectSafe = false;
  try {
    const url = new URL(redirectOrigin);
    redirectSafe = url.origin === redirectOrigin && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
      (url.protocol === 'https:' || options.allowLoopbackRedirect === true && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  } catch { /* Configuration errors never include URLs or credentials. */ }
  if (backend !== 'unipile' || !redirectSafe || redirectOrigin.length > 2000 ||
      !(channel === 'email' && ['gmail','outlook','imap'].includes(platform) || channel === 'whatsapp' && platform === 'whatsapp' || channel === 'linkedin' && platform === 'linkedin') ||
      !Number.isSafeInteger(authenticationTimeoutMs) || authenticationTimeoutMs < 1 || authenticationTimeoutMs > 5000 ||
      !Number.isSafeInteger(transactionTimeoutMs) || transactionTimeoutMs < 1 || transactionTimeoutMs > 25_000 || authenticationTimeoutMs + transactionTimeoutMs >= 30_000 ||
      !Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > transactionTimeoutMs ||
      !Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > statementTimeoutMs ||
      !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600 || typeof options.pool?.connect !== 'function' ||
      typeof options.authenticateNotification !== 'function' || typeof options.bindNotification !== 'function') throw Error('Invalid auth-state repository configuration');
  const connect = options.pool.connect.bind(options.pool), authenticate = options.authenticateNotification.bind(options), bind = options.bindNotification.bind(options);
  const scopeValues = [scope.applicationId,scope.tenantId,scope.ownerId];
  function binding(value: unknown): ConnectionBinding {
    const raw = record(value,bindingFields);
    if (bindingFields.some(key => key !== 'generation' && !id(raw[key])) || !Number.isSafeInteger(raw.generation) || Number(raw.generation) < 1 || Number(raw.generation) > 2_147_483_647 ||
        raw.applicationId !== scope.applicationId || raw.tenantId !== scope.tenantId || raw.ownerId !== scope.ownerId || raw.channel !== channel || raw.platform !== platform || raw.backend !== backend) fail();
    const result = raw as unknown as ConnectionBinding; assertSameBinding(result,result); return structuredClone(result);
  }
  async function grant(client: SqlClient): Promise<boolean> {
    const result = await client.query(`SELECT application_id,tenant_id,owner_id FROM communications.access_grants
 WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,[...scopeValues]);
    return result.rows.length === 1 && result.rows[0].application_id === scope.applicationId && result.rows[0].tenant_id === scope.tenantId && result.rows[0].owner_id === scope.ownerId;
  }
  async function lookup(client: SqlClient, connectionId: string, generation: number, current: boolean, updateLock = false): Promise<ConnectionBinding | null> {
    const result = await client.query(`SELECT c.id AS connection_id,c.application_id,c.tenant_id,c.owner_id,c.channel,c.platform,c.backend,
 c.current_generation,c.account_id AS current_account_id,c.active,c.status,g.generation,g.account_id,g.authority,g.provider_api_version,
 g.provider_configuration_reference,g.provider_account_digest,g.encrypted_provider_account_id,g.provider_account_key_version
 FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=$5
 WHERE c.application_id=$1 AND c.tenant_id=$2 AND c.owner_id=$3 AND c.id=$4 AND c.channel=$6 AND c.platform=$7 AND c.backend=$8
 FOR ${updateLock ? 'UPDATE OF c FOR SHARE OF g' : 'SHARE OF c,g'}`,[...scopeValues,connectionId,generation,channel,platform,backend]);
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) fail();
    const row = result.rows[0];
    if (row.connection_id !== connectionId || row.generation !== generation || row.authority !== 'service' || !['v1','v2'].includes(String(row.provider_api_version)) || !id(row.provider_configuration_reference,2000) ||
        typeof row.provider_account_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.provider_account_digest) ||
        !id(row.encrypted_provider_account_id,2_200_000) || !id(row.provider_account_key_version) ||
        current && (row.current_generation !== generation || row.current_account_id !== row.account_id || row.active !== true || !['connected','syncing','disconnected','verification_required'].includes(String(row.status)))) return null;
    return binding({ applicationId:row.application_id,tenantId:row.tenant_id,ownerId:row.owner_id,connectionId:row.connection_id,accountId:row.account_id,
      generation:row.generation,channel:row.channel,platform:row.platform,backend:row.backend });
  }
  async function transaction<T>(work: (client: SqlClient, retireBindingSession: () => void) => Promise<T>): Promise<T> {
    let client: SqlClient | undefined, commitAttempted = false, timedOut = false, released = false, binderUsed = false, inFlight = 0, discard: Error | undefined;
    const dispose = () => {
      if (!client || released) return;
      released = true;
      try { if (discard || binderUsed || timedOut) client.release(discard ?? Error('Auth-state binding session retired')); else client.release(); }
      catch { /* Keep session errors private; never return an uncertain binding result. */ }
    };
    const deadline = performance.now() + transactionTimeoutMs;
    const expire = () => { timedOut = true; discard = Error('Auth-state database session unavailable'); dispose(); };
    const assertLive = () => { if (timedOut || performance.now() >= deadline) { expire(); fail(); } if (released) fail(); };
    const run = async () => {
      try {
        assertLive();
        client = await connect();
        assertLive();
        const query: SqlClient['query'] = client.query.bind(client);
        const tx: SqlClient = { async query<Row=Record<string,unknown>>(text:string,values?:unknown[]) {
          assertLive();
          if (inFlight !== 0) fail();
          if (text === 'COMMIT') commitAttempted = true;
          inFlight++;
          try {
            const result = await query<Row>(text,values);
            assertLive();
            return result;
          } finally { inFlight--; }
        }, release() {} };
        await tx.query('BEGIN'); await tx.query('SET LOCAL ROLE communications_control');
        const role = await tx.query(`SELECT current_user AS role_name,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user`);
        if (role.rows.length !== 1 || role.rows[0].role_name !== 'communications_control' || role.rows[0].rolsuper !== false || role.rows[0].rolbypassrls !== false || role.rows[0].rolcanlogin !== false) fail();
        await tx.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",[`${lockTimeoutMs}ms`,`${statementTimeoutMs}ms`]);
        const result = await work(tx,() => { assertLive(); binderUsed = true; });
        assertLive();
        return result;
      } catch (error) {
        if (performance.now() >= deadline) expire();
        if (inFlight !== 0) { discard = Error('Auth-state database session unavailable'); dispose(); }
        if (commitAttempted || error && typeof error === 'object' && 'code' in error && /^(?:08[A-Z0-9]{3}|57P0[123]|ECONNRESET|ETIMEDOUT|EPIPE)$/.test(String(error.code))) discard = Error('Auth-state database session unavailable');
        // On deadline, disposing the physical connection terminates its transaction. Never race
        // ROLLBACK against the binder's in-flight query or allow its continuation to issue SQL.
        if (client && !timedOut && !released) { try { await client.query('ROLLBACK'); } catch { discard = Error('Auth-state database session unavailable'); } }
        return fail();
      } finally { dispose(); }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve,reject) => {
        timer = setTimeout(() => { expire(); reject(Error('Auth-state repository unavailable')); },transactionTimeoutMs);
      });
      // Attach both rejection handlers and the timer before calling externally supplied code.
      return await Promise.race([Promise.resolve().then(run),timeout]);
    } finally { clearTimeout(timer); }
  }
  async function authenticated(nonce: string, notification: unknown): Promise<boolean> {
    const deadline = performance.now() + authenticationTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve,reject) => {
        timer = setTimeout(() => reject(Error('Auth-state repository unavailable')),authenticationTimeoutMs);
      });
      const checked = Promise.resolve().then(async () => {
        if (performance.now() >= deadline) fail();
        const result = await authenticate(Object.freeze({nonce,notification:structuredClone(notification)}));
        if (performance.now() >= deadline) fail();
        return result === true;
      });
      return await Promise.race([checked,timeout]);
    } finally { clearTimeout(timer); }
  }
  function expectedId(digest: string) { return `auth-${hash(JSON.stringify(['communications.auth.connection.v1',digest,...scopeValues,channel,platform,backend]))}`; }
  function freeze(state: AuthStateSnapshot): Readonly<AuthStateSnapshot> {
    Object.freeze(state.scope); if (state.reconnectBinding) Object.freeze(state.reconnectBinding); return Object.freeze(state);
  }
  return {
    async issue(input: { reconnectBinding?: ConnectionBinding } = {}) {
      let reconnect: ConnectionBinding | undefined;
      try { const fields = record(input,[],['reconnectBinding']); if (fields.reconnectBinding !== undefined) reconnect = binding(fields.reconnectBinding); } catch { return fail(); }
      const nonce = randomBytes(32).toString('base64url'), digest = hash(nonce);
      return transaction(async client => {
        if (!await grant(client)) fail();
        if (reconnect) { const actual = await lookup(client,reconnect.connectionId,reconnect.generation,true); if (!actual) fail(); assertSameBinding(reconnect,actual); if (reconnect.generation >= 2_147_483_647) fail(); }
        const inserted = await client.query(`INSERT INTO communications.auth_states
 (state_digest,application_id,tenant_id,owner_id,channel,platform,backend,redirect_origin,reconnect_connection_id,reconnect_generation,created_at,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp(),clock_timestamp()+($11::double precision * interval '1 second')) RETURNING expires_at`,
          [digest,...scopeValues,channel,platform,backend,redirectOrigin,reconnect?.connectionId ?? null,reconnect?.generation ?? null,ttlSeconds]);
        if (inserted.rows.length !== 1 || !await grant(client)) fail();
        const expiresAt = date(inserted.rows[0].expires_at);
        await client.query('COMMIT');
        return { nonce, expiresAt, expectedConnectionId: reconnect?.connectionId ?? expectedId(digest), expectedGeneration: reconnect ? reconnect.generation + 1 : 1 };
      });
    },
    async complete(input: { nonce: string; notification: unknown }): Promise<AuthCompletion> {
      let nonce: string, notification: unknown;
      try { const fields = record(input,['nonce','notification']); if (typeof fields.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(fields.nonce)) return {status:'rejected',code:'invalid'}; nonce = fields.nonce; notification = structuredClone(fields.notification); }
      catch { return {status:'rejected',code:'invalid'}; }
      try { if (!await authenticated(nonce,notification)) return {status:'rejected',code:'unauthenticated'}; } catch { return fail(); }
      const digest = hash(nonce);
      return transaction(async (client,retireBindingSession) => {
        if (!await grant(client)) { await client.query('ROLLBACK'); return {status:'rejected',code:'forbidden'}; }
        const selected = await client.query(`SELECT state_digest,application_id,tenant_id,owner_id,channel,platform,backend,redirect_origin,
 reconnect_connection_id,reconnect_generation,created_at,expires_at,consumed_at,(expires_at>clock_timestamp()) AS alive
 FROM communications.auth_states WHERE state_digest=$1 AND application_id=$2 AND tenant_id=$3 AND owner_id=$4 FOR UPDATE`,[digest,...scopeValues]);
        if (selected.rows.length !== 1) { await client.query('ROLLBACK'); return {status:'rejected',code:'invalid'}; }
        const row = selected.rows[0];
        if (row.state_digest !== digest || row.application_id !== scope.applicationId || row.tenant_id !== scope.tenantId || row.owner_id !== scope.ownerId ||
            row.channel !== channel || row.platform !== platform || row.backend !== backend || row.redirect_origin !== redirectOrigin) { await client.query('ROLLBACK'); return {status:'rejected',code:'invalid'}; }
        const reconnectId = row.reconnect_connection_id, reconnectGeneration = row.reconnect_generation;
        if ((reconnectId === null) !== (reconnectGeneration === null) || reconnectId !== null && (!id(reconnectId) || !Number.isSafeInteger(reconnectGeneration) || Number(reconnectGeneration) < 1 || Number(reconnectGeneration) >= 2_147_483_647)) fail();
        const connectionId = reconnectId === null ? expectedId(digest) : reconnectId as string;
        const generation = reconnectGeneration === null ? 1 : Number(reconnectGeneration) + 1;
        if (row.consumed_at !== null) {
          const original = await lookup(client,connectionId,generation,false);
          if (!await grant(client)) { await client.query('ROLLBACK'); return {status:'rejected',code:'forbidden'}; }
          await client.query('COMMIT');
          return original ? {status:'consumed',binding:original} : {status:'consumed',needsReconciliation:true};
        }
        if (row.alive !== true) { await client.query('ROLLBACK'); return {status:'rejected',code:'expired'}; }
        let original: ConnectionBinding | undefined;
        if (reconnectId !== null) {
          const current = await lookup(client,reconnectId as string,Number(reconnectGeneration),true,true);
          if (!current) { await client.query('ROLLBACK'); return {status:'rejected',code:'reconnect_changed'}; }
          original = current;
        }
        const state = freeze({scope:structuredClone(scope),channel,platform,backend:'unipile',redirectOrigin,createdAt:date(row.created_at),expiresAt:date(row.expires_at),expectedConnectionId:connectionId,expectedGeneration:generation,...(original ? {reconnectBinding:structuredClone(original)} : {})});
        // The binder composes data writes inside this transaction; it never owns transaction lifecycle.
        let bindingOpen = true;
        const bindingQueries: Promise<unknown>[] = [];
        const bindingClient: SqlClient = Object.freeze({
          query<Row=Record<string,unknown>>(text:string,values?:unknown[]) {
            let request: ReturnType<SqlClient['query']>;
            try {
              if (!bindingOpen || typeof text !== 'string' || text.length > 100_000) fail();
              const statement = text.trim().replace(/;$/, '').trim();
              if (statement.includes(';') || !/^(?:SELECT|INSERT|UPDATE|WITH)\b/i.test(statement)) fail();
              request = client.query(statement,values);
            } catch { request = Promise.reject(Error('Auth-state repository unavailable')); }
            // Observe the EXACT returned promise. An async wrapper would create a second rejected
            // outer promise if a trusted callback forgets to await it before session disposal.
            void request.catch(() => undefined);
            if (bindingOpen) bindingQueries.push(request);
            return request as Promise<{ rows: Row[]; rowCount?: number | null }>;
          },
          release() { fail(); },
        });
        retireBindingSession();
        let bound: unknown;
        try { bound = await bind(bindingClient,state,structuredClone(notification)); } finally { bindingOpen = false; }
        await Promise.all(bindingQueries);
        const returned = binding(bound);
        if (returned.connectionId !== connectionId || returned.generation !== generation || original && returned.accountId !== original.accountId) fail();
        const persisted = await lookup(client,connectionId,generation,true);
        if (!persisted) fail(); assertSameBinding(returned,persisted);
        if (!await grant(client)) { await client.query('ROLLBACK'); return {status:'rejected',code:'forbidden'}; }
        const consumed = await client.query(`UPDATE communications.auth_states SET consumed_at=clock_timestamp()
 WHERE state_digest=$1 AND application_id=$2 AND tenant_id=$3 AND owner_id=$4 AND consumed_at IS NULL
 AND expires_at>clock_timestamp() RETURNING state_digest`,[digest,...scopeValues]);
        if (consumed.rows.length !== 1) { await client.query('ROLLBACK'); return {status:'rejected',code:'expired'}; }
        if (consumed.rows[0].state_digest !== digest || !await grant(client)) fail();
        await client.query('COMMIT'); return {status:'completed',binding:persisted};
      });
    },
  };
}
