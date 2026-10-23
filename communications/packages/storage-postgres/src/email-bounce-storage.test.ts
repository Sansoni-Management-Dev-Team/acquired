import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {EventCodec} from '../../core/src/event-codec';
import {WebhookCodec} from '../../core/src/webhook-codec';
import {emailBounceSemantics} from '../../core/src/email-bounce';
import {createPostgresWebhookRepository,type SqlClient} from './webhook-repository';
import {createPostgresOutboxRepository} from './outbox-repository';
import type {ConnectionBinding} from '../../contracts/src';
/** Scripted PostgreSQL protocol, not database proof. Exercises real encryption,
 * immutable event columns and the exact service write/read adapters together. */
it('persists and reopens a bounce under its own event type and namespace with the original encrypted account scope',async()=>{
 const binding:ConnectionBinding={applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'email',platform:'gmail',backend:'unipile'},scope=[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend],rawBody=Buffer.from('{"synthetic":"dsn"}'),receivedAt='2026-10-12T10:00:00.000Z',key=createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1',scope,createHash('sha256').update(rawBody).digest('hex')])).digest('hex'),record={binding,key,rawBody,receivedAt,token:'claim'},event={type:'email_change' as const,change:'bounce' as const,reference:{binding,id:'dsn'},recipient:{kind:'email' as const,value:'peer@example.com'},occurredAt:'2026-10-12T09:00:00.000Z'},semantic=emailBounceSemantics(binding,event),outcome={kind:'event' as const,event,...semantic};
 const codec=new WebhookCodec({activeVersion:'wire',keys:[{version:'wire',encryptionKey:Buffer.alloc(32,1),digestKey:Buffer.alloc(32,2)}]}),events=new EventCodec({activeVersion:'events',keys:[{version:'events',encryptionKey:Buffer.alloc(32,3),digestKey:Buffer.alloc(32,4)}]}),wire=codec.encode({binding,key,rawBody,receivedAt});
 const account={connection_id:binding.connectionId,application_id:'app',tenant_id:'tenant',owner_id:'owner',account_id:'account',generation:1,channel:'email',platform:'gmail',backend:'unipile',integration_id:'integration',provider_configuration_reference:'config',provider_api_version:'v1',authority:'service',active:true,grant_valid:true},calls:{sql:string;values:unknown[]}[]=[];let saved:Record<string,unknown>|undefined;
 const client:SqlClient={async query<Row>(sql:string,values:unknown[]=[]){calls.push({sql,values});let rows:Record<string,unknown>[]=[];
  if(sql.includes('FROM pg_roles'))rows=[{role_name:'communications_control',rolsuper:false,rolbypassrls:false,rolcanlogin:false}];
  else if(sql.includes('to_regclass'))rows=[{barrier:false}];
  else if(sql.includes('FROM communications.connections'))rows=[account];
  else if(sql.includes('FROM communications.webhook_inbox'))rows=[{id:key,backend:'unipile',integration_id:'integration',dedupe_key:key,payload_digest:codec.digest({binding,key},rawBody),encrypted_payload:JSON.stringify(wire),key_version:'wire',state:'processing',alive:true,claim_valid:true}];
  else if(sql.startsWith('INSERT INTO communications.events')){saved={id:'1',event_id:'1',application_id:values[0],tenant_id:values[1],owner_id:values[2],connection_id:values[3],generation:values[4],account_id:values[5],source_namespace:values[6],source_event_key:values[7],event_type:values[8],direction:values[9],occurred_at:values[10],encrypted_event:values[11],key_version:values[12],subscriber_id:'subscriber',outbox_application_id:'app',outbox_tenant_id:'tenant',outbox_owner_id:'owner'};rows=[{id:'1'}];}
  else if(sql.includes('FROM communications.event_outbox o JOIN'))rows=saved?[saved]:[];
  else if(sql.includes('FROM communications.event_outbox'))rows=[{event_id:'1',subscriber_id:'subscriber',application_id:'app',tenant_id:'tenant',owner_id:'owner'}];
  else if(sql.startsWith('UPDATE communications.event_outbox'))rows=[{event_id:'1'}];
  else if(sql.startsWith('UPDATE communications.webhook_inbox'))rows=[{id:key}];
  return {rows:rows as Row[]};},release:vi.fn()};
 const pool={connect:async()=>client},repo=createPostgresWebhookRepository({pool,binding,integrationId:'integration',providerConfigurationReference:'config',subscriberId:'subscriber',codec,eventCodec:events});expect(await repo.finish({record,outcome})).toMatchObject({committed:true});expect(saved).toMatchObject({source_namespace:'email_bounce/v1',event_type:'email_change',direction:null,occurred_at:event.occurredAt});
 const outbox=createPostgresOutboxRepository({pool,binding,subscriberId:'subscriber',codec:events}),claimed=await outbox.claim();expect(claimed).toMatchObject({kind:'claimed',delivery:{sourceNamespace:'email_bounce/v1',payload:{outcome}}});expect(calls.filter(c=>c.sql==='COMMIT')).toHaveLength(2);expect(JSON.stringify(saved)).not.toContain('peer@example.com');
});
