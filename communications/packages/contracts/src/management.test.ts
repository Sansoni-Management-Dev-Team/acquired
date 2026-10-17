import { expect, it } from 'vitest';
import { assertManagedConnection, assertManagementSnapshot, assertManagementSetupResponse } from './management';
const scope = { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner' };
const connection = () => ({ binding: { ...scope, connectionId: 'c', accountId: 'a', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' }, label: 'owner@example.test', status: 'syncing', capabilities: { messaging: { send: true, durableIdempotency: true, receiptLookup: true }, events: { read: true, history: true, realtime: true }, email: { drafts: false, threading: true, rfcMessageId: true } }, readiness: { status: 'waiting', code: 'incomplete' }, isDefault: false });
it('accepts an independently authorized syncing connection without inventing ready status', () => { const value = connection(); expect(() => assertManagedConnection(value, scope)).not.toThrow(); expect(value.readiness.status).toBe('waiting'); });
it('accepts an unavailable empty snapshot and an available scoped snapshot', () => { for (const available of [false, true]) expect(() => assertManagementSnapshot({ available, connections: available ? [connection()] : [], checkedAt: '2026-10-14T00:00:00.000Z' }, scope)).not.toThrow(); });
it.each(['providerAccountId', 'credentials', 'apiKey'])('rejects private field %s rather than returning it to the UI', field => { expect(() => assertManagedConnection({ ...connection(), [field]: 'private' }, scope)).toThrow(); });
it('rejects another owner, duplicate generations, false readiness and malformed timestamps', () => {
  const c = connection(); expect(() => assertManagedConnection({ ...c, binding: { ...c.binding, ownerId: 'other' } }, scope)).toThrow();
  expect(() => assertManagementSnapshot({ available: true, connections: [c, c], checkedAt: '2026-10-14T00:00:00.000Z' }, scope)).toThrow();
  expect(() => assertManagedConnection({ ...c, readiness: { status: 'ready', secret: 'private' } }, scope)).toThrow();
  expect(() => assertManagementSnapshot({ available: true, connections: [c], checkedAt: 'yesterday' }, scope)).toThrow();
});

it('hosted localhost redirect requires exact explicit HTTPS origin and rejects cross-port redirects',()=>{
 const origin='https://127.0.0.1:5490',value={status:'redirect',action:{type:'redirect',url:origin+'/hosted/fixture',expiresAt:new Date(Date.now()+60000).toISOString()}};
 expect(()=>assertManagementSetupResponse(value)).toThrow();expect(()=>assertManagementSetupResponse(value,{localSimulatorOrigin:origin})).not.toThrow();
 for(const localSimulatorOrigin of ['https://127.0.0.1:9999','http://127.0.0.1:5490','https://remote.example'])expect(()=>assertManagementSetupResponse(value,{localSimulatorOrigin})).toThrow();
});
