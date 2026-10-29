import{afterEach,expect,it,vi}from'vitest';
import{CommunicationsClient}from'../../communications/packages/sdk/src';
afterEach(()=>vi.useRealTimers());
it('gives only submit the explicit longer budget while ordinary calls retain their deadline',async()=>{
 vi.useFakeTimers();const signals:AbortSignal[]=[];const client=new CommunicationsClient({baseUrl:'https://demo.example',contractVersion:'1',apiKey:'test',timeoutMs:28000,submitTimeoutMs:55000,fetch:async(_url,init)=>{signals.push(init!.signal as AbortSignal);return await new Promise<Response>(()=>{});}});
 const send=client.submit({} as never),health=expect(client.health()).rejects.toThrow();
 await vi.advanceTimersByTimeAsync(28001);expect(signals[0].aborted).toBe(false);expect(signals[1].aborted).toBe(true);await health;
 await vi.advanceTimersByTimeAsync(27000);expect(signals[0].aborted).toBe(true);expect(await send).toEqual({status:'unknown'});
});
it('rejects an unbounded submit timeout',()=>{
 for(const submitTimeoutMs of[0,60001,NaN])expect(()=>new CommunicationsClient({baseUrl:'https://demo.example',contractVersion:'1',apiKey:'test',submitTimeoutMs})).toThrow();
});
