import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { localCampaignDatabase } from '../../scripts/campaign-integration-support.mjs';
import { WebhookCodec } from '../../communications/packages/core/src/webhook-codec';
import { createPostgresWebhookRepository, type SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import type { ConnectionBinding } from '../../communications/packages/contracts/src';
import type { WebhookCapture } from '../../communications/packages/core/src/reply-ingress';
import { createPostgresReplyBarrier } from '../../communications/packages/storage-postgres/src/reply-barrier';

// Explicit opt-in, exact isolated target only. No DDL, GRANT, migrations or schema setup.
// Committed synthetic immutable history is retained; accounts/grants are retired afterward.
const enabled=process.env.COMMUNICATIONS_AUDIT_LOCAL_DB==='1';
describe.skipIf(!enabled)('isolated PostgreSQL encrypted webhook capture and claims',()=>{
  const pool=new pg.Pool({connectionString:localCampaignDatabase,max:5,connectionTimeoutMillis:5000});
  const driver:SqlPool={async connect(){const client=await pool.connect();return {async query<Row>(text:string,values?:unknown[]){const result=await client.query(text,values);return {rows:result.rows as Row[],rowCount:result.rowCount};},release(error?:Error){client.release(error);}};}};
  const fixtures:ConnectionBinding[]=[];
  const codec=new WebhookCodec({activeVersion:'fixture-v1',keys:[{version:'fixture-v1',encryptionKey:Buffer.alloc(32,71),digestKey:Buffer.alloc(32,72)}]});
  beforeAll(async()=>{
    if(process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK!=='1')throw Error('Requires explicitly selected isolated channel database');
    const url=new URL(localCampaignDatabase);
    if(url.hostname!=='127.0.0.1'||url.port!=='5445'||url.pathname!=='/acquire_channels')throw Error('Unexpected database target');
    const {rows:[row]}=await pool.query("SELECT current_database() AS name, system_identifier::text AS identity, to_regclass('communications.webhook_inbox') AS inbox FROM pg_control_system()");
    if(row.name!=='acquire_channels'||row.identity!=='7694812678792806433')throw Error('Unexpected isolated database identity');
    if(!row.inbox)throw Error('Approved service schema is absent. This test never applies migrations; missing schema is a prerequisite failure, not a TDD red.');
  });
  afterAll(async()=>{
    for(const binding of fixtures){
      await pool.query('UPDATE communications.connections SET active=false WHERE id=$1',[binding.connectionId]);
      await pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3',[binding.applicationId,binding.tenantId,binding.ownerId]);
    }
    await pool.end();
  });
  async function fixture(channel:'email'|'whatsapp'|'linkedin'='whatsapp',leaseSeconds=60){
    const suffix=randomUUID(),binding:ConnectionBinding={applicationId:`fixture-${suffix}`,tenantId:'fixture-tenant',ownerId:'fixture-owner',connectionId:`fixture-connection-${suffix}`,accountId:`fixture-account-${suffix}`,generation:1,channel,platform:channel==='email'?'gmail':channel,backend:'unipile'};
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[binding.applicationId,binding.tenantId,binding.ownerId]);
      await client.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'fixture', $3,'fixture-v1',clock_timestamp())",[binding.accountId,channel,createHash('sha256').update(suffix).digest('hex')]);
      await client.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,'unipile',1,'connected',true)",[binding.connectionId,binding.applicationId,binding.tenantId,binding.ownerId,binding.accountId,channel,binding.platform]);
      await client.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,$6,$7,'unipile','fixture-integration','v1','fixture-configuration','service','{}')",[binding.connectionId,binding.applicationId,binding.tenantId,binding.ownerId,binding.accountId,channel,binding.platform]);
      await client.query('COMMIT');fixtures.push(binding);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    const repository=createPostgresWebhookRepository({pool:driver,binding,integrationId:'fixture-integration',providerConfigurationReference:'fixture-configuration',subscriberId:'fixture-subscriber',codec,leaseSeconds,replyBarrier:createPostgresReplyBarrier({binding,integrationId:'fixture-integration',codec})});
    const rawBody=Buffer.from(JSON.stringify({event:'message_received',account_id:'fixture-provider',message_id:suffix,text:'synthetic-incoming-text'}));
    const key=createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1',[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend],createHash('sha256').update(rawBody).digest('hex')])).digest('hex');
    const capture:WebhookCapture={binding,key,rawBody,receivedAt:new Date().toISOString()};
    return {binding,repository,capture};
  }
  it.each(['email','whatsapp','linkedin'] as const)('commits encrypted %s bytes before returning accepted',async channel=>{
    const f=await fixture(channel);expect(await f.repository.capture(f.capture)).toEqual({binding:f.binding,key:f.capture.key,status:'accepted'});
    const {rows}=await pool.query('SELECT * FROM communications.webhook_inbox WHERE id=$1',[f.capture.key]);
    expect(rows).toHaveLength(1);expect(JSON.stringify(rows[0])).not.toContain('synthetic-incoming-text');
    expect(codec.decode({binding:f.binding,key:f.capture.key},JSON.parse(rows[0].encrypted_payload)).rawBody).toEqual(Uint8Array.from(f.capture.rawBody));
  });
  it('deduplicates concurrent capture without replacing original ciphertext',async()=>{
    const f=await fixture();const results=await Promise.all([f.repository.capture(f.capture),f.repository.capture({...f.capture,receivedAt:new Date(Date.now()+1).toISOString()})]);
    expect(results.map(result=>result.status).sort()).toEqual(['accepted','duplicate']);
    const {rows:[before]}=await pool.query('SELECT encrypted_payload FROM communications.webhook_inbox WHERE id=$1',[f.capture.key]);
    expect((await f.repository.capture(f.capture)).status).toBe('duplicate');
    const {rows:[after]}=await pool.query('SELECT encrypted_payload FROM communications.webhook_inbox WHERE id=$1',[f.capture.key]);expect(after).toEqual(before);
  });
  it('allows one live claim and safely reclaims an expired worker lease',async()=>{
    const f=await fixture('whatsapp',1);await f.repository.capture(f.capture);
    const claims=await Promise.all([f.repository.claim({binding:f.binding,key:f.capture.key}),f.repository.claim({binding:f.binding,key:f.capture.key})]);
    expect(claims.map(c=>c.kind).sort()).toEqual(['busy','claimed']);
    const first=claims.find(c=>c.kind==='claimed');if(first?.kind!=='claimed')throw Error('Missing claim');
    await new Promise(resolve=>setTimeout(resolve,1200));
    const next=await f.repository.claim({binding:f.binding,key:f.capture.key});expect(next.kind).toBe('claimed');
    if(next.kind==='claimed'){expect(next.record.token).not.toBe(first.record.token);expect(next.record.rawBody).toEqual(Uint8Array.from(f.capture.rawBody));}
    const {rows:[row]}=await pool.query('SELECT attempts FROM communications.webhook_inbox WHERE id=$1',[f.capture.key]);expect(row.attempts).toBe(2);
  });
  it('rejects revoked grants without claiming or accepting new work',async()=>{
    const f=await fixture();await f.repository.capture(f.capture);
    await pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1',[f.binding.applicationId]);
    expect(await f.repository.claim({binding:f.binding,key:f.capture.key})).toEqual({kind:'forbidden'});
    await expect(f.repository.capture(f.capture)).rejects.toThrow('Webhook repository unavailable');
    const {rows:[row]}=await pool.query('SELECT state,attempts FROM communications.webhook_inbox WHERE id=$1',[f.capture.key]);expect(row).toEqual({state:'pending',attempts:0});
  });
  it('rejects a different owner and a reused key with altered bytes',async()=>{
    const f=await fixture();await f.repository.capture(f.capture);
    await expect(f.repository.capture({...f.capture,binding:{...f.binding,ownerId:'other'}})).rejects.toThrow('Webhook repository unavailable');
    await expect(f.repository.capture({...f.capture,rawBody:Buffer.from('{}')})).rejects.toThrow('Webhook repository unavailable');
    const {rows:[row]}=await pool.query('SELECT count(*)::int AS count FROM communications.webhook_inbox WHERE id=$1',[f.capture.key]);expect(row.count).toBe(1);
  });
});
