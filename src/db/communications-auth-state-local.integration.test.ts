import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { localCampaignDatabase } from '../../scripts/campaign-integration-support.mjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPostgresAuthStateRepository, type AuthStateSnapshot, type AuthStateRepositoryOptions } from '../../communications/packages/storage-postgres/src/auth-state-repository';
import type { SqlClient, SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import type { ConnectionBinding } from '../../communications/packages/contracts/src';
import { createCommunicationsLocalFixture } from './communications-local-test-support';

const enabled=process.env.COMMUNICATIONS_AUDIT_LOCAL_DB==='1';
describe.skipIf(!enabled)('isolated PostgreSQL single-use authenticated setup states',()=>{
 const local=createCommunicationsLocalFixture(),createdConnections=new Set<string>();beforeAll(()=>local.preflight());afterAll(async()=>{for(const id of createdConnections)await local.pool.query('UPDATE communications.connections SET active=false WHERE id=$1',[id]);await local.close();});
 async function bind(client:SqlClient,state:Readonly<AuthStateSnapshot>):Promise<ConnectionBinding> {
  const accountId=state.reconnectBinding?.accountId??`setup-account-${randomUUID()}`;
  const binding:ConnectionBinding={...state.scope,connectionId:state.expectedConnectionId,accountId,generation:state.expectedGeneration,channel:state.channel,platform:state.platform,backend:'unipile'};
  if(!state.reconnectBinding){
   await client.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'setup_fixture',$3,'fixture-v1',clock_timestamp())",[accountId,binding.channel,createHash('sha256').update(accountId).digest('hex')]);
   await client.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,'unipile',1,'connected',true)",[binding.connectionId,binding.applicationId,binding.tenantId,binding.ownerId,binding.accountId,binding.channel,binding.platform]);
  }
  await client.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,provider_account_digest,encrypted_provider_account_id,provider_account_key_version,authority,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'unipile','setup-integration','v1','setup-configuration',$9,'synthetic-encrypted-provider-identity','setup-key','service','{}')",[binding.connectionId,binding.generation,binding.applicationId,binding.tenantId,binding.ownerId,binding.accountId,binding.channel,binding.platform,createHash('sha256').update(accountId).digest('hex')]);
  if(state.reconnectBinding)await client.query('UPDATE communications.connections SET current_generation=$2 WHERE id=$1',[binding.connectionId,binding.generation]);
  createdConnections.add(binding.connectionId);return binding;
 }
 function repo(binding:ConnectionBinding,overrides:Partial<AuthStateRepositoryOptions>={}){
  return createPostgresAuthStateRepository({pool:local.driver,scope:{applicationId:binding.applicationId,tenantId:binding.tenantId,ownerId:binding.ownerId},channel:binding.channel,platform:binding.platform,backend:'unipile',redirectOrigin:'https://app.example.test',authenticateNotification:async()=>true,bindNotification:bind,...overrides});
 }
 it.each(['email','whatsapp','linkedin'] as const)('persists only a random nonce digest and atomically binds %s callback',async channel=>{
  const f=await local.fixture(channel),repository=repo(f.binding),issued=await repository.issue();expect(issued.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const {rows}=await local.pool.query('SELECT * FROM communications.auth_states WHERE application_id=$1',[f.binding.applicationId]);expect(rows).toHaveLength(1);expect(rows[0].state_digest).toBe(createHash('sha256').update(issued.nonce).digest('hex'));expect(JSON.stringify(rows)).not.toContain(issued.nonce);expect(rows[0].consumed_at).toBeNull();
  const result=await repository.complete({nonce:issued.nonce,notification:{synthetic:true}});expect(result.status).toBe('completed');if(result.status!=='completed')throw Error('Expected synthetic completion');expect(result.binding).toMatchObject({connectionId:issued.expectedConnectionId,generation:1,channel,ownerId:f.binding.ownerId});
  const {rows:[state]}=await local.pool.query('SELECT consumed_at FROM communications.auth_states WHERE state_digest=$1',[rows[0].state_digest]);expect(state.consumed_at).not.toBeNull();
 });
 it('allows exactly one concurrent binder and recovers the exact same binding on replay',async()=>{
  const f=await local.fixture(),binder=vi.fn(bind),repository=repo(f.binding,{bindNotification:binder}),issued=await repository.issue();const results=await Promise.all([repository.complete({nonce:issued.nonce,notification:{}}),repository.complete({nonce:issued.nonce,notification:{}})]);expect(results.map(r=>r.status).sort()).toEqual(['completed','consumed']);expect(binder).toHaveBeenCalledOnce();const success=results.find(r=>r.status==='completed');const replay=results.find(r=>r.status==='consumed');expect(success).toHaveProperty('binding');expect(replay).toHaveProperty('binding',(success as {binding:ConnectionBinding}).binding);
 });
 it('rejects unauthenticated notifications before entering SQL or invoking the binder',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue(),binder=vi.fn(bind),connect=vi.fn(async()=>{throw Error('Unexpected SQL');});const repository=repo(f.binding,{pool:{connect},authenticateNotification:async()=>false,bindNotification:binder});expect(await repository.complete({nonce:issued.nonce,notification:{scope:{ownerId:'attacker'}}})).toEqual({status:'rejected',code:'unauthenticated'});expect(connect).not.toHaveBeenCalled();expect(binder).not.toHaveBeenCalled();
 });
 it('requires authenticated provider notification correlation to the exact issued nonce',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue(),binder=vi.fn(bind),connect=vi.fn(async()=>{throw Error('Unexpected callback SQL');});
  const verifier=vi.fn(async(input:unknown)=>{const value=input as {nonce?:string;notification?:{name?:string;token?:string}};return value.notification?.token==='synthetic-auth-token' && value.notification?.name===value.nonce;});
  const repository=repo(f.binding,{pool:{connect},authenticateNotification:verifier,bindNotification:binder});expect(await repository.complete({nonce:issued.nonce,notification:{name:'wrong-setup-state',token:'synthetic-auth-token'}})).toEqual({status:'rejected',code:'unauthenticated'});
  const authenticated=verifier.mock.calls[0]?.[0] as {nonce?:string}|undefined;expect(authenticated?.nonce===issued.nonce).toBe(true);expect(connect).not.toHaveBeenCalled();expect(binder).not.toHaveBeenCalled();
 });
 it('rejects expired states and revoked owner grants without binding',async()=>{
  const f=await local.fixture(),binder=vi.fn(bind),repository=repo(f.binding,{ttlSeconds:1,bindNotification:binder}),issued=await repository.issue();await new Promise(resolve=>setTimeout(resolve,1200));expect(await repository.complete({nonce:issued.nonce,notification:{}})).toEqual({status:'rejected',code:'expired'});expect(binder).not.toHaveBeenCalled();
  const second=await repo(f.binding).issue();await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1',[f.binding.applicationId]);expect(await repository.complete({nonce:second.nonce,notification:{}})).toEqual({status:'rejected',code:'forbidden'});
 });
 it('rolls back binder writes and nonce consumption on callback failure then permits retry',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue(),broken=repo(f.binding,{async bindNotification(client,state){await bind(client,state);throw Error('Synthetic private callback detail');}});await expect(broken.complete({nonce:issued.nonce,notification:{}})).rejects.toThrow('Auth-state repository unavailable');
  const {rows:[state]}=await local.pool.query('SELECT consumed_at FROM communications.auth_states WHERE state_digest=$1',[createHash('sha256').update(issued.nonce).digest('hex')]);expect(state.consumed_at).toBeNull();const {rows:connections}=await local.pool.query('SELECT id FROM communications.connections WHERE id=$1',[issued.expectedConnectionId]);expect(connections).toHaveLength(0);expect((await repo(f.binding).complete({nonce:issued.nonce,notification:{}})).status).toBe('completed');
 });
 it('rejects a callback that returns an unpersisted or wrong-scope binding',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue();await expect(repo(f.binding,{async bindNotification(_client,state){return {...f.binding,connectionId:state.expectedConnectionId};}}).complete({nonce:issued.nonce,notification:{}})).rejects.toThrow('Auth-state repository unavailable');
  await expect(repo(f.binding,{async bindNotification(client,state){const result=await bind(client,state);return {...result,ownerId:'other'};}}).complete({nonce:issued.nonce,notification:{}})).rejects.toThrow('Auth-state repository unavailable');
 });
 it('reconnects only the recorded connection and physical account at the next generation',async()=>{
  const f=await local.fixture(),repository=repo(f.binding),initial=await repository.issue(),connected=await repository.complete({nonce:initial.nonce,notification:{}});if(connected.status!=='completed')throw Error('Expected verified fixture connection');const original=connected.binding;const issued=await repository.issue({reconnectBinding:original});expect(issued).toMatchObject({expectedConnectionId:original.connectionId,expectedGeneration:2});const result=await repository.complete({nonce:issued.nonce,notification:{}});expect(result).toEqual({status:'completed',binding:{...original,generation:2}});
  const replay=await repository.complete({nonce:issued.nonce,notification:{}});expect(replay).toEqual({status:'consumed',binding:{...original,generation:2}});
 });
 it('rejects a reconnect whose recorded generation changed before callback',async()=>{
  const f=await local.fixture(),initialRepo=repo(f.binding),initial=await initialRepo.issue(),connected=await initialRepo.complete({nonce:initial.nonce,notification:{}});if(connected.status!=='completed')throw Error('Expected verified fixture connection');const binder=vi.fn(bind),repository=repo(f.binding,{bindNotification:binder}),issued=await repository.issue({reconnectBinding:connected.binding}),other=await repository.issue({reconnectBinding:connected.binding});expect((await repository.complete({nonce:other.nonce,notification:{}})).status).toBe('completed');expect(await repository.complete({nonce:issued.nonce,notification:{}})).toEqual({status:'rejected',code:'reconnect_changed'});expect(binder).toHaveBeenCalledOnce();
 });
 it('recovers an immutable historical reconnect result after later generations advance',async()=>{
  const f=await local.fixture(),repository=repo(f.binding),initial=await repository.issue(),connected=await repository.complete({nonce:initial.nonce,notification:{}});if(connected.status!=='completed')throw Error('Expected verified fixture connection');const first=await repository.issue({reconnectBinding:connected.binding});const result=await repository.complete({nonce:first.nonce,notification:{}});if(result.status!=='completed')throw Error('Expected completed fixture');const second=await repository.issue({reconnectBinding:result.binding});expect((await repository.complete({nonce:second.nonce,notification:{}})).status).toBe('completed');expect(await repository.complete({nonce:first.nonce,notification:{}})).toEqual({status:'consumed',binding:result.binding});
 });
 it('prevents a binder from committing account writes outside nonce consumption',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue(),repository=repo(f.binding,{async bindNotification(client,state){await bind(client,state);await client.query('COMMIT');throw Error('Synthetic failed callback after attempted early commit');}});
  await expect(repository.complete({nonce:issued.nonce,notification:{}})).rejects.toThrow('Auth-state repository unavailable');const {rows}=await local.pool.query('SELECT id FROM communications.connections WHERE id=$1',[issued.expectedConnectionId]);expect(rows).toHaveLength(0);
 });
 it('rolls back account creation when setup expiry elapses during the binder',async()=>{
  const f=await local.fixture(),repository=repo(f.binding,{ttlSeconds:1,async bindNotification(client,state){const binding=await bind(client,state);await new Promise(resolve=>setTimeout(resolve,1200));return binding;}}),issued=await repository.issue();expect(await repository.complete({nonce:issued.nonce,notification:{}})).toEqual({status:'rejected',code:'expired'});
  const {rows}=await local.pool.query('SELECT id FROM communications.connections WHERE id=$1',[issued.expectedConnectionId]);expect(rows).toHaveLength(0);const {rows:[state]}=await local.pool.query('SELECT consumed_at FROM communications.auth_states WHERE state_digest=$1',[createHash('sha256').update(issued.nonce).digest('hex')]);expect(state.consumed_at).toBeNull();
 });
 it('rolls back account creation when the current grant expires during the binder',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue();await local.pool.query("UPDATE communications.access_grants SET expires_at=clock_timestamp()+interval '1 second' WHERE application_id=$1",[f.binding.applicationId]);
  const repository=repo(f.binding,{async bindNotification(client,state){const binding=await bind(client,state);await new Promise(resolve=>setTimeout(resolve,1200));return binding;}});expect(await repository.complete({nonce:issued.nonce,notification:{}})).toEqual({status:'rejected',code:'forbidden'});const {rows}=await local.pool.query('SELECT id FROM communications.connections WHERE id=$1',[issued.expectedConnectionId]);expect(rows).toHaveLength(0);
 });
 it('derives the binding owner from persisted setup scope rather than callback body IDs',async()=>{
  const f=await local.fixture(),repository=repo(f.binding),issued=await repository.issue(),result=await repository.complete({nonce:issued.nonce,notification:{ownerId:'attacker',tenantId:'other-tenant'}});expect(result.status).toBe('completed');if(result.status!=='completed')throw Error('Expected completed fixture');expect(result.binding.ownerId).toBe(f.binding.ownerId);expect(result.binding.tenantId).toBe(f.binding.tenantId);
 });
 it('rejects a reconnect callback that attempts a different physical account and rolls back generation',async()=>{
  const f=await local.fixture(),repository=repo(f.binding),initial=await repository.issue(),connected=await repository.complete({nonce:initial.nonce,notification:{}});if(connected.status!=='completed')throw Error('Expected verified fixture');const issued=await repository.issue({reconnectBinding:connected.binding});
  const broken=repo(f.binding,{async bindNotification(client,state){const result=await bind(client,state);return {...result,accountId:'other-physical-account'};}});await expect(broken.complete({nonce:issued.nonce,notification:{}})).rejects.toThrow('Auth-state repository unavailable');const {rows:[connection]}=await local.pool.query('SELECT current_generation FROM communications.connections WHERE id=$1',[connected.binding.connectionId]);expect(connection.current_generation).toBe(1);const {rows:generations}=await local.pool.query('SELECT generation FROM communications.connection_generations WHERE connection_id=$1 AND generation=2',[connected.binding.connectionId]);expect(generations).toHaveLength(0);
 });
 it('never returns a binder-contaminated session to the pool after a successful commit',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue(),pool=new pg.Pool({connectionString:localCampaignDatabase,max:1,application_name:'auth-review-clean'});
  const driver:SqlPool={async connect(){const client=await pool.connect();return {async query<Row>(text:string,values?:unknown[]){const result=await client.query(text,values);return {rows:result.rows as Row[],rowCount:result.rowCount};},release(error?:Error){client.release(error);}};}};
  try{const repository=repo(f.binding,{pool:driver,async bindNotification(client,state){await client.query("SELECT set_config('application_name',$1,false)",['auth-review-poisoned']);return bind(client,state);}});expect((await repository.complete({nonce:issued.nonce,notification:{}})).status).toBe('completed');
   const client=await pool.connect();try{const {rows:[session]}=await client.query("SELECT current_setting('application_name') AS name, current_user AS role");expect(session).toEqual({name:'auth-review-clean',role:'acquire_channels'});}finally{client.release();}
  }finally{await pool.end();}
 });
 it('bounds a stalled binder, releases transaction locks safely and prevents late writes',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue();let release!:()=>void;const stalled=new Promise<void>(resolve=>{release=resolve;});
  const repository=repo(f.binding,{transactionTimeoutMs:50,statementTimeoutMs:30,lockTimeoutMs:10,async bindNotification(client,state){const result=await bind(client,state);await stalled;return result;}} as Partial<AuthStateRepositoryOptions>);
  const pending=repository.complete({nonce:issued.nonce,notification:{}});const settled=pending.then(()=> 'completed',()=> 'unavailable');
  try{const result=await Promise.race([settled,new Promise<string>(resolve=>setTimeout(()=>resolve('still_pending'),200))]);expect(result).toBe('unavailable');}
  finally{release();await settled;}
  const {rows}=await local.pool.query('SELECT id FROM communications.connections WHERE id=$1',[issued.expectedConnectionId]);expect(rows).toHaveLength(0);const {rows:[state]}=await local.pool.query('SELECT consumed_at FROM communications.auth_states WHERE state_digest=$1',[createHash('sha256').update(issued.nonce).digest('hex')]);expect(state.consumed_at).toBeNull();
 });
 it('never commits after a synchronous binder overrun that starves the deadline timer',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue();const repository=repo(f.binding,{transactionTimeoutMs:80,statementTimeoutMs:50,lockTimeoutMs:10,async bindNotification(client,state){const result=await bind(client,state);const end=performance.now()+120;while(performance.now()<end){/* Synthetic trusted callback blocks timers. */}return result;}});
  await expect(repository.complete({nonce:issued.nonce,notification:{}})).rejects.toThrow('Auth-state repository unavailable');
  const {rows}=await local.pool.query('SELECT id FROM communications.connections WHERE id=$1',[issued.expectedConnectionId]);expect(rows).toHaveLength(0);const {rows:[state]}=await local.pool.query('SELECT consumed_at FROM communications.auth_states WHERE state_digest=$1',[createHash('sha256').update(issued.nonce).digest('hex')]);expect(state.consumed_at).toBeNull();
 });
 it('serializes concurrent reconnect states without deadlock or duplicate generations',async()=>{
  const f=await local.fixture(),initialRepo=repo(f.binding),initial=await initialRepo.issue(),connected=await initialRepo.complete({nonce:initial.nonce,notification:{}});if(connected.status!=='completed')throw Error('Expected verified fixture');
  const binder=vi.fn(async(client:SqlClient,state:Readonly<AuthStateSnapshot>)=>{await new Promise(resolve=>setTimeout(resolve,100));return bind(client,state);}),repository=repo(f.binding,{bindNotification:binder});
  const a=await repository.issue({reconnectBinding:connected.binding}),b=await repository.issue({reconnectBinding:connected.binding});const results=await Promise.all([repository.complete({nonce:a.nonce,notification:{}}),repository.complete({nonce:b.nonce,notification:{}})]);expect(results.map(r=>r.status).sort()).toEqual(['completed','rejected']);expect(results.find(r=>r.status==='rejected')).toEqual({status:'rejected',code:'reconnect_changed'});expect(binder).toHaveBeenCalledOnce();
 });
 it('recovers the recorded deterministic binding after a lost COMMIT response without rebinding',async()=>{
  const f=await local.fixture(),issued=await repo(f.binding).issue();let lost=false;const driver:SqlPool={async connect(){const client=await local.driver.connect();return {async query<Row>(text:string,values?:unknown[]){const result=await client.query<Row>(text,values);if(text==='COMMIT'&&!lost){lost=true;throw Object.assign(Error('Synthetic lost commit response'),{code:'ECONNRESET'});}return result;},release(error?:Error){client.release(error);}};}};const binder=vi.fn(bind),broken=repo(f.binding,{pool:driver,bindNotification:binder});await expect(broken.complete({nonce:issued.nonce,notification:{}})).rejects.toThrow('Auth-state repository unavailable');const recovered=await repo(f.binding,{bindNotification:binder}).complete({nonce:issued.nonce,notification:{}});expect(recovered.status).toBe('consumed');expect(recovered).toHaveProperty('binding.connectionId',issued.expectedConnectionId);expect(binder).toHaveBeenCalledOnce();
 });
});
