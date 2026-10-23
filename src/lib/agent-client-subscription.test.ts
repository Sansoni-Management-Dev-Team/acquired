import {expect,it,vi} from 'vitest';
import {HttpAgent} from '@ag-ui/client';
import {createAgentClientSubscription} from './agent-client-subscription';
it('subscribes to the existing AG-UI client without an enterprise React wrapper',()=>{
 const client=new HttpAgent({url:'/local-agent'}),store=createAgentClientSubscription(client),listener=vi.fn();
 expect(store.getSnapshot()).toBe(0);expect(store.getServerSnapshot()).toBe(0);
 const unsubscribe=store.subscribe(listener);client.setMessages([{id:'saved',role:'assistant',content:'A saved background update'}]);
 expect(listener).toHaveBeenCalled();expect(store.getSnapshot()).toBeGreaterThan(0);
 const previous=store.getSnapshot();client.setState({progress:'fixture'});expect(store.getSnapshot()).toBeGreaterThan(previous);
 const count=listener.mock.calls.length;unsubscribe();client.setMessages([]);expect(listener).toHaveBeenCalledTimes(count);
});
it('renders the existing server event protocol through the direct subscribed client',async()=>{
 const {SavedMandateHttpAgent}=await import('./agent-http-client');
 const client=new SavedMandateHttpAgent({url:'/local-agent'}),store=createAgentClientSubscription(client),listener=vi.fn(),unsubscribe=store.subscribe(listener);
 client.addMessage({id:'question',role:'user',content:'How is the saved work going?'});
 const threadId=client.threadId,runId='fixture-run';
 const events=[{type:'RUN_STARTED',threadId,runId},{type:'STATE_SNAPSHOT',snapshot:{phase:'fixture'}},{type:'TEXT_MESSAGE_START',messageId:'answer',role:'assistant'},{type:'TEXT_MESSAGE_CONTENT',messageId:'answer',delta:'The saved work needs your review.'},{type:'TEXT_MESSAGE_END',messageId:'answer'},{type:'RUN_FINISHED',threadId,runId}];
 client.fetch=async()=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
 await client.runAgent({runId});expect(client.messages.find(message=>message.id==='answer')?.content).toBe('The saved work needs your review.');expect(client.state).toEqual({phase:'fixture'});expect(listener).toHaveBeenCalled();unsubscribe();
});
