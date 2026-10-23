import {expect,it} from 'vitest';
import {reserveAgentBudget,settleAgentBudget,releaseAgentBudget,modelBudgetUpperBound} from './agent-budget';
const account={id:'account',unit:'usd_micro' as const,cap:'100',spent:'20',reserved:'30',windowStart:'2026-10-17T00:00:00Z',windowEnd:'2026-10-18T00:00:00Z'};
const request={operationId:'operation',accountId:'account',unit:'usd_micro' as const,amount:'50'};
const now='2026-10-17T10:00:00Z';
it('counts outstanding reservations and admits only the remaining cap',()=>{
 const result=reserveAgentBudget(account,request,now);expect(result.account.reserved).toBe('80');
 expect(()=>reserveAgentBudget(account,{...request,amount:'51'},now)).toThrow('budget');
});
it('replays the same reservation without charging again, and refuses changed-key scope',()=>{
 const first=reserveAgentBudget(account,request,now);
 expect(reserveAgentBudget(first.account,request,now,first.reservation)).toEqual(first);
 expect(()=>reserveAgentBudget(first.account,{...request,amount:'49'},now,first.reservation)).toThrow('different');
});
it('holds unknown usage, settles known cost once and records overruns honestly',()=>{
 const first=reserveAgentBudget(account,request,now);
 const unknown={...first.reservation,state:'uncertain' as const};
 const settled=settleAgentBudget(first.account,unknown,'60');expect(settled.account.spent).toBe('80');expect(settled.account.reserved).toBe('30');expect(settled.overrun).toBe('10');
 expect(settleAgentBudget(settled.account,settled.reservation,'60')).toEqual({...settled,overrun:'0'});
 expect(()=>settleAgentBudget(settled.account,settled.reservation,'20')).toThrow('different');
});
it('releases only a positively reconciled no-submission, never an unknown send',()=>{
 const first=reserveAgentBudget(account,request,now);
 expect(()=>releaseAgentBudget(first.account,first.reservation,{operationId:'other',resolutionId:'resolution',evidenceDigest:'a'.repeat(64)})).toThrow();
 const released=releaseAgentBudget(first.account,first.reservation,{operationId:'operation',resolutionId:'resolution',evidenceDigest:'a'.repeat(64)});expect(released.account.reserved).toBe('30');expect(released.reservation.state).toBe('released');
});
it('rejects invalid time, expired windows, negative amounts and cross-unit reservations',()=>{
 for(const time of ['invalid','2026-10-18T00:00:00Z','2026-10-16T10:00:00Z'])expect(()=>reserveAgentBudget(account,request,time)).toThrow();
 for(const change of [{amount:'-1'},{amount:'0'},{amount:'0.2'},{unit:'calls'},{accountId:'other'}])expect(()=>reserveAgentBudget(account,{...request,...change} as never,now)).toThrow();
});
it('reserves for every bounded provider attempt and refuses an unknown price ceiling',()=>{
 expect(modelBudgetUpperBound({maxInputTokens:10000,maxOutputTokens:2000,inputPriceMicroUsdPerMillion:'100000',outputPriceMicroUsdPerMillion:'500000',maxAttempts:3})).toBe('6000');
 expect(()=>modelBudgetUpperBound({maxInputTokens:10000,maxOutputTokens:2000,inputPriceMicroUsdPerMillion:undefined,outputPriceMicroUsdPerMillion:'500000',maxAttempts:3})).toThrow('price');
});
it('does not revive an outstanding reservation after its budget window has expired',()=>{
 const first=reserveAgentBudget(account,request,now);
 expect(()=>reserveAgentBudget(first.account,request,'2026-10-18T00:00:00Z',first.reservation)).toThrow('window');
});
