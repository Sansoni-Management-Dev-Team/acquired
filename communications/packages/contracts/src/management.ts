import { assertSameBinding, type AccessScope, type Capabilities, type Channel, type ConnectionBinding, type ConnectionStatus, type Platform, type Readiness } from './index';

export interface ManagedConnection {
  binding: ConnectionBinding;
  label: string;
  status: ConnectionStatus;
  capabilities: Capabilities;
  readiness: Readiness;
  isDefault: boolean;
  /** Always emitted by current services; absent on older v1 servers means unknown/read-only. */
  active?: boolean;
}
export interface ConnectionManagementSnapshot { available: boolean; connections: ManagedConnection[]; checkedAt: string }
export interface ConnectionSetupRequest { channel: Channel; platform: Platform; reconnectBinding?: ConnectionBinding }
export type ConnectionSetupResponse = { status: 'redirect'; action: { type: 'redirect'; url: string; expiresAt: string } } | { status: 'rejected'; code: 'invalid' | 'provider_rejected' } | { status: 'unavailable' | 'unknown' };
export type ConnectionDisconnectResponse = { status: 'disconnected' | 'unknown' | 'rejected' | 'review'; code?: string };
export interface ConnectionManagementPort {
  list(scope: AccessScope): Promise<ConnectionManagementSnapshot>;
  setup(scope: AccessScope, input: ConnectionSetupRequest): Promise<ConnectionSetupResponse>;
  status(scope: AccessScope, binding: ConnectionBinding): Promise<ManagedConnection>;
  disconnect(scope: AccessScope, input: { binding: ConnectionBinding; key: string }): Promise<ConnectionDisconnectResponse>;
  setDefault(scope: AccessScope, binding: ConnectionBinding): Promise<ManagedConnection>;
}
function invalid(): never { throw Error('Invalid connection management response'); }
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some(k => !Object.hasOwn(descriptors, k)) || Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k) || !('value' in descriptors[k]) || !descriptors[k].enumerable)) invalid();
  return Object.fromEntries(Object.entries(descriptors).map(([k, d]) => [k, d.value]));
}
function timestamp(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid(); }
function booleans(value: unknown, fields: string[]) { const o = object(value, fields); if (fields.some(k => typeof o[k] !== 'boolean')) invalid(); }
export function assertManagedConnection(value: unknown, scope?: AccessScope): asserts value is ManagedConnection {
  const o = object(value, ['binding', 'label', 'status', 'capabilities', 'readiness', 'isDefault'], ['active']);
  if(Object.hasOwn(o,'active')&&typeof o.active!=='boolean')invalid();
  object(o.binding, ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend']);
  const b = o.binding as ConnectionBinding; assertManagementBinding(b, scope ?? b);
  if (typeof o.label !== 'string' || !o.label.trim() || o.label.length > 200 || /[\u0000-\u001f\u007f]/.test(o.label) || typeof o.isDefault !== 'boolean' || !['connecting', 'connected', 'syncing', 'verification_required', 'disconnected', 'failed'].includes(String(o.status))) invalid();
  const c = object(o.capabilities, ['messaging', 'events'], ['email', 'linkedin']);
  booleans(c.messaging, ['send', 'durableIdempotency', 'receiptLookup']); booleans(c.events, ['read', 'history', 'realtime']);
  if (c.email !== undefined) { if (b.channel !== 'email') invalid(); booleans(c.email, ['drafts', 'threading', 'rfcMessageId']); }
  if (c.linkedin !== undefined) { if (b.channel !== 'linkedin') invalid(); booleans(c.linkedin, ['resolveProfile', 'relationships', 'invitations']); }
  const r = object(o.readiness, ['status'], ['code', 'retryAt']);
  if (r.status === 'ready') { if (o.active===false || r.code !== undefined || r.retryAt !== undefined || o.status !== 'connected') invalid(); }
  else if (r.status === 'waiting') { if (!['incomplete', 'stale', 'busy', 'timeout', 'rate_limited', 'unavailable', 'identity_pending'].includes(String(r.code))) invalid(); if (r.retryAt !== undefined) timestamp(r.retryAt); }
  else if (r.status === 'review') { if (!['reconnect', 'account_changed', 'protocol', 'unexpected', 'delivery_disabled', 'unresolved_send', 'unsupported', 'forbidden', 'operation_conflict'].includes(String(r.code)) || r.retryAt !== undefined) invalid(); }
  else invalid();
}
export function assertManagementSnapshot(value: unknown, scope?: AccessScope): asserts value is ConnectionManagementSnapshot {
  const o = object(value, ['available', 'connections', 'checkedAt']);
  if (typeof o.available !== 'boolean' || !Array.isArray(o.connections) || o.connections.length > 100 || !o.available && o.connections.length) invalid();
  timestamp(o.checkedAt);
  const seen = new Set<string>(), defaults = new Set<string>();
  for (const c of o.connections) { assertManagedConnection(c, scope); if (seen.has(c.binding.connectionId)) invalid(); seen.add(c.binding.connectionId); if (c.isDefault) { if (defaults.has(c.binding.channel)) invalid(); defaults.add(c.binding.channel); } }
}
/** Explicit test setting; never inferred from an untrusted hosted redirect. */
export function localSimulatorHostedOrigin(value:string):string {
 const u=new URL(value);
 if(u.protocol!=='https:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.origin!==value||u.username||u.password)invalid();
 return u.origin;
}
export interface HostedDemoCapability{capability:'hosted-demo';origin:string}
/** Trusted deployment setting, never inferred from provider/request data. */
export function captureHostedDemoCapability(raw:unknown):HostedDemoCapability{
 const value=object(raw,['capability','origin']);if(value.capability!=='hosted-demo'||typeof value.origin!=='string')invalid();
 const u=new URL(value.origin);if(u.protocol!=='https:'||u.origin!==value.origin||u.username||u.password||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':')||/\.(?:localhost|local|internal|test)$/.test(u.hostname))invalid();
 return{capability:'hosted-demo',origin:u.origin};
}
export function assertManagementSetupResponse(value: unknown,options?:{localSimulatorOrigin?:string;hostedDemo?:HostedDemoCapability}): asserts value is ConnectionSetupResponse {
 if(options?.localSimulatorOrigin!==undefined&&options.hostedDemo!==undefined)invalid();
 const origin=options?.hostedDemo!==undefined?captureHostedDemoCapability(options.hostedDemo).origin:options?.localSimulatorOrigin===undefined?'https://account.unipile.com':localSimulatorHostedOrigin(options.localSimulatorOrigin);
 const o=object(value,['status'],['action','code']);
 if(o.status==='redirect'){
  if(o.code!==undefined)invalid();const a=object(o.action,['type','url','expiresAt']);timestamp(a.expiresAt);
  if(a.type!=='redirect'||typeof a.url!=='string'||a.url.length>8192||Date.parse(a.expiresAt as string)<=Date.now())invalid();
  const u=new URL(a.url);if(u.origin!==origin||u.username||u.password||u.hash)invalid();return;
 }
 if(o.action!==undefined)invalid();
 if(['unknown','unavailable'].includes(String(o.status))&&o.code===undefined)return;
 if(o.status==='rejected'&&['invalid','provider_rejected'].includes(String(o.code)))return;invalid();
}
export function assertManagementDisconnectResponse(value:unknown):asserts value is ConnectionDisconnectResponse {
 const o=object(value,['status'],['code']);if(!['disconnected','unknown','rejected','review'].includes(String(o.status)))invalid();
 if(o.code!==undefined&&(typeof o.code!=='string'||!/^[a-z_]{1,80}$/.test(o.code)||['disconnected','unknown'].includes(String(o.status))))invalid();
}
export function assertManagementBinding(binding: ConnectionBinding, scope: AccessScope) {
  assertSameBinding(binding, binding);
  if (binding.backend !== 'unipile' || binding.applicationId !== scope.applicationId || binding.tenantId !== scope.tenantId || binding.ownerId !== scope.ownerId) throw Error('Invalid connection scope');
}
