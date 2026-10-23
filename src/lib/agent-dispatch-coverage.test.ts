import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const query=vi.hoisted(()=>vi.fn());
const transaction=vi.hoisted(()=>vi.fn(async(_actor:unknown,work:(c:unknown)=>unknown)=>work({query})));
vi.mock('@/db/campaign-client',()=>({withCampaignDb:transaction}));
import {readAgentDispatchCoverage} from './agent-dispatch-coverage';
const actor={organizationId:'org',userId:'owner'},now=Date.parse('2026-10-24T00:00:00.000Z');
const routes=[{bindingId:'a',historyObservedAt:new Date(now-10000).toISOString()},{bindingId:'b',historyObservedAt:new Date(now-5000).toISOString()}];
const rows=()=>routes.map(r=>({binding_id:r.bindingId,scope_digest:'a'.repeat(64),revision:'7',observed_at:new Date(now-10000),coverage_through:new Date(now-10000),updated_at:new Date(now-1000)}));
beforeEach(()=>{vi.clearAllMocks();query.mockResolvedValue({rows:rows()});});
it('returns exact coverage hints only after every original scope has caught up',async()=>{
 const result=await readAgentDispatchCoverage(actor,routes,'subscriber',now);
 expect(result).toEqual({scopes:routes.map(r=>({bindingId:r.bindingId,scopeDigest:'a'.repeat(64)})),pendingBindingId:null});
 expect(transaction).toHaveBeenCalledWith(actor,expect.any(Function),{readOnly:true});
 expect(query.mock.calls[0][1]).toEqual(['org','owner',['a','b'],'subscriber']);
});
it('selects one lagging projection without inventing a service revision',async()=>{
 const records=rows();records[0].revision='6';query.mockResolvedValue({rows:records});
 expect((await readAgentDispatchCoverage(actor,routes,'subscriber',now)).pendingBindingId).toBe('a');
 records[0].revision='7';records[0].updated_at=new Date(now-20000);
 expect((await readAgentDispatchCoverage(actor,routes,'subscriber',now)).pendingBindingId).toBeNull();
});
it.each(['missing','duplicate','foreign','stale','future','malformed']as const)('refuses %s scope hints rather than selecting another account',async kind=>{
 const records=rows();if(kind==='missing')records.pop();if(kind==='duplicate')records.push({...records[0]});if(kind==='foreign')records[0].binding_id='foreign';if(kind==='stale')records[0].observed_at=new Date(now-256000);if(kind==='future')records[0].coverage_through=new Date(now+1);if(kind==='malformed')records[0].scope_digest='invalid';query.mockResolvedValue({rows:records});
 await expect(readAgentDispatchCoverage(actor,routes,'subscriber',now)).rejects.toThrow();
});
