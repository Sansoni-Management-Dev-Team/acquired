import {expect,it} from 'vitest';
import {SavedMandateHttpAgent} from './agent-http-client';
import {HttpAgent} from '@ag-ui/client';
class Inspectable extends SavedMandateHttpAgent{prepare(input:Parameters<HttpAgent['run']>[0]){return this.requestInit(input);}}
it('sends only the latest question while preserving displayed saved history',()=>{
 const messages=Array.from({length:80},(_,index)=>({id:'m-'+index,role:'user' as const,content:index===79?'Latest question':'Earlier displayed history '+index+'x'.repeat(1000)}));
 const agent=new Inspectable({url:'/api/mandates/saved/agent',initialMessages:messages});
 const result=agent.prepare({threadId:'thread',runId:'run',state:{},messages,tools:[],context:[],forwardedProps:{}});
 const body=JSON.parse(result.body as string);expect(body.messages).toEqual([messages[79]]);expect((result.body as string).length).toBeLessThan(1000);expect(agent.messages).toHaveLength(80);expect(messages).toHaveLength(80);
});
