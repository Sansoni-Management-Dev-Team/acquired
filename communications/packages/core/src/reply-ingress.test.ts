import { describe, expect, it, vi } from 'vitest';
import { createReplyProcessor, createReplyWebhookIngress, type ClaimedWebhook, type ReplyIngressOptions, type ReplyMatch, type ReplyNormalization, type ReplyProcessorOptions, type WebhookCapture } from './reply-ingress';
import type { CommunicationEvent, ConnectionBinding } from '../../contracts/src';

const now = Date.parse('2026-10-12T10:00:00.000Z');
const binding: ConnectionBinding = {applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'conn',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
const body = () => Buffer.from(JSON.stringify({account_id:'provider-account',event:'message_received',message_id:'m1'}));
const headers = ['Unipile-Auth','fixture-only-secret'];
const event = (): Extract<CommunicationEvent,{type:'message'}> => ({type:'message',reference:{binding:{...binding},id:'m1'},conversation:{binding:{...binding},id:'chat1'},direction:'inbound',sender:{kind:'phone',value:'+61400000002'},occurredAt:'2026-10-12T09:59:00.000Z'});
const match = (personId='person'): ReplyMatch => ({scope:{applicationId:'app',tenantId:'tenant',ownerId:'owner'},personId,identity:{kind:'phone',value:'+61400000002'},since:'2026-10-12T09:00:00.000Z'});
function ingress() {
  const capture = vi.fn(async (input:WebhookCapture):Promise<{binding:ConnectionBinding;key:string;status:'accepted'|'duplicate'}> => ({binding:input.binding,key:input.key,status:'accepted'}));
  const options: ReplyIngressOptions = {binding:{...binding},validateEnvelope:raw=>(raw as {account_id?:string}).account_id==='provider-account'?'valid':(raw as {account_id?:string}).account_id?'forbidden':'invalid_request',authenticate:h=>h[1]==='fixture-only-secret',journal:{capture},now:()=>now};
  return {options,capture,api:createReplyWebhookIngress(options)};
}
function processor(normalized:ReplyNormalization={kind:'event',event:event()}) {
  const record: ClaimedWebhook = {binding:{...binding},key:'receipt-key',rawBody:body(),receivedAt:'2026-10-12T10:00:00.000Z',token:'fenced-lease'};
  const claim = vi.fn(async()=>({kind:'claimed' as const,record}));
  const finish = vi.fn(async input=>({binding:input.record.binding,key:input.record.key,committed:true}));
  const normalize = vi.fn(async()=>normalized);
  const resolve = vi.fn(async()=>[match()]);
  const options:ReplyProcessorOptions={binding:{...binding},journal:{claim,finish},normalize,resolve};
  return {record,claim,finish,normalize,resolve,options,api:createReplyProcessor(options)};
}
describe('durable webhook ingress boundary',()=>{
  it('acknowledges only after receipt commit and preserves raw bytes',async()=>{
    const f=ingress(); let release!:()=>void;
    f.capture.mockImplementationOnce(async input=>{await new Promise<void>(r=>{release=r});return {binding:input.binding,key:input.key,status:'accepted'}});
    let done=false;const promise=f.api.capture({rawHeaders:headers,rawBody:body()}).then(r=>{done=true;return r});
    await Promise.resolve();expect(done).toBe(false);expect(f.capture).toHaveBeenCalledTimes(1);
    release();expect(await promise).toEqual({status:'accepted'});
    expect(Buffer.from(f.capture.mock.calls[0][0].rawBody)).toEqual(body());
  });
  it('does not write unauthenticated payloads',async()=>{
    const f=ingress();expect(await f.api.capture({rawHeaders:['Unipile-Auth','wrong'],rawBody:body()})).toEqual({status:'rejected',code:'unauthorized'});expect(f.capture).not.toHaveBeenCalled();
  });
  it.each([
    {bytes:Buffer.from('{'),code:'invalid_request'},
    {bytes:Buffer.from('[]'),code:'invalid_request'},
    {bytes:Buffer.from('{}'),code:'invalid_request'},
    {bytes:Buffer.from(JSON.stringify({account_id:'different'})),code:'forbidden'},
    {bytes:Buffer.from([0xff]),code:'invalid_request'},
    {bytes:Buffer.from('\uFEFF'+body().toString()),code:'invalid_request'},
  ])('rejects invalid or misbound payload before persistence ($code)',async({bytes,code})=>{
    const f=ingress();expect(await f.api.capture({rawHeaders:headers,rawBody:bytes})).toEqual({status:'rejected',code});expect(f.capture).not.toHaveBeenCalled();
  });
  it('rejects oversize before parsing',async()=>{
    const f=ingress();f.options.maxBodyBytes=1;const api=createReplyWebhookIngress(f.options);
    expect(await api.capture({rawHeaders:headers,rawBody:body()})).toEqual({status:'rejected',code:'too_large'});expect(f.capture).not.toHaveBeenCalled();
  });
  it('uses stable binding-scoped receipt keys and returns duplicates honestly',async()=>{
    const f=ingress();await f.api.capture({rawHeaders:headers,rawBody:body()});
    f.capture.mockImplementationOnce(async input=>({binding:input.binding,key:input.key,status:'duplicate'}));
    expect(await f.api.capture({rawHeaders:headers,rawBody:body()})).toEqual({status:'duplicate'});
    expect(f.capture.mock.calls[0][0].key).toBe(f.capture.mock.calls[1][0].key);
    const other=ingress();other.options.binding.generation=2;await createReplyWebhookIngress(other.options).capture({rawHeaders:headers,rawBody:body()});
    expect(other.capture.mock.calls[0][0].key).not.toBe(f.capture.mock.calls[0][0].key);
  });
  it('never acknowledges commit failure or returned wrong binding/key',async()=>{
    const f=ingress();f.capture.mockRejectedValueOnce(new Error('private database detail'));
    expect(await f.api.capture({rawHeaders:headers,rawBody:body()})).toEqual({status:'retry'});
    f.capture.mockImplementationOnce(async input=>({binding:{...input.binding,ownerId:'wrong'},key:input.key,status:'accepted'}));
    expect(await f.api.capture({rawHeaders:headers,rawBody:body()})).toEqual({status:'retry'});
    f.capture.mockImplementationOnce(async input=>({binding:input.binding,key:'wrong',status:'accepted'}));
    expect(await f.api.capture({rawHeaders:headers,rawBody:body()})).toEqual({status:'retry'});
  });
  it('captures configuration/callbacks and payload before awaits',async()=>{
    const f=ingress(),bytes=body();f.options.binding.ownerId='changed';f.options.validateEnvelope=()=> 'forbidden';f.options.journal.capture=vi.fn();f.options.authenticate=()=>false;
    const p=f.api.capture({rawHeaders:headers,rawBody:bytes});bytes.fill(0);
    expect(await p).toEqual({status:'accepted'});expect(f.capture.mock.calls[0][0].binding).toEqual(binding);expect(Buffer.from(f.capture.mock.calls[0][0].rawBody)).toEqual(body());
  });
  it('does not turn receipt capture into reply coverage',async()=>{
    const f=ingress();await f.api.capture({rawHeaders:headers,rawBody:body()});
    expect(Object.keys(f.capture.mock.calls[0][0]).sort()).toEqual(['binding','key','rawBody','receivedAt']);
  });
});
describe('all-channel reply processing boundary',()=>{
  it.each(['email','whatsapp','linkedin'] as const)('commits %s incoming reply and person-wide stop atomically',async channel=>{
    const f=processor(),b={...binding,channel,platform:channel==='email'?'gmail' as const:channel};
    const e=event();e.reference.binding=b;e.conversation!.binding=b;e.sender=channel==='email'?{kind:'email',value:'person@example.com'}:channel==='linkedin'?{kind:'linkedin_profile',value:'https://www.linkedin.com/in/person'}:e.sender;
    f.options.binding=b;f.record.binding=b;f.normalize.mockResolvedValue({kind:'event',event:e});f.resolve.mockResolvedValue([{...match(),identity:e.sender}]);
    const result=await createReplyProcessor(f.options).process('receipt-key');
    expect(result).toEqual({status:'processed',decision:{action:'stop',personId:'person'}});
    expect(f.finish).toHaveBeenCalledTimes(1);expect(f.finish.mock.calls[0][0]).toMatchObject({record:{binding:b,key:f.record.key,receivedAt:f.record.receivedAt,token:f.record.token},event:e,decision:{action:'stop',personId:'person'}});
    expect(Buffer.from(f.finish.mock.calls[0][0].record.rawBody)).toEqual(Buffer.from(f.record.rawBody));
    expect(f.finish.mock.calls[0][0].eventKey).toMatch(/^[a-f0-9]{64}$/);expect(f.finish.mock.calls[0][0].eventFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it('coalesces same person matches, reviews different people',async()=>{
    const f=processor();f.resolve.mockResolvedValueOnce([match(),match()]);expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'stop',personId:'person'}});
    f.resolve.mockResolvedValueOnce([match('p1'),match('p2')]);expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'review',code:'identity_pending'}});
  });
  it('ignores unmatched or pre-enrolment messages',async()=>{
    const f=processor();f.resolve.mockResolvedValueOnce([]);expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'ignore',reason:'unmatched'}});
    f.resolve.mockResolvedValueOnce([{...match(),since:'2026-10-12T10:00:00.000Z'}]);expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'ignore',reason:'unmatched'}});
  });
  it.each(['outbound','self','group'] as const)('does not stop on %s activity',async direction=>{
    const e=event();e.direction=direction;const f=processor({kind:'event',event:e});
    expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'ignore',reason:'not_inbound'}});expect(f.resolve).not.toHaveBeenCalled();
  });
  it('records normalized ignore/review without resolving people',async()=>{
    const f=processor({kind:'ignore',reason:'receipt'});expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'ignore',reason:'receipt'}});
    f.normalize.mockResolvedValueOnce({kind:'review',code:'identity_pending'});expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'review',code:'identity_pending'}});expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each(['completed','busy','forbidden'] as const)('does not process an unavailable claim (%s)',async kind=>{
    const f=processor();f.claim.mockResolvedValueOnce({kind} as never);
    expect(await f.api.process('receipt-key')).toEqual({status:kind==='completed'?'duplicate':kind});expect(f.normalize).not.toHaveBeenCalled();expect(f.finish).not.toHaveBeenCalled();
  });
  it.each(['binding','key'] as const)('refuses misbound claim %s',async field=>{
    const f=processor();if(field==='binding')f.record.binding.ownerId='different';else f.record.key='different';
    expect(await f.api.process('receipt-key')).toEqual({status:'retry'});expect(f.normalize).not.toHaveBeenCalled();expect(f.finish).not.toHaveBeenCalled();
  });
  it('reviews wrong generation/account references and invalid timestamps',async()=>{
    const bad=[{...event(),reference:{binding:{...binding,generation:2},id:'m1'}},{...event(),occurredAt:'2026-02-30T00:00:00.000Z'},{...event(),occurredAt:'2026-10-12T10:00:01.000Z'}];
    for(const e of bad){const f=processor({kind:'event',event:e});expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'review',code:'protocol'}});expect(f.resolve).not.toHaveBeenCalled();}
  });
  it('reviews foreign scope, different identity and invalid matching cutoffs',async()=>{
    const bad=[{...match(),scope:{...match().scope,tenantId:'foreign'}},{...match(),identity:{kind:'phone' as const,value:'+61400000003'}},{...match(),since:'invalid'}];
    for(const m of bad){const f=processor();f.resolve.mockResolvedValueOnce([m]);expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'review',code:'protocol'}});}
  });
  it('never reports processed on failed or misbound terminal commit',async()=>{
    const f=processor();f.finish.mockRejectedValueOnce(new Error('private'));
    expect(await f.api.process('receipt-key')).toEqual({status:'retry'});
    f.finish.mockResolvedValueOnce({binding,key:'receipt-key',committed:false});expect(await f.api.process('receipt-key')).toEqual({status:'retry'});
    f.finish.mockResolvedValueOnce({binding:{...binding,ownerId:'different'},key:'receipt-key',committed:true});expect(await f.api.process('receipt-key')).toEqual({status:'retry'});
  });
  it('uses scoped semantic event keys across distinct webhook deliveries',async()=>{
    const f=processor();await f.api.process('receipt-key');f.record.key='second-delivery';await f.api.process('second-delivery');
    expect(f.finish.mock.calls[0][0].eventKey).toBe(f.finish.mock.calls[1][0].eventKey);
    expect(f.finish.mock.calls[0][0].eventFingerprint).toBe(f.finish.mock.calls[1][0].eventFingerprint);
  });
  it('copies records/events and captures ports across enrichment awaits',async()=>{
    const f=processor();f.normalize.mockImplementationOnce(async()=>{f.record.binding.ownerId='changed';f.options.journal.finish=vi.fn();f.options.resolve=vi.fn();return {kind:'event',event:event()};});
    expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'stop'}});expect(f.finish.mock.calls[0][0].record.binding).toEqual(binding);
  });
  it('reviews malformed stored bytes before calling enrichment or matching',async()=>{
    const f=processor();f.record.rawBody=Buffer.from('{');
    expect(await f.api.process('receipt-key')).toMatchObject({decision:{action:'review',code:'protocol'}});
    expect(f.normalize).not.toHaveBeenCalled();expect(f.resolve).not.toHaveBeenCalled();
  });
});
