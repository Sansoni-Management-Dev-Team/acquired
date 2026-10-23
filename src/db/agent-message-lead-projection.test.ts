import {afterEach,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
vi.mock('server-only',()=>({}));
import {AgentStore} from './agent-store';
const thread='11111111-1111-4111-8111-111111111111';
afterEach(()=>vi.restoreAllMocks());
function fixture(){
 const row={id:'message',role:'assistant',content:{text:'Saved status'},lead_name:'Saved person'},query=vi.fn(async()=>({rows:[row]}));
 const store=new AgentStore({}as never,{organizationId:'org',userId:'owner'}),internal=store as unknown as{transaction:<T>(fn:(c:PoolClient)=>Promise<T>)=>Promise<T>;thread:()=>Promise<unknown>};
 vi.spyOn(internal,'transaction').mockImplementation(fn=>fn({query}as unknown as PoolClient));
 const owned=vi.spyOn(internal,'thread').mockResolvedValue({id:thread});
 return{store,query,row,owned};
}
it('projects the saved lead name through the exact owned message conversation without guessing from channels',async()=>{
 const f=fixture();expect(await f.store.messages(thread,25)).toEqual([f.row]);expect(f.owned).toHaveBeenCalledWith(expect.anything(),thread);
 const call=f.query.mock.calls[0]as unknown as[string,unknown[]],sql=call[0];
 expect(call[1]).toEqual([thread,25]);
 expect(sql).toContain('person.display_name AS lead_name');
 expect(sql).toContain('v.id=COALESCE(');expect(sql).toContain("CASE WHEN recent.content->'details'->>'conversationId' ~");expect(sql).toContain('source.conversation_id');
 for(const clause of ['v.thread_id=recent.thread_id','v.organization_id=recent.organization_id','v.mandate_id=recent.mandate_id','v.owner_user_id=recent.owner_user_id','person.id=v.contact_id','person.organization_id=v.organization_id'])expect(sql).toContain(clause);
 expect(sql).not.toMatch(/recipient_email|personal_data|->>'conversationId'\s*::uuid/);
 expect(sql).toContain('ORDER BY sequence DESC LIMIT $2) recent');expect(sql).toContain('ORDER BY recent.sequence');
 expect(sql.match(/LEFT JOIN agent_conversations/g)).toHaveLength(1);expect(sql.match(/LEFT JOIN contacts/g)).toHaveLength(1);expect(sql).not.toContain('JOIN targets');
});
it('keeps missing-conversation names bound to exact original operations or handoff tasks, using indexed UUID joins only inside the bounded message page',async()=>{
 const f=fixture();await f.store.messages(thread,25);const [sql]=f.query.mock.calls[0]as unknown as[string,unknown[]];
 expect(sql).toContain('LEFT JOIN LATERAL');expect(sql).toContain("recent.request_key='no-submission:'||o.id::text");expect(sql).toContain("CASE WHEN recent.content->>'operationId' ~");expect(sql).toContain('o.id=CASE');expect(sql).toContain('h.id=CASE');
 for(const table of ['o','h'])for(const scope of ['thread_id','organization_id','mandate_id','owner_user_id'])expect(sql).toContain(`${table}.${scope}=recent.${scope}`);
 expect(sql).toContain("recent.content->'details'->>'conversationId' IS NULL");expect(sql).toContain('LIMIT 1');expect(sql).not.toContain('o.id::text=recent');expect(sql).not.toContain('h.id::text=recent');
});
it('resolves lead-specific review reasons only through an exact owned triggering event with a recorded conversation',async()=>{
 const f=fixture();await f.store.messages(thread,100);const [sql]=f.query.mock.calls[0]as unknown as[string,unknown[]];
 expect(sql).toContain('FROM agent_events e');expect(sql).toContain('e.id=CASE');expect(sql).toContain("recent.content->>'triggerEventId'");expect(sql).toContain("split_part(recent.request_key,':',2)=e.id::text");expect(sql).toContain("e.kind IN('conversation.reassess','conversation.history_changed','conversation.reminder','channel.due','email.reconcile','whatsapp.reconcile','linkedin.reconcile','review.approved','email.proposed','whatsapp.proposed','linkedin.proposed')");for(const scope of ['thread_id','organization_id','mandate_id','owner_user_id'])expect(sql).toContain(`e.${scope}=recent.${scope}`);
 expect(sql).toContain("e.kind IN('email.reconcile','whatsapp.reconcile','linkedin.reconcile','email.proposed','whatsapp.proposed','linkedin.proposed')");expect(sql).toContain('reconcile_operation.id=CASE');expect(sql).toContain('reconcile_operation.conversation_id');for(const scope of ['thread_id','organization_id','mandate_id','owner_user_id'])expect(sql).toContain(`reconcile_operation.${scope}=e.${scope}`);
 expect(sql).toContain("e.kind='review.approved' AND b.id=CASE");
 expect(sql).toContain("e.payload->>'reviewBatchId'");
 expect(sql).toContain('count(DISTINCT o.conversation_id)=1');
 expect(sql).toContain("o.id IN(SELECT (item->>'operationId')::uuid FROM jsonb_array_elements(b.manifest) item)");
 for(const scope of ['thread_id','organization_id','mandate_id','owner_user_id'])expect(sql).toContain(`b.${scope}=e.${scope}`);
});
it('keeps bounded chronological reads and refuses missing ownership before reading names',async()=>{
 const f=fixture();await expect(f.store.messages(thread,201)).rejects.toThrow();expect(f.query).not.toHaveBeenCalled();
 f.owned.mockRejectedValue(new Error('Agent thread not found'));await expect(f.store.messages(thread)).rejects.toThrow('not found');expect(f.query).not.toHaveBeenCalled();
});
