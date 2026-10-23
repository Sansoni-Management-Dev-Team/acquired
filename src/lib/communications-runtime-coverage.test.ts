import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import type {ConnectionBinding,EventQuery} from '../../communications/packages/contracts/src';
import type {HeldCoverageProjection} from './communications-coverage-projector';
const ports=vi.hoisted(()=>({history:vi.fn(),project:vi.fn(),revisions:[] as string[]}));
vi.mock('../../communications/packages/adapter-unipile/src/v1-history-runtime',()=>({createConfiguredUnipileV1History:ports.history}));
vi.mock('./communications-coverage-projector',()=>({createAcquireCoverageProjector:(o:{withCoverage:(q:EventQuery,w:(p:HeldCoverageProjection)=>Promise<void>)=>Promise<void>})=>({project:async(q:EventQuery)=>o.withCoverage(q,async p=>{ports.project(q);await p.revalidate();})})}));
import {createAcquireCommunicationsRuntime} from './communications-runtime';
import {JournalCodec} from '../../communications/packages/core/src/journal-codec';
import {createPostgresAccountRuntime} from '../../communications/packages/storage-postgres/src/account-runtime';
import {AccountRuntimeVault} from '../../communications/packages/storage-postgres/src/account-vault';
const selected=['email','whatsapp','linkedin'].map((channel,i)=>({bindingId:'binding-'+i,scopeDigest:String(i+1).repeat(64),binding:{applicationId:'acquire',tenantId:'org',ownerId:'user',connectionId:'connection-'+i,accountId:'account-'+i,generation:1,channel,platform:channel==='email'?'gmail':channel,backend:'unipile'} as ConnectionBinding}));
beforeEach(()=>{vi.clearAllMocks();ports.revisions=['33','33','33'];ports.history.mockImplementation(async({binding}:{binding:ConnectionBinding})=>({repository:{scopeDigest:()=>selected.find(x=>x.binding.channel===binding.channel)!.scopeDigest,withCoverage:async(_q:EventQuery,work:(p:HeldCoverageProjection)=>Promise<void>)=>work({serviceRevision:ports.revisions.shift()!,scopeDigest:selected.find(x=>x.binding.channel===binding.channel)!.scopeDigest,revalidate:async()=>{},signal:new AbortController().signal} as HeldCoverageProjection)}}));});
function fixture(){const query=vi.fn(async(sql:string,values:unknown[])=>sql.startsWith('SELECT current_user')?{rows:[{active_role:'acquire_campaign_user',rolsuper:false,rolbypassrls:false}]}:sql.includes('FROM public.member')?{rows:[{allowed:true}]}:sql.includes('FROM public.communication_bindings')?{rows:[{id:selected.find(x=>x.binding.connectionId===values[3])?.bindingId}]}:{rows:[]}),pool={connect:vi.fn(async()=>({query,release:vi.fn()}))},serviceQuery=vi.fn(async(sql:string,values:unknown[])=>sql.startsWith('SELECT current_user')?{rows:[{role_name:'communications_control',rolsuper:false,rolbypassrls:false,rolcanlogin:false}]}:sql.includes('communications.access_grants')?{rows:[{application_id:values[0],tenant_id:values[1],owner_id:values[2]}]}:{rows:[]}),servicePool={connect:vi.fn(async()=>({query:serviceQuery,release:vi.fn()}))},realStore=createPostgresAccountRuntime({applicationId:'acquire',integrationId:'fixture',providerConfigurationReference:'fixture-v1',pool:servicePool as never,vault:new AccountRuntimeVault({activeVersion:'v1',keys:[{version:'v1',encryptionKey:Buffer.alloc(32,6),digestKey:Buffer.alloc(32,7)}],identityKey:Buffer.alloc(32,8),identityKeyVersion:'v1'})}),requireGrant=vi.fn(realStore.requireGrant.bind(realStore)),host=createAcquireCommunicationsRuntime({unipile:{store:{requireGrant}} as never,serviceOptions:{applicationId:'acquire',pool,vault:{activeVersion:'v1',keys:[{version:'v1',encryptionKey:Buffer.alloc(32,1),digestKey:Buffer.alloc(32,2)}]}} as never,applicationPool:pool as never,applicationCodec:new JournalCodec({activeVersion:'v1',keys:[{version:'v1',encryptionKey:Buffer.alloc(32,3),digestKey:Buffer.alloc(32,4)}]}),scopedAuthKey:Buffer.alloc(32,5),subscriberId:'acquire-replies',quota:{account:{hour:10,day:20},application:{hour:30,day:40}}});return{host,requireGrant};}
it('reprojects all original account scopes at one verified tenant revision without provider history reads',async()=>{const f=fixture();expect(await f.host.revalidateAgentChannelCoverage(selected)).toEqual(selected.map(({bindingId,scopeDigest})=>({bindingId,scopeDigest})));expect(ports.project).toHaveBeenCalledTimes(3);expect(f.requireGrant).toHaveBeenCalled();for(const[q]of ports.project.mock.calls)expect(q).toMatchObject({scope:'account',since:'1970-01-01T00:00:00.000Z',cursor:null,refresh:true});});
it('fails closed if a genuine reply advances the tenant barrier between original coverage projections',async()=>{ports.revisions=['33','34','34'];await expect(fixture().host.revalidateAgentChannelCoverage(selected)).rejects.toThrow('changed');expect(ports.project).toHaveBeenCalledTimes(1);});
it('rejects substituted binding, scope, tenant or duplicated channel without stamping checkpoints',async()=>{for(const list of[[{...selected[0],bindingId:'substituted'}],[{...selected[0],scopeDigest:'a'.repeat(64)}],[selected[0],{...selected[1],binding:{...selected[1].binding,tenantId:'foreign'}}],[selected[0],selected[0]]]){await expect(fixture().host.revalidateAgentChannelCoverage(list)).rejects.toThrow();}expect(ports.project).not.toHaveBeenCalled();});

it('rejects revoked current service authority before any original coverage projection',async()=>{const f=fixture();f.requireGrant.mockRejectedValue(Error('Current service grant revoked'));await expect(f.host.revalidateAgentChannelCoverage(selected)).rejects.toThrow('revoked');expect(ports.project).not.toHaveBeenCalled();});

it('propagates only an authenticated busy cause for the exact original account and never projects it',async()=>{
 const {HistoryRefreshBusyError,isHistoryRefreshBusyError}=await import('../../communications/packages/core/src/history-refresh-busy');
 for(const original of [selected[0].binding,{...selected[0].binding,generation:2}]){
  const error=new HistoryRefreshBusyError(original);ports.history.mockResolvedValue({readAgentConversation:async()=>{throw error;}});
  const received=await fixture().host.readAgentChannelConversation(selected[0].binding,{kind:'email',value:'lead@example.invalid'}).catch(e=>e);
  expect(isHistoryRefreshBusyError(received)).toBe(original.generation===1);
 }
 expect(ports.project).not.toHaveBeenCalled();
});

it('does not convert cancellation or an unbranded serialized busy name into trusted pending provenance',async()=>{
 const {HistoryRefreshBusyError,isHistoryRefreshBusyError}=await import('../../communications/packages/core/src/history-refresh-busy');
 const controller=new AbortController(),error=new HistoryRefreshBusyError(selected[0].binding);
 ports.history.mockResolvedValue({readAgentConversation:async()=>{controller.abort();throw error;}});
 const cancelled=await fixture().host.readAgentChannelConversation(selected[0].binding,{kind:'email',value:'lead@example.invalid'},controller.signal).catch(e=>e);expect(isHistoryRefreshBusyError(cancelled)).toBe(false);
 ports.history.mockResolvedValue({readAgentConversation:async()=>{throw {name:'HistoryRefreshBusyError'};}});
 const forged=await fixture().host.readAgentChannelConversation(selected[0].binding,{kind:'email',value:'lead@example.invalid'}).catch(e=>e);expect(isHistoryRefreshBusyError(forged)).toBe(false);expect(ports.project).not.toHaveBeenCalled();
});
