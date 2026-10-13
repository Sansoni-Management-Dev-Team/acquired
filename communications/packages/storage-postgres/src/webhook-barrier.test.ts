import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {createPostgresWebhookRepository,type PostgresWebhookRepositoryOptions,type SqlClient,type SqlResult} from './webhook-repository';
import {WebhookCodec} from '../../core/src/webhook-codec';
import {EventCodec} from '../../core/src/event-codec';
import type {ConnectionBinding} from '../../contracts/src';
import type {WebhookCapture} from '../../core/src/reply-ingress';
const binding:ConnectionBinding={applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
const body=Buffer.from('{"event":"synthetic"}'),vector=Object.values(binding);
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const capture:WebhookCapture={binding,key:hash(['communications.webhook.receipt.v1',vector,createHash('sha256').update(body).digest('hex')]),rawBody:body,receivedAt:'2026-10-12T10:00:00.000Z'};
function fixture(installed:unknown=true,withPort=true){
  const calls:string[]=[],state={duplicate:false,claimState:'pending',catalogRows:1,catalogValue:installed};
  const codec=new WebhookCodec({activeVersion:'wire1',keys:[{version:'wire1',encryptionKey:Buffer.alloc(32,11),digestKey:Buffer.alloc(32,12)}]});
  const envelope=codec.encode(capture);
  const row={id:capture.key,backend:'unipile',integration_id:'integration',dedupe_key:capture.key,payload_digest:codec.digest({binding,key:capture.key},body),encrypted_payload:JSON.stringify(envelope),key_version:envelope.keyVersion,alive:true,retry_due:true,lease_expired:true,claim_valid:true};
  const client:SqlClient={async query<Row>(sql:string){calls.push(sql);let rows:unknown[]=[];
    if(sql.includes('FROM pg_roles'))rows=[{role_name:'communications_control',rolsuper:false,rolbypassrls:false,rolcanlogin:false}];
    else if(sql.includes('to_regclass'))rows=state.catalogRows?[{barrier:state.catalogValue}]:[];
    else if(sql.includes('FROM communications.connections'))rows=[{connection_id:'connection',application_id:'app',tenant_id:'tenant',owner_id:'owner',account_id:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile',integration_id:'integration',provider_configuration_reference:'config',provider_api_version:'v1',authority:'service',active:true,grant_valid:true}];
    else if(sql.startsWith('INSERT INTO communications.webhook_inbox'))rows=state.duplicate?[]:[{id:capture.key}];
    else if(sql.includes('FROM communications.webhook_inbox'))rows=[{...row,state:state.claimState}];
    else if(sql.startsWith('UPDATE communications.webhook_inbox'))rows=[{id:capture.key}];
    else if(sql.startsWith('INSERT INTO communications.events'))rows=[{id:'9'}];
    else if(sql.includes('FROM communications.event_outbox'))rows=[{event_id:'9',subscriber_id:'subscriber',application_id:'app',tenant_id:'tenant',owner_id:'owner'}];
    return {rows:rows as Row[]};
  },release:vi.fn()};
  const port={lock:vi.fn(async()=>{calls.push('fence.lock');}),route:vi.fn(async(_client:SqlClient,_capture:WebhookCapture)=>{void _client;void _capture;calls.push('fence.route');return {revision:'1'};}),review:vi.fn(async()=>{calls.push('fence.review');})};
  const options={pool:{async connect(){return client;}},binding,integrationId:'integration',providerConfigurationReference:'config',subscriberId:'subscriber',codec,eventCodec:new EventCodec({activeVersion:'event1',keys:[{version:'event1',encryptionKey:Buffer.alloc(32,21),digestKey:Buffer.alloc(32,22)}]}),...(withPort?{replyBarrier:port}:{})} as PostgresWebhookRepositoryOptions;
  const repo=createPostgresWebhookRepository(options);
  return {repo,calls,port,state,client,options};
}
describe('webhook tenant fence composition, scripted SQL only',()=>{
  for(const operation of ['capture','claim','finish'] as const){
    it(`fails closed for ${operation} with installed003 and absent tenant port before work locks`,async()=>{
      const f=fixture(true,false);
      const pending=operation==='capture'?f.repo.capture(capture):operation==='claim'?f.repo.claim({binding,key:capture.key}):f.repo.finish({record:{...capture,token:'claim-token'},outcome:{kind:'review',code:'identity_pending'}});
      await expect(pending).rejects.toThrow('Webhook repository unavailable');
      expect(f.calls.some(s=>s.includes('FROM communications.connections')||s.includes('webhook_inbox'))).toBe(false);expect(f.calls).toContain('ROLLBACK');
    });
  }
  it('preserves approved001 capture when003 is absent and no port configured',async()=>{
    const f=fixture(false,false);await expect(f.repo.capture(capture)).resolves.toMatchObject({status:'accepted'});expect(f.calls).toContain('COMMIT');
  });
  it.each([undefined,'unexpected.schema'])('rejects malformed catalog evidence %s',async(value)=>{
    const f=fixture(false,false);f.state.catalogValue=value;await expect(f.repo.capture(capture)).rejects.toThrow();expect(f.calls.some(s=>s.includes('FROM communications.connections'))).toBe(false);
  });
  it('rejects missing catalog row before scope locks',async()=>{
    const f=fixture(false,false);f.state.catalogRows=0;await expect(f.repo.capture(capture)).rejects.toThrow();expect(f.calls.some(s=>s.includes('FROM communications.connections'))).toBe(false);
  });
  it('locks tenant before connection/inbox and commits routing before acceptance',async()=>{
    const f=fixture();await expect(f.repo.capture(capture)).resolves.toMatchObject({status:'accepted'});
    expect(f.port.lock).toHaveBeenCalledWith(expect.anything(),'app','tenant');
    expect(f.calls.indexOf('fence.lock')).toBeLessThan(f.calls.findIndex(s=>s.includes('FROM communications.connections')));
    expect(f.calls.indexOf('fence.route')).toBeGreaterThan(f.calls.findIndex(s=>s.startsWith('INSERT INTO communications.webhook_inbox')));
    expect(f.calls.indexOf('fence.route')).toBeLessThan(f.calls.indexOf('COMMIT'));
  });
  it('routes the original encrypted capture on duplicate, preserving its timestamp',async()=>{
    const f=fixture();f.state.duplicate=true;
    await expect(f.repo.capture({...capture,receivedAt:'2026-10-12T11:00:00.000Z'})).resolves.toMatchObject({status:'duplicate'});
    expect(f.port.route).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({receivedAt:capture.receivedAt,binding,key:capture.key}));
    expect(Buffer.from(f.port.route.mock.calls[0][1].rawBody)).toEqual(body);
  });
  it('establishes exact original routing before a claim mutation',async()=>{
    const f=fixture();await expect(f.repo.claim({binding,key:capture.key})).resolves.toMatchObject({kind:'claimed'});
    expect(f.calls.indexOf('fence.route')).toBeGreaterThan(f.calls.findIndex(s=>s.includes('FROM communications.webhook_inbox')));
    expect(f.calls.indexOf('fence.route')).toBeLessThan(f.calls.findIndex(s=>s.startsWith('UPDATE communications.webhook_inbox')));
  });
  it('commits review latch before outbox and terminal inbox in the same transaction',async()=>{
    const f=fixture();f.state.claimState='processing';await expect(f.repo.finish({record:{...capture,token:'claim-token'},outcome:{kind:'review',code:'identity_pending'}})).resolves.toMatchObject({committed:true});
    expect(f.port.review).toHaveBeenCalledWith(expect.anything(),{eventId:'9',code:'identity_pending'});
    expect(f.calls.indexOf('fence.review')).toBeLessThan(f.calls.findIndex(s=>s.startsWith('INSERT INTO communications.event_outbox')));
    expect(f.calls.indexOf('fence.review')).toBeLessThan(f.calls.findIndex(s=>s.startsWith('UPDATE communications.webhook_inbox')));
  });
  it('rejects failed tenant lock before downstream SQL',async()=>{
    const f=fixture();f.port.lock.mockRejectedValue(Error('Synthetic lock failure'));await expect(f.repo.capture(capture)).rejects.toThrow();expect(f.calls.some(s=>s.includes('FROM communications.connections'))).toBe(false);expect(f.calls).not.toContain('COMMIT');
  });
  it('rolls back capture when immutable routing fails',async()=>{
    const f=fixture();f.port.route.mockRejectedValue(Error('Synthetic route failure'));await expect(f.repo.capture(capture)).rejects.toThrow();expect(f.calls).not.toContain('COMMIT');expect(f.calls).toContain('ROLLBACK');
  });
  it('rolls back terminal event when review latch fails, without outbox or inbox completion',async()=>{
    const f=fixture();f.state.claimState='processing';f.port.review.mockRejectedValue(Error('Synthetic review failure'));await expect(f.repo.finish({record:{...capture,token:'claim-token'},outcome:{kind:'review',code:'identity_pending'}})).rejects.toThrow();expect(f.calls.some(s=>s.startsWith('INSERT INTO communications.event_outbox')||s.startsWith('UPDATE communications.webhook_inbox'))).toBe(false);expect(f.calls).not.toContain('COMMIT');
  });
});

const budgets={transactionTimeoutMs:20,statementTimeoutMs:10,lockTimeoutMs:5};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function overrun(){const end=performance.now()+35;while(performance.now()<end){};}
async function observed(p:Promise<unknown>){return Promise.race([p.then(()=> 'committed',()=> 'rejected'),new Promise<string>(r=>setTimeout(()=>r('pending'),65))]);}
describe('webhook fence transaction budget',()=>{
  it('bounds a stalled tenant mutex callback and retires its transaction',async()=>{
    const f=fixture();f.port.lock.mockReturnValue(new Promise<void>(()=>{}));
    const repo=createPostgresWebhookRepository({...f.options,...budgets});
    expect(await observed(repo.capture(capture))).toBe('rejected');expect(f.client.release).toHaveBeenCalledWith(expect.any(Error));expect(f.calls).not.toContain('COMMIT');
  });
  it('bounds stalled immutable routing without accepting capture',async()=>{
    const f=fixture();f.port.route.mockReturnValue(new Promise<{revision:string}>(()=>{}));
    expect(await observed(createPostgresWebhookRepository({...f.options,...budgets}).capture(capture))).toBe('rejected');expect(f.client.release).toHaveBeenCalledWith(expect.any(Error));expect(f.calls).not.toContain('COMMIT');
  });
  it('disposes a connection arriving after the deadline without BEGIN',async()=>{
    const f=fixture(false,false),late=deferred<SqlClient>();
    const repo=createPostgresWebhookRepository({...f.options,...budgets,pool:{connect:()=>late.promise}});
    const pending=repo.capture(capture);expect(await observed(pending)).toBe('rejected');late.resolve(f.client);await new Promise(r=>setTimeout(r,5));expect(f.calls).not.toContain('BEGIN');expect(f.client.release).toHaveBeenCalledTimes(1);
  });
  it('uses monotonic time when a synchronous connect starves the timer',async()=>{
    const f=fixture(false,false),repo=createPostgresWebhookRepository({...f.options,...budgets,pool:{async connect(){overrun();return f.client;}}});
    await expect(repo.capture(capture)).rejects.toThrow();expect(f.calls).not.toContain('BEGIN');expect(f.client.release).toHaveBeenCalledTimes(1);
  });
  it('does not accept a COMMIT response after its elapsed budget',async()=>{
    const f=fixture(false,false),query=f.client.query;
    f.client.query=async<Row>(sql:string,values?:unknown[])=>{const result=await query<Row>(sql,values);if(sql==='COMMIT')overrun();return result;};
    await expect(createPostgresWebhookRepository({...f.options,...budgets}).capture(capture)).rejects.toThrow();expect(f.client.release).toHaveBeenCalledWith(expect.any(Error));
  });
  it('does not race ROLLBACK against an active query when the deadline expires',async()=>{
    const f=fixture(false,false),query=f.client.query;f.client.query=async<Row>(sql:string,values?:unknown[])=>sql.startsWith('INSERT INTO communications.webhook_inbox')?new Promise<SqlResult<Row>>(()=>{}):query<Row>(sql,values);
    expect(await observed(createPostgresWebhookRepository({...f.options,...budgets}).capture(capture))).toBe('rejected');expect(f.calls).not.toContain('ROLLBACK');expect(f.client.release).toHaveBeenCalledTimes(1);
  });
});
