import {it,expect,vi} from 'vitest';
import {queueAgentCommunicationChange,queueAgentEmailBounce} from './agent-communications-events';
const input={bindingId:'10000000-0000-4000-8000-000000000001',serviceEventId:'service-event',receiptFingerprint:'a'.repeat(64),changeFingerprint:'a'.repeat(64),sender:'peer@example.invalid',providerMessageId:'provider-message',occurredAt:'2026-10-17T00:00:00.000Z',reviewRequired:false};
it('supports older application schemas without treating malformed readiness as compatibility',async()=>{const query=vi.fn(async()=>({rows:[{installed:false}]}));expect(await queueAgentCommunicationChange({query} as never,input)).toBe(0);expect(query).toHaveBeenCalledTimes(1);query.mockResolvedValue({rows:[]});await expect(queueAgentCommunicationChange({query} as never,input)).rejects.toThrow();});
it('passes exact body-free service metadata only into the held transaction helper',async()=>{const query=vi.fn().mockResolvedValueOnce({rows:[{installed:true}]}).mockResolvedValueOnce({rows:[{queued:1}]});expect(await queueAgentCommunicationChange({query} as never,input)).toBe(1);expect(query.mock.calls[1][1]).toEqual(Object.values(input));expect(JSON.stringify(query.mock.calls)).not.toContain('body');});
it('propagates outbox failure and malformed helper results so the consumer rolls back before acknowledgement',async()=>{for(const result of [async()=>{throw Error('Outbox failed');},async()=>({rows:[{queued:'1'}]})]){const query=vi.fn().mockResolvedValueOnce({rows:[{installed:true}]}).mockImplementationOnce(result);await expect(queueAgentCommunicationChange({query} as never,input)).rejects.toThrow();}});

const failure={bindingId:input.bindingId,serviceEventId:input.serviceEventId,receiptFingerprint:input.receiptFingerprint,changeFingerprint:input.changeFingerprint,recipient:input.sender,providerMessageId:input.providerMessageId,occurredAt:input.occurredAt,receiptPreimage:'synthetic-body-free-proof'};
it('keeps the original UI independent only when both native bounce helper and native module are provably absent',async()=>{
 const query=vi.fn(async()=>({rows:[{installed:false,native_schema:false}]}));expect(await queueAgentEmailBounce({query} as never,failure)).toBe(0);expect(query).toHaveBeenCalledTimes(1);
});
it('requires atomic bounce handling whenever the native module exists and fails closed on unknown catalog evidence',async()=>{
 for(const rows of [[{installed:false,native_schema:true}],[],[{installed:false}],[{installed:'false',native_schema:false}],[{installed:false,native_schema:null}]]){const query=vi.fn(async()=>({rows}));await expect(queueAgentEmailBounce({query} as never,failure)).rejects.toThrow();expect(query).toHaveBeenCalledTimes(1);}
});
it('uses the installed bounce helper in the same transaction with the exact bounded original receipt preimage',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{installed:true,native_schema:true}]}).mockResolvedValueOnce({rows:[{queued:1}]});expect(await queueAgentEmailBounce({query} as never,failure)).toBe(1);expect(query.mock.calls[1][1]).toEqual(Object.values(failure));
});
