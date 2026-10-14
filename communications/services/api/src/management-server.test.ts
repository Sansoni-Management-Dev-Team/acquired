import { afterEach, expect, it, vi } from 'vitest';
import { createCommunicationsServer } from './server';
import { CommunicationsClient } from '../../../packages/sdk/src';
import type { ManagedConnection } from '../../../packages/contracts/src/management';
const scope = { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner' };
const connection: ManagedConnection = { binding: { ...scope, connectionId: 'c', accountId: 'a', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' }, label: 'owner@example.test', status: 'syncing', capabilities: { messaging: { send: true, durableIdempotency: true, receiptLookup: true }, events: { read: true, history: true, realtime: true } }, readiness: { status: 'waiting', code: 'incomplete' }, isDefault: false };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function fixture() {
 const management = { list: vi.fn(async () => ({ available: true, connections: [connection], checkedAt: '2026-10-14T00:00:00.000Z' })), setup: vi.fn(async () => ({ status: 'redirect' as const, action: { type: 'redirect' as const, url: 'https://account.unipile.com/fixture', expiresAt: new Date(Date.now()+60000).toISOString() } })), status: vi.fn(async () => connection), disconnect: vi.fn(async () => ({ status: 'disconnected' as const })), setDefault: vi.fn(async () => ({ ...connection, isDefault: true })) };
 const server = createCommunicationsServer({ authorize: async r => r.headers.authorization === 'Bearer fixture' ? scope : null, connections: { get: vi.fn(async () => null) }, resolveAdapter: vi.fn(), management });
 await new Promise<void>(r => server.listen(0,'127.0.0.1',r)); const a=server.address(); if(!a||typeof a==='string')throw Error('No listener');
 closers.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
 const baseUrl=`http://127.0.0.1:${a.port}`;return {management,baseUrl,client:new CommunicationsClient({baseUrl,apiKey:'fixture',contractVersion:'1',allowLoopbackHttp:true})};
}
it('lists, starts setup, checks status, selects a default and retires through the independent service', async()=>{
 const f=await fixture(); expect((await f.client.connections(scope)).connections).toEqual([connection]);
 expect(await f.client.setupConnection(scope,{channel:'email',platform:'gmail'})).toMatchObject({status:'redirect'});
 expect(await f.client.connectionStatus(connection.binding)).toEqual(connection);
 expect(await f.client.setDefaultConnection(connection.binding)).toMatchObject({isDefault:true});
 expect(await f.client.disconnectConnection(connection.binding,'one-original-key')).toEqual({status:'disconnected'});
 expect(f.management.setup).toHaveBeenCalledWith(scope,{channel:'email',platform:'gmail'});
 expect(f.management.disconnect).toHaveBeenCalledWith(scope,{binding:connection.binding,key:'one-original-key'});
});
it('rejects forged scope, unsupported platform and private response fields',async()=>{
 const f=await fixture(); const headers={authorization:'Bearer fixture','x-communications-contract-version':'1','content-type':'application/json'};
 for(const [body,status] of [[{binding:{...connection.binding,ownerId:'other'}},403],[{binding:connection.binding,providerAccountId:'private'},400]] as const) expect((await fetch(f.baseUrl+'/v1/connections/status',{method:'POST',headers,body:JSON.stringify(body)})).status).toBe(status);
 expect((await fetch(f.baseUrl+'/v1/connections/setup',{method:'POST',headers,body:JSON.stringify({channel:'email',platform:'whatsapp'})})).status).toBe(400);
 expect((await fetch(f.baseUrl+'/v1/connections/setup',{method:'POST',headers,body:JSON.stringify({channel:'email',platform:['gmail']})})).status).toBe(400);
 expect(f.management.status).not.toHaveBeenCalled(); expect(f.management.setup).not.toHaveBeenCalled();
 f.management.list.mockResolvedValueOnce({available:true,connections:[{...connection,apiKey:'private'}],checkedAt:'2026-10-14T00:00:00.000Z'} as never);
 await expect(f.client.connections(scope)).rejects.toThrow();
});
it('does not retry ambiguous setup or disconnect responses',async()=>{
 const f=await fixture(); f.management.setup.mockRejectedValueOnce(Error('private vendor failure'));f.management.disconnect.mockRejectedValueOnce(Error('private vendor failure'));
 expect(await f.client.setupConnection(scope,{channel:'email',platform:'gmail'})).toEqual({status:'unknown'});
 expect(await f.client.disconnectConnection(connection.binding,'same-key')).toEqual({status:'unknown'});
 expect(f.management.setup).toHaveBeenCalledTimes(1);expect(f.management.disconnect).toHaveBeenCalledTimes(1);
});
it('never exposes unexpected private fields or an unsafe hosted redirect on management responses',async()=>{
 const f=await fixture(),headers={authorization:'Bearer fixture','x-communications-contract-version':'1','content-type':'application/json'};
 f.management.setup.mockResolvedValueOnce({status:'unknown',apiKey:'private-fixture-key'} as never);
 const response=await fetch(f.baseUrl+'/v1/connections/setup',{method:'POST',headers,body:JSON.stringify({channel:'email',platform:'gmail'})});expect(response.status).toBe(500);expect(await response.text()).not.toContain('private-fixture-key');
 f.management.disconnect.mockResolvedValueOnce({status:'disconnected',credentials:'private-fixture-key'} as never);
 const retired=await fetch(f.baseUrl+'/v1/connections/disconnect',{method:'POST',headers,body:JSON.stringify({binding:connection.binding,key:'same-original-key'})});expect(retired.status).toBe(500);expect(await retired.text()).not.toContain('private-fixture-key');
 f.management.setup.mockResolvedValueOnce({status:'redirect',action:{type:'redirect',url:'https://other.example/unsafe',expiresAt:new Date(Date.now()+60000).toISOString()}});
 expect(await f.client.setupConnection(scope,{channel:'email',platform:'gmail'})).toEqual({status:'unknown'});
});
