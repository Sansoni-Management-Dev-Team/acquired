// Native failure-boundary proof. No PostgreSQL socket, credentials, provider request or migration.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {createPostgresAuthStateRepository}=require(resolve(process.argv[2]??'communications/dist/packages/storage-postgres/src/auth-state-repository.js'));
const scope={applicationId:'fixture-app',tenantId:'fixture-tenant',ownerId:'fixture-owner'};
let stored,phase='issue',rejectPending,releases=0,unhandled=false;
const completionStatements=[];
process.on('unhandledRejection',()=>{unhandled=true;});
const client={async query(sql,values=[]){
  if(phase==='complete')completionStatements.push(sql);
  if(sql.includes('FROM pg_roles'))return {rows:[{role_name:'communications_control',rolsuper:false,rolbypassrls:false,rolcanlogin:false}]};
  if(sql.includes('FROM communications.access_grants'))return {rows:[{application_id:scope.applicationId,tenant_id:scope.tenantId,owner_id:scope.ownerId}]};
  if(sql.includes('INSERT INTO communications.auth_states')){
    stored={state_digest:values[0],application_id:values[1],tenant_id:values[2],owner_id:values[3],channel:values[4],platform:values[5],backend:values[6],redirect_origin:values[7],reconnect_connection_id:null,reconnect_generation:null,created_at:new Date(),expires_at:new Date(Date.now()+60000),consumed_at:null,alive:true};
    return {rows:[{expires_at:stored.expires_at}]};
  }
  if(sql.includes('FROM communications.auth_states'))return {rows:[stored]};
  if(sql==='SELECT fixture_pending_query')return new Promise((_resolve,reject)=>{rejectPending=reject;});
  return {rows:[]};
},release(error){if(phase==='complete'){assert.ok(error);releases++;rejectPending?.(Error('Synthetic closed session'));}}};
const repository=createPostgresAuthStateRepository({pool:{async connect(){return client;}},scope,channel:'whatsapp',platform:'whatsapp',backend:'unipile',redirectOrigin:'https://fixture.invalid',
  async authenticateNotification(){return true;},async bindNotification(sql){
    // Fault injection into a trusted callback: do not return this active query, then reject.
    void sql.query('SELECT fixture_pending_query');
    throw Error('Synthetic binder rejection');
  },});
const {nonce}=await repository.issue();phase='complete';
await assert.rejects(repository.complete({nonce,notification:{name:nonce}}),/Auth-state repository unavailable/);
await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(releases,1,'Retire the session exactly once');
assert.equal(completionStatements.includes('ROLLBACK'),false,'Do not race rollback against active SQL');
assert.equal(completionStatements.includes('COMMIT'),false,'Do not commit the incomplete callback');
assert.equal(unhandled,false,'Observe the exact callback-client promise after disposing active SQL');
process.stdout.write('Native auth callback failure handled: one discarded session, no overlapping rollback, late commit or unhandled rejection.\n');
