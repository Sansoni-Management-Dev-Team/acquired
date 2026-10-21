import {beforeEach,describe,expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
const m=vi.hoisted(()=>({attach:vi.fn(),repository:vi.fn(),drizzle:vi.fn()}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class{constructor(org:string,db:unknown){m.repository(org,db);}attachMany=m.attach;}}));
vi.mock('drizzle-orm/node-postgres',()=>({drizzle:m.drizzle}));
import {selectCachedDemoResearch,attachCachedDemoResearch,type CachedDemoResearchSelection} from './cached-demo-research';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor={organizationId:'org-owned',userId:'owner'},sourceId=id(1),targetId=id(2),contactId=id(3),demoId=id(4);
const brief={...emptyBrief(),name:'Saved refrigeration mandate',naturalLanguage:'Commercial refrigeration in Queensland'};
function fixture(companyCount=3,initialContacts=60){
 let selection:CachedDemoResearchSelection|undefined,sourceRevision='17',targetRevision='21',cachedSource=false,demoMode='demo',demoOwner=actor.userId,sourceOwner=actor.userId,contactCount=initialContacts;
 const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
  void values;
  if(sql.includes('cached-demo-candidates'))return{rows:[{id:sourceId}],rowCount:1};
  if(sql.includes('cached-demo-source'))return{rows:[{id:sourceId,filters:{brief},revision:sourceRevision,createdBy:sourceOwner,cached:cachedSource,successfulResearch:true}],rowCount:1};
  if(sql.includes('cached-demo-targets'))return{rows:Array.from({length:companyCount},(_,index)=>({id:index?id(index+9):targetId,revision:targetRevision,firmableId:'f'+(123+index)})),rowCount:companyCount};
  if(sql.includes('cached-demo-contacts'))return{rows:Array.from({length:contactCount},(_,index)=>({id:index? id(index+100):contactId,targetId:index%companyCount?id(index%companyCount+9):targetId,revision:'31'})),rowCount:contactCount};
  if(sql.includes('cached-demo-destination'))return{rows:[{id:demoId,revision:'55',createdBy:demoOwner,mode:demoMode,demoId,modeCreatedBy:demoOwner,metadata:{creationRevision:'55',initialResearch:{source:'cached',creationRevision:'55',cachedDemo:{selection}}}}],rowCount:1};
  if(sql.includes('FROM member'))return{rows:[{id:'membership'}],rowCount:1};
  return{rows:[],rowCount:0};
 });
 const release=vi.fn(),client={query,release},pool={query,connect:vi.fn(async()=>client)};
 return{pool,client,query,release,setSelection:(v:CachedDemoResearchSelection)=>{selection=v;},changeSource:()=>{sourceRevision='18';},changeTarget:()=>{targetRevision='22';},cacheSource:()=>{cachedSource=true;},realDestination:()=>{demoMode='real';},foreignDestination:()=>{demoOwner='foreign';},foreignSource:()=>{sourceOwner='foreign';},overflowContacts:()=>{contactCount=1001;}};
}
beforeEach(()=>{vi.clearAllMocks();m.drizzle.mockImplementation(({client})=>({client}));vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('No provider request is permitted');}));});
describe('cached demo application action',()=>{
 it.each([[2,19],[2,100],[3,49]])('excludes a small saved source from fresh demo selection (%s companies, %s people)',async(companies,people)=>{
  const f=fixture(companies,people);expect(await selectCachedDemoResearch(f.pool as never,actor)).toBeUndefined();expect(await selectCachedDemoResearch(f.pool as never,actor,{sourceMandateId:sourceId})).toBeUndefined();expect(globalThis.fetch).not.toHaveBeenCalled();expect(m.attach).not.toHaveBeenCalled();
 });
 it('accepts the exact minimum of three canonical companies and fifty eligible saved people',async()=>{
  const f=fixture(3,50);expect(await selectCachedDemoResearch(f.pool as never,actor)).toMatchObject({companyCount:3,peopleCount:50});
 });
 it('keeps an existing small demo retry attached to its original immutable selection',async()=>{
  const f=fixture(2,19),selection={version:1 as const,sourceMandateId:sourceId,sourceMandateRevision:'17',brief,targetIds:[targetId,id(10)],companyCount:2,peopleCount:19,sourceDigest:''};
  // Obtain the original pre-policy evidence digest through the unchanged source
  // verification path used by attachment, then prove attachment ignores the new
  // admission threshold without relaxing revision or identity verification.
  const frame={version:1,sourceMandateId:sourceId,sourceMandateRevision:'17',brief,targets:[{id:targetId,revision:'21',firmableId:'f123'},{id:id(10),revision:'21',firmableId:'f124'}],people:Array.from({length:19},(_,index)=>({id:index?id(index+100):contactId,targetId:index%2?id(10):targetId,revision:'31'}))};
  const{agentRecordDigest}=await import('@/db/agent-store');selection.sourceDigest=agentRecordDigest(frame);f.setSelection(selection);expect(await attachCachedDemoResearch(f.pool as never,actor,demoId,selection)).toMatchObject({companyCount:2,peopleCount:19});
 });

 it('orders saved sources by this actor’s oldest cached-demo creation use, with never-used sources first and stable tie breakers',async()=>{
  const f=fixture();await selectCachedDemoResearch(f.pool as never,actor);
  const [sql,params]=f.query.mock.calls.find(([value])=>value.includes('cached-demo-candidates'))!;
  expect(sql).toContain('max(demo_use.created_at) AS last_used_at');
  expect(sql).toContain('demo_use.organization_id=m.organization_id');
  expect(sql).toContain('demo_use.actor_id=$2');
  expect(sql).toContain("demo_use.action='agent.mandate_created'");
  expect(sql).toContain("demo_use.entity_type='mandate'");
  expect(sql).toContain("demo_use.metadata->'initialResearch'->>'source'='cached'");
  expect(sql).toContain("demo_use.metadata->'initialResearch'->'cachedDemo'->'selection'->>'sourceMandateId'=m.id::text");
  expect(sql).toMatch(/ORDER BY demo_usage.last_used_at ASC NULLS FIRST,[\s\S]+m.created_at DESC,m.id/);
  expect(params).toEqual([actor.organizationId,actor.userId,3,50]);
  expect(f.query.mock.calls.every(([statement])=>statement.includes('SELECT')&&!/\b(?:INSERT|UPDATE|DELETE)\b/.test(statement))).toBe(true);
  expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it('respects an explicit frozen source selection without consulting usage or consuming a rotation turn',async()=>{
  const f=fixture(),selection=await selectCachedDemoResearch(f.pool as never,actor,{sourceMandateId:sourceId});
  expect(selection?.sourceMandateId).toBe(sourceId);
  expect(f.query.mock.calls.some(([sql])=>sql.includes('cached-demo-candidates'))).toBe(false);
  expect(f.query.mock.calls.every(([sql])=>!sql.includes('demo_use')&&!/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
  expect(m.attach).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it('selects an owned saved brief and canonical company/People identities without any provider call',async()=>{
  const f=fixture(),selection=await selectCachedDemoResearch(f.pool as never,actor);
  expect(selection).toMatchObject({version:1,sourceMandateId:sourceId,sourceMandateRevision:'17',brief,targetIds:[targetId,id(10),id(11)],companyCount:3,peopleCount:60,sourceDigest:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(globalThis.fetch).not.toHaveBeenCalled();expect(m.attach).not.toHaveBeenCalled();
  const [query,params]=f.query.mock.calls.find(([s])=>s.includes('cached-demo-candidates'))!;
  expect(query).toContain('m.created_by=$2');expect(query).toContain("'cached'");expect(params).toEqual([actor.organizationId,actor.userId,3,50]);
  expect(JSON.stringify(selection)).not.toContain('personalData');expect(JSON.stringify(selection)).not.toContain(contactId);
 });
 it('attaches the existing canonical company IDs through the normal command inside the same transaction',async()=>{
  const f=fixture(),selection=(await selectCachedDemoResearch(f.pool as never,actor))!;f.setSelection(selection);
  expect(await attachCachedDemoResearch(f.pool as never,actor,demoId,selection)).toEqual({sourceMandateId:sourceId,companyCount:3,peopleCount:60});
  expect(m.repository).toHaveBeenCalledWith(actor.organizationId,{client:f.client});expect(m.attach).toHaveBeenCalledWith(demoId,[targetId,id(10),id(11)]);
  const sql=f.query.mock.calls.map(([s])=>s);expect(sql).toContain('BEGIN');expect(sql).toContain('COMMIT');expect(sql).not.toContain('ROLLBACK');
  expect(sql.some(s=>/INSERT INTO (?:targets|contacts|research_jobs|company_identity_observations)/i.test(s))).toBe(false);
  expect(f.release).toHaveBeenCalledOnce();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it.each(['changeSource','changeTarget'] as const)('fails closed before attachment when saved source evidence changes: %s',async change=>{
  const f=fixture(),selection=(await selectCachedDemoResearch(f.pool as never,actor))!;f.setSelection(selection);f[change]();
  await expect(attachCachedDemoResearch(f.pool as never,actor,demoId,selection)).rejects.toThrow(/changed|unavailable/i);
  expect(m.attach).not.toHaveBeenCalled();expect(f.query.mock.calls.map(([s])=>s)).toContain('ROLLBACK');expect(f.release).toHaveBeenCalledOnce();
 });
 it.each(['realDestination','foreignDestination'] as const)('rejects a destination outside the owned demo scope: %s',async change=>{
  const f=fixture(),selection=(await selectCachedDemoResearch(f.pool as never,actor))!;f.setSelection(selection);f[change]();
  await expect(attachCachedDemoResearch(f.pool as never,actor,demoId,selection)).rejects.toThrow();expect(m.attach).not.toHaveBeenCalled();
 });
 it('does not recursively select an earlier cached demo as the research source',async()=>{
  const f=fixture();f.cacheSource();expect(await selectCachedDemoResearch(f.pool as never,actor)).toBeUndefined();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it.each(['foreignSource','overflowContacts'] as const)('returns unavailable without provider fallback for an unsafe source: %s',async change=>{
  const f=fixture();f[change]();expect(await selectCachedDemoResearch(f.pool as never,actor)).toBeUndefined();expect(m.attach).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it('does not reinterpret a forged selection as the immutable cached-demo intent',async()=>{
  const f=fixture(),selection=(await selectCachedDemoResearch(f.pool as never,actor))!;f.setSelection(selection);
  await expect(attachCachedDemoResearch(f.pool as never,actor,demoId,{...selection,sourceDigest:'f'.repeat(64)})).rejects.toThrow();expect(m.attach).not.toHaveBeenCalled();
 });
});
