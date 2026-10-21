import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {AgentThread} from './agent-store';
import {loadAgentReviewPeople} from './agent-review-people';
const id='00000000-0000-4000-8000-000000000001',thread={id:'thread',organization_id:'org',owner_user_id:'owner',mandate_id:'mandate'} as AgentThread;
it('projects company and role only for the selected contacts in the owned mandate without changing any source data',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[{id,name:'Rahul',company:'Acme Services',role:'Director',email:'must not project'}, {id:'foreign',name:'Foreign person'}]});
 expect(await loadAgentReviewPeople({query} as unknown as PoolClient,thread,[id,id])).toEqual([{id,name:'Rahul',company:'Acme Services',role:'Director'}]);
 const [sql,params]=query.mock.calls.find(([sql])=>sql.trim().startsWith('SELECT'))!;expect(params).toEqual(['thread',[id],'org']);
 for(const fragment of ['public.agent_owned_target_snapshot($1::uuid,$2::uuid[])',"candidate->>'contactId'",'c.organization_id=$3'])expect(sql).toContain(fragment);
 expect(query.mock.calls.map(([sql])=>sql).some(sql=>/INSERT|UPDATE|DELETE|JOIN targets/.test(sql))).toBe(false);
});
it('skips empty or invalid display identities without querying or guessing a company',async()=>{const query=vi.fn();expect(await loadAgentReviewPeople({query}as unknown as PoolClient,thread,[])).toEqual([]);expect(await loadAgentReviewPeople({query}as unknown as PoolClient,thread,['bad'])).toEqual([]);expect(query).not.toHaveBeenCalled();});

it('keeps an optional display lookup failure from aborting the exact review transaction',async()=>{const query=vi.fn(async(sql:string)=>{if(sql.trim().startsWith('SELECT'))throw Error('Scope changed');return{rows:[]};});expect(await loadAgentReviewPeople({query}as unknown as PoolClient,thread,[id])).toEqual([]);expect(query.mock.calls.map(([sql])=>sql)).toContain('ROLLBACK TO SAVEPOINT agent_review_display_people');expect(query.mock.calls.at(-1)?.[0]).toBe('RELEASE SAVEPOINT agent_review_display_people');});
