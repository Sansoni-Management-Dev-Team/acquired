import {expect,it,vi} from 'vitest';
import {AgentChatStore} from './agent-chat-store';

it('projects saved demo preparation and policy facts without selecting a recipient or account',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{installed:true}]}).mockResolvedValueOnce({rows:[{saved:true}]}).mockResolvedValueOnce({rows:[{approved_messages:0,next_at:null}]}),state={mandateRevision:'1',executionMode:'demo',responsibility:{id:'00000000-0000-4000-8000-000000000001',revision:1,state:'ready',mandate_revision:'1',mandate_id:'mandate'},demoContacts:{prepared:50,stale:0,outreachReady:true},conversations:[]};
 const store=Object.assign(Object.create(AgentChatStore.prototype),{executionState:vi.fn().mockResolvedValue(state),findThread:vi.fn().mockResolvedValue({id:'thread'}),targetDeliveryOptions:vi.fn().mockResolvedValue({simulationEnabled:true,bindings:[]}),nativeTransaction:vi.fn((run:(c:unknown)=>unknown)=>run({query})),thread:vi.fn().mockResolvedValue({id:'thread',organization_id:'org',owner_user_id:'user'})}) as AgentChatStore;
 const context=await store.nativeChatContext('thread','Is the outreach started?');
 expect(context).toMatchObject({conversation:null,delivery:null,outreach:{executionMode:'demo',demoContacts:{prepared:50,stale:0,outreachReady:true},channelPolicySaved:true,conversations:0}});
 expect(query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});
it('projects only the saved future send-window wait for approved messages without dispatch intents',async()=>{
 const nextAt='2030-01-06T22:00:00.000Z',query=vi.fn().mockResolvedValueOnce({rows:[{installed:true}]}).mockResolvedValueOnce({rows:[{saved:true}]}).mockResolvedValueOnce({rows:[{approved_messages:5,next_at:new Date(nextAt)}]}),state={mandateRevision:'1',executionMode:'demo',responsibility:{id:'00000000-0000-4000-8000-000000000001',revision:1,state:'ready',mandate_revision:'1',mandate_id:'mandate'},conversations:[]};
 const store=Object.assign(Object.create(AgentChatStore.prototype),{executionState:vi.fn().mockResolvedValue(state),findThread:vi.fn().mockResolvedValue({id:'thread'}),targetDeliveryOptions:vi.fn().mockResolvedValue({simulationEnabled:true,bindings:[]}),nativeTransaction:vi.fn((run:(c:unknown)=>unknown)=>run({query})),thread:vi.fn().mockResolvedValue({id:'thread',organization_id:'org',owner_user_id:'user'}),businessSql:()=> 'clock_timestamp()'}) as AgentChatStore;
 const context=await store.nativeChatContext('thread','When does outreach start?');
 expect(context?.outreach?.sendWindowWait).toEqual({approvedMessages:5,nextAt});
 const [sql,values]=query.mock.calls[2];expect(values).toEqual(['thread','org','user']);
 for(const fragment of ["e.state='pending'","last_run.state='waiting'","last_run.stop_reason='Waiting for the next permitted sending window.'","p.accelerated_simulation IS FALSE","e.available_at>clock_timestamp()","o.state='approved'","NOT EXISTS(SELECT 1 FROM communication_dispatch_intents","ORDER BY r.created_at DESC,r.id DESC LIMIT 1"])expect(sql).toContain(fragment);
});
