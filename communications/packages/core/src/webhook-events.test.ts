import { describe, expect, it, vi } from 'vitest';
import type { CommunicationEvent, ConnectionBinding } from '../../contracts/src';
import type { ClaimedWebhook, ReplyNormalization } from './reply-ingress';
import { createWebhookEventProcessor, type NormalizedWebhookPort } from './webhook-events';

const binding: ConnectionBinding = { applicationId:'app', tenantId:'tenant', ownerId:'owner', connectionId:'conn', accountId:'account', generation:1, channel:'whatsapp', platform:'whatsapp', backend:'unipile' };
const message = (): Extract<CommunicationEvent,{type:'message'}> => ({ type:'message', reference:{binding:{...binding},id:'m1'}, conversation:{binding:{...binding},id:'chat1'}, direction:'inbound', sender:{kind:'phone',value:'+61400000002'}, occurredAt:'2026-10-12T09:59:00Z' });
function fixture(normalized: ReplyNormalization = {kind:'event', event:message()}) {
  const record: ClaimedWebhook = { binding:{...binding}, key:'receipt', token:'fence', rawBody:Buffer.from('{"account_id":"provider"}'), receivedAt:'2026-10-12T10:00:00Z' };
  const claim=vi.fn<NormalizedWebhookPort['claim']>(async()=>({kind:'claimed',record}));
  const finish=vi.fn<NormalizedWebhookPort['finish']>(async input=>({binding:input.record.binding,key:input.record.key,committed:true}));
  const normalize=vi.fn(async()=>normalized);
  const options={binding:{...binding},journal:{claim,finish},normalize};
  return {record,claim,finish,normalize,options};
}
describe('standalone service webhook event transaction',()=>{
  it('queues a normalized event without resolving an application person',async()=>{
    const f=fixture();expect(await createWebhookEventProcessor(f.options).process('receipt')).toEqual({status:'processed'});
    expect(f.finish).toHaveBeenCalledWith({record:{...f.record,rawBody:Uint8Array.from(f.record.rawBody)},outcome:{kind:'event',event:message(),eventKey:expect.stringMatching(/^[a-f0-9]{64}$/),fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)}});
    expect(JSON.stringify(f.finish.mock.calls[0][0])).not.toMatch(/personId|action|stop/);
  });
  it.each(['email','whatsapp','linkedin'] as const)('supports %s with no Acquire dependency',async channel=>{
    const f=fixture(),b={...binding,channel,platform:channel==='email'?'gmail' as const:channel};
    const e=message() as Extract<CommunicationEvent,{type:'message'}>;e.reference.binding=b;e.conversation!.binding=b;e.sender=channel==='email'?{kind:'email',value:'person@example.com'}:channel==='linkedin'?{kind:'linkedin_profile',value:'https://www.linkedin.com/in/person'}:e.sender;
    f.record.binding=b;f.options.binding=b;f.normalize.mockResolvedValue({kind:'event',event:e});
    expect(await createWebhookEventProcessor(f.options).process('receipt')).toEqual({status:'processed'});
    expect(f.finish.mock.calls[0][0].outcome).toMatchObject({kind:'event',event:e});
  });
  it.each(['outbound','self','group'] as const)('stores %s as an event without a campaign stop',async direction=>{
    const e=message() as Extract<CommunicationEvent,{type:'message'}>;e.direction=direction;const f=fixture({kind:'event',event:e});
    expect(await createWebhookEventProcessor(f.options).process('receipt')).toEqual({status:'processed'});
    expect(f.finish.mock.calls[0][0].outcome).toMatchObject({kind:'event',event:{direction}});
  });
  it.each(['protocol','account_changed','identity_pending'] as const)('persists %s review through the required coverage/outbox transaction',async code=>{
    const f=fixture({kind:'review',code});await createWebhookEventProcessor(f.options).process('receipt');
    expect(f.finish.mock.calls[0][0].outcome).toEqual({kind:'review',code});
  });
  it('stores ignored vendor updates without manufacturing an event',async()=>{
    const f=fixture({kind:'ignore',reason:'read_receipt'});await createWebhookEventProcessor(f.options).process('receipt');
    expect(f.finish.mock.calls[0][0].outcome).toEqual({kind:'ignore',reason:'read_receipt'});
  });
  it('waits for the service transaction to commit',async()=>{
    const f=fixture();let release!:()=>void,done=false;f.finish.mockImplementation(async input=>{await new Promise<void>(r=>release=r);return {binding:input.record.binding,key:input.record.key,committed:true};});
    const p=createWebhookEventProcessor(f.options).process('receipt').then(r=>{done=true;return r});
    await vi.waitFor(()=>expect(f.finish).toHaveBeenCalled());expect(done).toBe(false);release();expect(await p).toEqual({status:'processed'});
  });
  it.each(['busy','completed','forbidden'] as const)('does not normalize or finish a %s claim',async kind=>{
    const f=fixture();f.claim.mockResolvedValue({kind});expect(await createWebhookEventProcessor(f.options).process('receipt')).toEqual({status:kind==='completed'?'duplicate':kind});
    expect(f.normalize).not.toHaveBeenCalled();expect(f.finish).not.toHaveBeenCalled();
  });
  it.each(['reject','uncommitted','wrong_binding','wrong_key'] as const)('retries a %s finish',async variant=>{
    const f=fixture();f.finish.mockImplementation(async input=>{if(variant==='reject')throw Error('private storage detail');return {binding:{...input.record.binding,...(variant==='wrong_binding'?{ownerId:'other'}:{})},key:variant==='wrong_key'?'other':input.record.key,committed:variant!=='uncommitted'};});
    expect(await createWebhookEventProcessor(f.options).process('receipt')).toEqual({status:'retry'});
  });
  it('reviews corrupted stored bytes before enrichment',async()=>{
    const f=fixture();f.record.rawBody=Buffer.from([0xff]);await createWebhookEventProcessor(f.options).process('receipt');
    expect(f.normalize).not.toHaveBeenCalled();expect(f.finish.mock.calls[0][0].outcome).toEqual({kind:'review',code:'protocol'});
  });
  it('reviews an event with another account',async()=>{
    const e=message();e.reference.binding.accountId='other';const f=fixture({kind:'event',event:e});await createWebhookEventProcessor(f.options).process('receipt');
    expect(f.finish.mock.calls[0][0].outcome).toEqual({kind:'review',code:'protocol'});
  });
  it('keeps semantic keys stable across receipts and canonical time offsets',async()=>{
    const f=fixture();await createWebhookEventProcessor(f.options).process('receipt');const first=f.finish.mock.calls[0][0].outcome;
    const g=fixture();g.record.key='another';const e=message() as Extract<CommunicationEvent,{type:'message'}>;e.occurredAt='2026-10-12T10:59:00+01:00';g.normalize.mockResolvedValue({kind:'event',event:e});await createWebhookEventProcessor(g.options).process('another');
    expect(g.finish.mock.calls[0][0].outcome).toMatchObject({eventKey:(first as {eventKey:string}).eventKey,fingerprint:(first as {fingerprint:string}).fingerprint});
  });
  it('snapshots callbacks and binding before processing',async()=>{
    const f=fixture(),api=createWebhookEventProcessor(f.options);f.options.binding.ownerId='changed';f.options.journal.finish=vi.fn();f.options.normalize=vi.fn();
    expect(await api.process('receipt')).toEqual({status:'processed'});expect(f.finish).toHaveBeenCalledOnce();expect(f.normalize).toHaveBeenCalledOnce();
  });
});
