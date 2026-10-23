import{beforeEach,expect,it,vi}from'vitest';
vi.mock('server-only',()=>({}));
import{emptyBrief}from'@/domain/acquisition';
import{agentRecordDigest}from'@/db/agent-store';
import{readCachedDemoStatus}from'./cached-demo-status';
const id='10000000-0000-4000-8000-000000000001',source='10000000-0000-4000-8000-000000000002',targets=[3,4,5].map(n=>`10000000-0000-4000-8000-00000000000${n}`),actor={organizationId:'org',userId:'owner'};
const selection={version:1,sourceMandateId:source,sourceMandateRevision:'3',brief:emptyBrief(),targetIds:targets,companyCount:3,peopleCount:50,sourceDigest:'a'.repeat(64)};
function fixture(presentation='agent'){
 const metadata={creationRevision:'9',inputDigest:agentRecordDigest({requestId:id,brief:selection.brief,executionMode:'demo',demoSourceMandateId:source}),initialResearch:{version:1,requestId:id,creationRevision:'9',source:'cached',presentation,cachedDemo:{selection}}};
 const row={metadata,mode:'demo',demoId:id,companies:3,threadId:'thread',responsibilityId:'responsibility'};
 const query=vi.fn().mockResolvedValue({rows:[row]});return{row,query,pool:{query},input:{requestId:id,sourceMandateId:source,presentation}};
}
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No provider work');}));});
it.each(['agent','workspace'])('opens only a complete owned %s demo using its immutable saved receipt',async presentation=>{
 const f=fixture(presentation);expect(await readCachedDemoStatus(f.pool as never,actor,f.input)).toEqual({status:'ready',id,revision:'9'});
 const[sql,values]=f.query.mock.calls[0];expect(values).toEqual([id,'org','owner']);for(const guard of ['m.created_by=$3','membership.user_id=$3','mode.created_by=$3','a.actor_id=m.created_by',"a.action='agent.mandate_created'"])expect(sql).toContain(guard);expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);expect(fetch).not.toHaveBeenCalled();
});
it('reports missing/revoked/foreign ownership without returning identifiers or creating anything',async()=>{const f=fixture();f.query.mockResolvedValueOnce({rows:[]});expect(await readCachedDemoStatus(f.pool as never,actor,f.input)).toEqual({status:'missing'});expect(f.query).toHaveBeenCalledOnce();});
it('waits for exact target attachment and the agent workspace initialization',async()=>{for(const change of [{companies:2},{threadId:null},{responsibilityId:null}]){const f=fixture();Object.assign(f.row,change);expect(await readCachedDemoStatus(f.pool as never,actor,f.input)).toEqual({status:'preparing'});}});
it('does not require agent initialization or change ownership when opening a table demo',async()=>{const f=fixture('workspace');Object.assign(f.row,{threadId:null,responsibilityId:null});expect(await readCachedDemoStatus(f.pool as never,actor,f.input)).toMatchObject({status:'ready'});});
it('refuses mismatched source, mode, presentation, receipt or revision',async()=>{
 for(const mutation of [(f:ReturnType<typeof fixture>)=>{f.input.sourceMandateId=id;},(f:ReturnType<typeof fixture>)=>{f.row.mode='real';},(f:ReturnType<typeof fixture>)=>{Object.assign(f.row.metadata,{executionMode:'real'});},(f:ReturnType<typeof fixture>)=>{f.row.demoId=source;},(f:ReturnType<typeof fixture>)=>{f.input.presentation='workspace';},(f:ReturnType<typeof fixture>)=>{f.row.metadata.inputDigest='bad';},(f:ReturnType<typeof fixture>)=>{f.row.metadata.initialResearch.creationRevision='10';}]){const f=fixture();mutation(f);await expect(readCachedDemoStatus(f.pool as never,actor,f.input)).rejects.toThrow('unavailable');}
});

it('refuses ambiguous saved ownership rather than selecting a row',async()=>{const f=fixture();f.query.mockResolvedValueOnce({rows:[f.row,f.row]});await expect(readCachedDemoStatus(f.pool as never,actor,f.input)).rejects.toThrow('unavailable');});
