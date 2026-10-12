import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCommunicationsLocalFixture } from './communications-local-test-support';
import { EventCodec } from '../../communications/packages/core/src/event-codec';
import { createPostgresWebhookRepository } from '../../communications/packages/storage-postgres/src/webhook-repository';

describe.skipIf(process.env.COMMUNICATIONS_AUDIT_LOCAL_DB!=='1')('normalized review history integrity in isolated PostgreSQL',()=>{
  const local=createCommunicationsLocalFixture();
  const eventCodec=new EventCodec({activeVersion:'review-v1',keys:[{version:'review-v1',encryptionKey:Buffer.alloc(32,131),digestKey:Buffer.alloc(32,132)}]});
  beforeAll(local.preflight);afterAll(local.close);
  it.each(['plaintext_time','receipt_time'] as const)('does not complete a review with contradictory %s',async variant=>{
    const f=await local.fixture(),capture=f.capture();
    const repo=createPostgresWebhookRepository({pool:local.driver,binding:f.binding,integrationId:'terminal-integration',providerConfigurationReference:'terminal-configuration',subscriberId:'review-subscriber',codec:local.webhookCodec,eventCodec});
    await repo.capture(capture);const claim=await repo.claim({binding:f.binding,key:capture.key});if(claim.kind!=='claimed')throw Error('Synthetic claim failed');
    const b=f.binding,scope=[b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,b.generation,b.channel,b.platform,b.backend];
    const fingerprint=createHash('sha256').update(JSON.stringify(['communications.reply.review.v1',scope,capture.key,'protocol'])).digest('hex');
    const outcome={kind:'review' as const,code:'protocol' as const};
    const storedTime=variant==='receipt_time'?new Date(Date.parse(capture.receivedAt)-60000).toISOString():capture.receivedAt;
    const encrypted=eventCodec.encode({binding:b,key:capture.key},{outcome,fingerprint,receivedAt:storedTime});
    await local.pool.query(`INSERT INTO communications.events(application_id,tenant_id,owner_id,connection_id,generation,account_id,source_namespace,source_event_key,event_type,direction,occurred_at,encrypted_event,key_version,webhook_inbox_id)
      VALUES($1,$2,$3,$4,$5,$6,'reply_review/v1',$7,'account',NULL,$8,$9,$10,$7)`,[b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.generation,b.accountId,capture.key,new Date(Date.parse(capture.receivedAt)-60000),JSON.stringify(encrypted),encrypted.keyVersion]);
    await expect(repo.finish({record:claim.record,outcome})).rejects.toThrow('Webhook repository unavailable');
    const {rows:[inbox]}=await local.pool.query('SELECT state FROM communications.webhook_inbox WHERE id=$1',[capture.key]);expect(inbox.state).toBe('processing');
    const {rows:[count]}=await local.pool.query('SELECT count(*)::int AS count FROM communications.event_outbox WHERE application_id=$1',[b.applicationId]);expect(count.count).toBe(0);
  });
});
