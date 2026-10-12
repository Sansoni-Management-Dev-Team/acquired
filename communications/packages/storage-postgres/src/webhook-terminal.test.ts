import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding } from '../../contracts/src';
import type { ClaimedWebhook } from '../../core/src/reply-ingress';
import type { NormalizedWebhookOutcome, NormalizedWebhookPort } from '../../core/src/webhook-events';
import { WebhookCodec } from '../../core/src/webhook-codec';
import { EventCodec } from '../../core/src/event-codec';
import { createPostgresWebhookRepository, type PostgresWebhookRepositoryOptions } from './webhook-repository';

const binding:ConnectionBinding={applicationId:'terminal-app',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
const scope=[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend];
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rawBody=Buffer.from('{"synthetic":"reply"}');
const record:ClaimedWebhook={binding,key:hash(['communications.webhook.receipt.v1',scope,createHash('sha256').update(rawBody).digest('hex')]),rawBody,receivedAt:'2026-10-12T10:00:00.000Z',token:'a'.repeat(43)};
const event={type:'message' as const,reference:{binding,id:'message'},conversation:{binding,id:'chat'},direction:'inbound' as const,sender:{kind:'phone' as const,value:'+15550000001'},occurredAt:'2026-10-12T09:00:00.000Z'};
const outcome:Extract<NormalizedWebhookOutcome,{kind:'event'}>={kind:'event',event,eventKey:hash(['communications.reply.event.v1',scope,'chat','message']),fingerprint:hash(['communications.reply.content.v1',scope,'message','chat','inbound','phone','+15550000001','2026-10-12T09:00:00.000Z'])};
function fixture(eventCodec=true) {
 const connect=vi.fn(async()=>{throw Error('Synthetic database not available');});
 const options:PostgresWebhookRepositoryOptions & {eventCodec?:EventCodec}={pool:{connect},binding,integrationId:'integration',providerConfigurationReference:'config-v1',subscriberId:'subscriber',codec:new WebhookCodec({activeVersion:'webhook1',keys:[{version:'webhook1',encryptionKey:Buffer.alloc(32,141),digestKey:Buffer.alloc(32,142)}]})};
 if(eventCodec)options.eventCodec=new EventCodec({activeVersion:'event1',keys:[{version:'event1',encryptionKey:Buffer.alloc(32,151),digestKey:Buffer.alloc(32,152)}]});
 return {repo:createPostgresWebhookRepository(options) as ReturnType<typeof createPostgresWebhookRepository> & NormalizedWebhookPort,connect};
}
describe('terminal webhook guards before PostgreSQL I/O',()=>{
 it.each([{...outcome,eventKey:'b'.repeat(64)},{...outcome,fingerprint:'b'.repeat(64)},{...outcome,event:{...event,reference:{binding:{...binding,ownerId:'other'},id:'message'}}},{...outcome,event:{...event,body:'private-content'}},{kind:'review',code:'unexpected'},{kind:'review',code:'protocol',personId:'private-person'},{kind:'ignore',reason:'private@example.test'}])('rejects forged or malformed terminal outcome %#',async(value)=>{const {repo,connect}=fixture();await expect(repo.finish({record,outcome:value as NormalizedWebhookOutcome})).rejects.toThrow('Webhook repository unavailable');expect(connect).not.toHaveBeenCalled();});
 it.each([{...record,token:''},{...record,key:'b'.repeat(64)},{...record,binding:{...binding,generation:2}},{...record,rawBody:Buffer.from('different')}])('rejects malformed terminal claim %#',async(claim)=>{const {repo,connect}=fixture();await expect(repo.finish({record:claim,outcome})).rejects.toThrow('Webhook repository unavailable');expect(connect).not.toHaveBeenCalled();});
 it('requires an event codec before persisting a normalized event',async()=>{const {repo,connect}=fixture(false);await expect(repo.finish({record,outcome})).rejects.toThrow('Webhook repository unavailable');expect(connect).not.toHaveBeenCalled();});
});
