import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {describe,expect,it,vi} from 'vitest';
import {createPostgresWebhookRepository,type SqlClient,type SqlResult} from './webhook-repository';
import {WebhookCodec} from '../../core/src/webhook-codec';
import {EventCodec} from '../../core/src/event-codec';
import type {ConnectionBinding} from '../../contracts/src';
import type {WebhookCapture} from '../../core/src/reply-ingress';
import {createPostgresReplyBarrier} from './reply-barrier';
const binding:ConnectionBinding={applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
const rawBody=Buffer.from('synthetic'),scope=Object.values(binding);
const key=createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1',scope,createHash('sha256').update(rawBody).digest('hex')])).digest('hex');
const capture:WebhookCapture={binding,key,rawBody,receivedAt:'2026-10-12T10:00:00.000Z'};
function fixture(fault:(client:SqlClient)=>Promise<void>,slot:'lock'|'route'|'review'='lock',concrete=false){
 const calls:string[]=[],delegated:SqlClient[]=[],release=vi.fn();
 const codec=new WebhookCodec({activeVersion:'wire',keys:[{version:'wire',encryptionKey:Buffer.alloc(32,1),digestKey:Buffer.alloc(32,2)}]});
 const envelope=codec.encode(capture),eventCodec=new EventCodec({activeVersion:'event',keys:[{version:'event',encryptionKey:Buffer.alloc(32,3),digestKey:Buffer.alloc(32,4)}]});
 const client:SqlClient={async query<Row>(sql:string):Promise<SqlResult<Row>>{calls.push(sql);const rows=sql.includes('FROM pg_roles')?[{role_name:'communications_control',rolsuper:false,rolbypassrls:false,rolcanlogin:false}]:sql.includes('to_regclass')?[{barrier:true}]:sql.includes('FROM communications.connections')?[{connection_id:'connection',application_id:'app',tenant_id:'tenant',owner_id:'owner',account_id:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile',integration_id:'integration',provider_configuration_reference:'config',provider_api_version:'v1',authority:'service',active:true,grant_valid:true}]:sql.startsWith('INSERT INTO communications.webhook_inbox')?[{id:key}]:sql.includes('FROM communications.webhook_inbox')?[{id:key,backend:'unipile',integration_id:'integration',dedupe_key:key,payload_digest:codec.digest({binding,key},rawBody),encrypted_payload:JSON.stringify(envelope),key_version:'wire',state:'processing',alive:true,claim_valid:true}]:sql.startsWith('INSERT INTO communications.events')?[{id:'1'}]:sql.startsWith('UPDATE communications.webhook_inbox')?[{id:key}]:sql.includes('FROM communications.event_outbox')?[{event_id:'1',subscriber_id:'subscriber',application_id:'app',tenant_id:'tenant',owner_id:'owner'}]:[];return {rows:rows as Row[]};},release};
 const port={async lock(c:SqlClient){delegated.push(c);if(slot==='lock')await fault(c);},async route(c:SqlClient){delegated.push(c);if(slot==='route')await fault(c);return {revision:'1'};},async review(c:SqlClient){delegated.push(c);if(slot==='review')await fault(c);}};
 if(concrete){const query=client.query;client.query=async<Row>(sql:string,values?:unknown[])=>{
  if(sql.includes('FROM pg_roles')){calls.push(sql);return {rows:[{role_name:'communications_control',rolsuper:false,rolbypassrls:false,rolcanlogin:false,transaction_id:'100'}] as Row[]};}
  if(sql.includes('lock_reply_barrier')){calls.push(sql);return {rows:[{revision:'0',transaction_id:'100'}] as Row[]};}
  if(sql.includes('FROM communications.webhook_inbox')&&sql.includes('JOIN communications.connection_generations')){calls.push(sql);return {rows:[{id:key,backend:'unipile',integration_id:'integration',dedupe_key:key,payload_digest:codec.digest({binding,key},rawBody),encrypted_payload:JSON.stringify(envelope),key_version:'wire',connection_id:'connection',generation:1,application_id:'app',tenant_id:'tenant',owner_id:'owner',account_id:'account',channel:'whatsapp',platform:'whatsapp',generation_backend:'unipile',generation_integration_id:'integration'}] as Row[]};}
  if(sql.includes('FROM communications.webhook_receipt_routes')){calls.push(sql);return {rows:[{webhook_inbox_id:key,application_id:'app',tenant_id:'tenant',owner_id:'owner',connection_id:'connection',generation:1,account_id:'account',capture_revision:'1',tenant_revision:'1'}] as Row[]};}
  return query<Row>(sql,values);
 };}
 const repo=createPostgresWebhookRepository({pool:{async connect(){return client;}},binding,integrationId:'integration',providerConfigurationReference:'config',subscriberId:'subscriber',codec,eventCodec,replyBarrier:concrete?createPostgresReplyBarrier({binding,integrationId:'integration',codec,eventCodec}):port});
 return {repo,calls,delegated,release};
}
describe('independent fence lifecycle ownership, scripted driver only',()=>{
 it.each(['swallowed','unawaited'])('observes forbidden callback query in strict native Node (%s)',mode=>{
  const script=String.raw`
   const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{createHash}=require('node:crypto');
   require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
   const file=process.argv[2],{createPostgresWebhookRepository}=require(file),{WebhookCodec}=require(path.resolve(path.dirname(file),'../../core/src/webhook-codec.ts'));
   const binding={applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'},rawBody=Buffer.from('synthetic'),key=createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1',Object.values(binding),createHash('sha256').update(rawBody).digest('hex')])).digest('hex');
   const calls=[];let discarded=0;
   const client={async query(sql){calls.push(sql);return {rows:sql.includes('FROM pg_roles')?[{role_name:'communications_control',rolsuper:false,rolbypassrls:false,rolcanlogin:false}]:sql.includes('to_regclass')?[{barrier:true}]:sql.includes('FROM communications.connections')?[{connection_id:'connection',application_id:'app',tenant_id:'tenant',owner_id:'owner',account_id:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile',integration_id:'integration',provider_configuration_reference:'config',provider_api_version:'v1',authority:'service',active:true,grant_valid:true}]:sql.startsWith('INSERT INTO communications.webhook_inbox')?[{id:key}]:[]};},release(error){if(error)discarded++;}};
   const repository=createPostgresWebhookRepository({pool:{async connect(){return client;}},binding,integrationId:'integration',providerConfigurationReference:'config',subscriberId:'subscriber',codec:new WebhookCodec({activeVersion:'wire',keys:[{version:'wire',encryptionKey:Buffer.alloc(32,1),digestKey:Buffer.alloc(32,2)}]}),replyBarrier:{async lock(c){if(process.argv[1]==='swallowed')await c.query('COMMIT').catch(()=>undefined);else void c.query('COMMIT');},async route(){return {revision:'1'};},async review(){}}});
   repository.capture({binding,key,rawBody,receivedAt:'2026-10-12T10:00:00.000Z'}).then(()=> 'accepted',()=> 'rejected').then(status=>setTimeout(()=>process.stdout.write(JSON.stringify({status,committed:calls.includes('COMMIT'),mutated:calls.some(sql=>sql.startsWith('INSERT INTO communications.webhook_inbox')),discarded})),20));
  `;
  const result=spawnSync(process.execPath,['--unhandled-rejections=strict','-e',script,mode,fileURLToPath(new URL('./webhook-repository.ts',import.meta.url))],{encoding:'utf8',timeout:3000});expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual({status:'rejected',committed:false,mutated:false,discarded:1});
 });
 it('composes the concrete encrypted reply barrier with the restricted transaction client',async()=>{
  const f=fixture(async()=>{},'lock',true);await expect(f.repo.capture(capture)).resolves.toMatchObject({status:'accepted'});
  expect(f.calls.findIndex(sql=>sql.includes('lock_reply_barrier'))).toBeLessThan(f.calls.findIndex(sql=>sql.includes('FROM communications.connections')));
  expect(f.calls.findIndex(sql=>sql.startsWith('INSERT INTO communications.webhook_receipt_routes'))).toBeLessThan(f.calls.indexOf('COMMIT'));expect(f.release).toHaveBeenCalledOnce();expect(f.release.mock.calls[0][0]).toBeInstanceOf(Error);
 });
 it.each(['COMMIT','ROLLBACK','BEGIN','SAVEPOINT unsafe','SET ROLE acquire_channels','SELECT 1; SELECT 2'])('rejects delegated %s before it reaches the physical driver',async sql=>{
  const f=fixture(async client=>{await client.query(sql);});await expect(f.repo.capture(capture)).rejects.toThrow('Webhook repository unavailable');if(sql==='BEGIN'||sql==='ROLLBACK')expect(f.calls.filter(text=>text===sql)).toHaveLength(1);else expect(f.calls).not.toContain(sql);expect(f.calls.some(text=>text.startsWith('INSERT INTO communications.webhook_inbox'))).toBe(false);
 });
 it.each(['lock','route','review'] as const)('poisons the transaction even if %s swallows forbidden COMMIT rejection',async slot=>{
  const f=fixture(async client=>{await client.query('COMMIT').catch(()=>undefined);},slot);
  const result=slot==='review'?f.repo.finish({record:{...capture,token:'token'},outcome:{kind:'review',code:'protocol'}}):f.repo.capture(capture);
  await expect(result).rejects.toThrow('Webhook repository unavailable');expect(f.calls).not.toContain('COMMIT');
  if(slot==='lock')expect(f.calls.some(text=>text.startsWith('INSERT INTO communications.webhook_inbox'))).toBe(false);
  if(slot==='review')expect(f.calls.some(text=>text.startsWith('INSERT INTO communications.event_outbox')||text.startsWith('UPDATE communications.webhook_inbox'))).toBe(false);
 });
 it('poisons the transaction even if a callback swallows forbidden release',async()=>{
  const f=fixture(async client=>{try{client.release();}catch{/* Fault injected into trusted composition. */}});
  await expect(f.repo.capture(capture)).rejects.toThrow('Webhook repository unavailable');expect(f.calls).not.toContain('COMMIT');
 });
 it('uses one delegated client identity for lock and routing and expires it after commit',async()=>{
  const f=fixture(async client=>{await client.query('SELECT synthetic_safe_fence');});await expect(f.repo.capture(capture)).resolves.toMatchObject({status:'accepted'});expect(f.delegated).toHaveLength(2);expect(f.delegated[0]).toBe(f.delegated[1]);await expect(f.delegated[0].query('SELECT synthetic_late_fence')).rejects.toThrow();expect(f.calls).not.toContain('SELECT synthetic_late_fence');expect(f.release).toHaveBeenCalledOnce();expect(f.release.mock.calls[0][0]).toBeInstanceOf(Error);
 });
});
