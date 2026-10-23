import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {readFileSync} from 'node:fs';
import {runBudgetedChatModel} from '../../lib/agent-chat-model';
import {nativeChatDecisionSchema} from '../../lib/agent-chat-plan';
import {createNativeModelDecision} from '../../lib/agent-model-decision';
const live=process.env.RUN_ANTHROPIC_SYNTHETIC==='true';
it.skipIf(!live)('validates real Haiku chat and outreach schemas against synthetic data only',async()=>{
 const line=readFileSync('.local-data/anthropic/credentials.env','utf8').trim();
 vi.stubEnv('ANTHROPIC_API_KEY',line.slice(line.indexOf('=')+1));vi.stubEnv('AGENT_AI_PROVIDER','anthropic');vi.stubEnv('AGENT_DECISION_MODEL','claude-haiku-5-5');
 try{
 const store={beginChatModel:vi.fn().mockResolvedValue({kind:'started',operationId:'synthetic-chat',fence:'1'}),finishChatModel:vi.fn(),beginNativeModel:vi.fn().mockResolvedValue({kind:'started',operationId:'synthetic-outreach',fence:'1'}),finishNativeModel:vi.fn()};
 const chat=await runBudgetedChatModel({store,threadId:'synthetic',answerOperationId:'synthetic',messages:[{role:'system',content:'Return a short hello with proposal kind none. This is a synthetic compatibility test.'},{role:'user',content:'Hello'}],schema:z.toJSONSchema(nativeChatDecisionSchema),validate:v=>nativeChatDecisionSchema.parse(v)});
 expect(chat.proposal.kind).toBe('none');
 const decide=createNativeModelDecision({store,threadId:'synthetic',requestKey:'synthetic'});
 const result=await decide({conversationId:'00000000-0000-4000-8000-000000000001',contextRevision:'a'.repeat(64),revision:1,driver:'agent',phase:'active',historyComplete:true,history:[],sources:[],mandate:{},guidance:[]} as unknown as Parameters<typeof decide>[0]);
 expect(['review','wait','stop','handoff']).toContain(result.action);
 for(const finish of [store.finishChatModel,store.finishNativeModel]){const receipt=finish.mock.calls[0][3];expect(receipt.model).toBe('claude-haiku-5-5');expect(receipt.usage.inputTokens).toBeGreaterThan(0);console.info('synthetic-live-receipt',JSON.stringify({model:receipt.model,usage:receipt.usage}));}
 }finally{vi.unstubAllEnvs();}
},90000);
