import { describe,expect,it,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createOutboxDeliveryWorker,type OutboxDelivery,type ApplicationReplyReceipt,type EventOutboxPort } from './outbox-delivery';
import type { ConnectionBinding } from '../../contracts/src';
const binding:ConnectionBinding={applicationId:'acquire',tenantId:'tenant',ownerId:'owner',connectionId:'conn',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
function delivery():OutboxDelivery{
  const scope=[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend],hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const event={type:'message' as const,reference:{binding:{...binding},id:'message'},direction:'inbound' as const,sender:{kind:'phone' as const,value:'+15550000001'},occurredAt:'2026-10-12T10:00:00.000Z'};
  const eventKey=hash(['communications.reply.event.v1',scope,null,event.reference.id]),fingerprint=hash(['communications.reply.content.v1',scope,event.reference.id,null,event.direction,event.sender.kind,event.sender.value,event.occurredAt]);
  return {binding:{...binding},subscriberId:'acquire',eventId:'1',sourceNamespace:'reply_message/v1',sourceEventKey:eventKey,payload:{outcome:{kind:'event',event,eventKey,fingerprint},fingerprint,receivedAt:'2026-10-12T10:01:00.000Z'},token:'lease-token'};
}
function fixture(){
  const d=delivery(),claim=vi.fn<EventOutboxPort['claim']>(async()=>({kind:'claimed',delivery:d})),acknowledge=vi.fn<EventOutboxPort['acknowledge']>(async()=>({status:'acknowledged'}));
  const apply=vi.fn(async(i:OutboxDelivery,signal:AbortSignal):Promise<ApplicationReplyReceipt>=>{void signal;return {binding:i.binding,subscriberId:i.subscriberId,eventId:i.eventId,fingerprint:i.payload.fingerprint,status:'committed'};});
  const options={binding:{...binding},subscriberId:'acquire',outbox:{claim,acknowledge},apply,timeoutMs:100};
  return {d,claim,acknowledge,apply,options};
}
describe('separate application commit and service acknowledgement',()=>{
  it('does not ACK until the application transaction resolves committed',async()=>{
    const f=fixture();let release!:()=>void;f.apply.mockImplementation(async i=>{await new Promise<void>(r=>release=r);return {binding:i.binding,subscriberId:i.subscriberId,eventId:i.eventId,fingerprint:i.payload.fingerprint,status:'committed'};});
    const p=createOutboxDeliveryWorker(f.options).run();await vi.waitFor(()=>expect(f.apply).toHaveBeenCalled());expect(f.acknowledge).not.toHaveBeenCalled();release();expect(await p).toEqual({status:'delivered'});
    expect(f.acknowledge).toHaveBeenCalledWith({delivery:f.d,receipt:expect.objectContaining({status:'committed'})});
  });
  it('ACKs an exact recovered application receipt after a lost response',async()=>{
    const f=fixture();f.apply.mockImplementation(async i=>({binding:i.binding,subscriberId:i.subscriberId,eventId:i.eventId,fingerprint:i.payload.fingerprint,status:'duplicate'}));
    expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'duplicate'});expect(f.acknowledge).toHaveBeenCalledOnce();
  });
  it.each(['busy','forbidden'] as const)('does not call the application for a %s claim',async kind=>{
    const f=fixture();f.claim.mockResolvedValue({kind});expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:kind});expect(f.apply).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it.each(['binding','subscriber','event','fingerprint','status','extra'] as const)('rejects a mismatched application %s before ACK',async field=>{
    const f=fixture();f.apply.mockImplementation(async i=>{const r:ApplicationReplyReceipt={binding:i.binding,subscriberId:i.subscriberId,eventId:i.eventId,fingerprint:i.payload.fingerprint,status:'committed'};
      if(field==='binding')r.binding={...r.binding,ownerId:'other'};if(field==='subscriber')r.subscriberId='other';if(field==='event')r.eventId='2';if(field==='fingerprint')r.fingerprint='f'.repeat(64);if(field==='status')return {...r,status:'accepted'} as unknown as ApplicationReplyReceipt;if(field==='extra')return {...r,secret:'unexpected'} as ApplicationReplyReceipt;return r;});
    expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it.each(['binding','subscriber','source','ciphertext_facts'] as const)('does not apply a corrupt %s claim',async field=>{
    const f=fixture();if(field==='binding')f.d.binding.ownerId='other';if(field==='subscriber')f.d.subscriberId='other';if(field==='source')f.d.sourceNamespace='unexpected';if(field==='ciphertext_facts')f.d.payload.fingerprint='f'.repeat(64);
    expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(f.apply).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it('does not ACK an application failure',async()=>{
    const f=fixture();f.apply.mockRejectedValue(Error('private database trace'));expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it('keeps an expired or revoked service acknowledgement retryable after app commit',async()=>{
    const f=fixture();f.acknowledge.mockResolvedValue({status:'rejected'});expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(f.apply).toHaveBeenCalledOnce();
  });
  it('recovers an already committed service ACK without another application effect',async()=>{
    const f=fixture();f.acknowledge.mockResolvedValue({status:'duplicate'});expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'duplicate'});
  });
  it('bounds a hanging application and never ACKs a late application commit',async()=>{
    const f=fixture();f.options.timeoutMs=10;let finish!:()=>void;let signal!:AbortSignal;
    f.apply.mockImplementation(async(i,s)=>{signal=s;await new Promise<void>(r=>finish=r);return {binding:i.binding,subscriberId:i.subscriberId,eventId:i.eventId,fingerprint:i.payload.fingerprint,status:'committed'};});
    expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(signal.aborted).toBe(true);finish();await Promise.resolve();expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it('rejects application mutation of its detached delivery',async()=>{
    const f=fixture();f.apply.mockImplementation(async i=>{i.payload.fingerprint='f'.repeat(64);return {binding:i.binding,subscriberId:i.subscriberId,eventId:i.eventId,fingerprint:i.payload.fingerprint,status:'committed'};});
    expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(f.d).toEqual(delivery());expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it('snapshots callbacks and original binding',async()=>{
    const f=fixture(),api=createOutboxDeliveryWorker(f.options);f.options.binding.ownerId='other';f.options.apply=vi.fn();f.options.outbox.acknowledge=vi.fn();
    expect(await api.run()).toEqual({status:'delivered'});expect(f.apply).toHaveBeenCalledOnce();expect(f.acknowledge).toHaveBeenCalledOnce();
  });
  it('does not invoke status coercion hooks',async()=>{
    const f=fixture(),hook=vi.fn(()=> 'committed');f.apply.mockImplementation(async i=>({binding:i.binding,subscriberId:i.subscriberId,eventId:i.eventId,fingerprint:i.payload.fingerprint,status:{toString:hook}} as unknown as ApplicationReplyReceipt));
    expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(hook).not.toHaveBeenCalled();expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it('handles a rejected application promise after a synchronous deadline overrun',async()=>{
    const f=fixture();f.options.timeoutMs=10;let unhandled=false;const listener=()=>{unhandled=true;};process.on('unhandledRejection',listener);
    try{
      f.apply.mockImplementation(()=>{const end=performance.now()+25;while(performance.now()<end){}return Promise.reject(Error('synthetic late rejection'));});
      expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(f.apply).toHaveBeenCalledOnce();
      await new Promise<void>(resolve=>setImmediate(resolve));expect(unhandled).toBe(false);expect(f.acknowledge).not.toHaveBeenCalled();
    }finally{process.removeListener('unhandledRejection',listener);}
  });
  it('bounds a hanging service claim without calling the application',async()=>{
    const f=fixture();f.options.timeoutMs=10;f.claim.mockImplementation(()=>new Promise(()=>{}));expect(await createOutboxDeliveryWorker(f.options).run()).toEqual({status:'retry'});expect(f.apply).not.toHaveBeenCalled();
  });
});
