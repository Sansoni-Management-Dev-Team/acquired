// Run inside the isolated app container after bundling with the normal
// server-only marker plugin. Never imports a main-worktree environment.
import {Pool} from 'pg';
import {assertSimulatorProbeProfile,simulatorProbeOwnerScope} from '../src/lib/agent-simulator-probe-policy';
import {actorCommunicationsClient} from '../src/lib/communications-client';
import {saveManagedDefault} from '../src/lib/communications-bindings';
import type {Channel} from '../communications/packages/contracts/src';
import {UnipileV1Transport} from '../communications/packages/adapter-unipile/src/v1-http';
import {AcquisitionRepository} from '../src/db/acquisition-repository';
import {emptyBrief} from '../src/domain/acquisition';
import {createMandateContact} from '../src/lib/campaign-service';
import {configuredAcquireCommunications} from '../src/lib/communications-configuration';
import {readFileSync,statSync} from 'node:fs';
import {agentActorSchema} from '../src/db/agent-store';

async function main(){
 const action=process.argv[2]??'state',origin=assertSimulatorProbeProfile(process.env,action),ownerScope=simulatorProbeOwnerScope(origin,process.env.AGENT_SIMULATOR_PROBE_OWNER_FILE);if(origin==='https://127.0.0.1:5690'&&action==='setup'&&process.argv[3]!=='email')throw Error('Fifty-lead setup supports email only');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
 try{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  if(identity.name!=='acquire_agent_mode'||identity.marker!=='acquire-agent-mode-local-only')throw Error('Wrong local database');
  const ownerFile=process.env.AGENT_SIMULATOR_PROBE_OWNER_FILE;let actor;
  if(ownerFile){
   if(!ownerScope)throw Error('Explicit isolated owner required');
   const info=statSync(ownerFile);if(!info.isFile()||info.size>4096||(info.mode&0o077)!==0)throw Error('Private bounded pilot owner required');
   actor=agentActorSchema.parse(JSON.parse(readFileSync(ownerFile,'utf8')).actor);if(actor.organizationId!==ownerScope.organizationId)throw Error('Exact isolated pilot organization required');
   if(!(await pool.query("SELECT id FROM member WHERE organization_id=$1 AND user_id=$2 AND role='owner'",[actor.organizationId,actor.userId])).rowCount)throw Error('Current explicit owner membership required');
  }else{
   const owner=(await pool.query('SELECT c.tenant_id,c.owner_id FROM communications.connections c JOIN public.member m ON m.organization_id=c.tenant_id AND m.user_id=c.owner_id ORDER BY c.created_at LIMIT 1')).rows[0];
   if(!owner)throw Error('Existing authorized local owner required');actor={organizationId:owner.tenant_id,userId:owner.owner_id};
  }
  const scope={applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId};
  const client=await actorCommunicationsClient(actor);
  if(action==='seed'){
   const leads=JSON.parse(readFileSync('/workspace/.local-data/agent-mode-orbstack/simulator-leads.json','utf8'));
   if(!Array.isArray(leads)||leads.length!==5||leads.some(l=>typeof l.email!=='string'||!/^lead-00[1-5]@agent-mode-20261017\.leads\.acquire\.test$/.test(l.email)))throw Error('Exact five fictional leads required');
   const existing=await pool.query('SELECT id,created_by,natural_language FROM mandates WHERE organization_id=$1 AND confirmation=$2',[actor.organizationId,'Simulator — OrbStack local test']);if((existing.rowCount??0)>1)throw Error('Ambiguous fixture');
   const brief={...emptyBrief(),name:'Simulator — OrbStack local test',naturalLanguage:'Local testing only. These five fictional leads route exclusively to the local simulated Unipile provider. Qualification and business facts remain unverified.',investmentThesis:'Exercise the isolated acquisition agent against fictional leads.',outreachPositioning:'Synthetic local test.',disclosureApproved:false};
   if(existing.rows[0]&&(existing.rows[0].created_by!==actor.userId||existing.rows[0].natural_language!==brief.naturalLanguage))throw Error('Original fixture differs');
   const mandateId=existing.rows[0]?.id??await new AcquisitionRepository(actor.organizationId).saveBrief(brief,actor.userId),contacts=[];
   const prior=(await pool.query('SELECT id,display_name,personal_data FROM contacts WHERE mandate_id=$1 AND organization_id=$2',[mandateId,actor.organizationId])).rows;
   if(prior.length>5||prior.some(c=>!leads.some(l=>l.email===c.personal_data.email&&c.display_name==='[SIMULATED] '+l.name)))throw Error('Foreign contact in fixture');
   for(const lead of leads){
    const matches=prior.filter(c=>c.personal_data.email===lead.email);if(matches.length>1)throw Error('Ambiguous fixture contact');
    const contact=matches[0]??await createMandateContact(actor,mandateId,{fullName:'[SIMULATED] '+lead.name,email:lead.email,company:lead.company,phone:lead.phone,linkedinUrl:lead.linkedin,jobTitle:'Synthetic owner'});
    // Operational fixture annotation only. The normal user role intentionally
    // cannot relabel source/provenance; no grant or policy is changed here.
    const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[actor.organizationId,actor.userId]);await c.query('SELECT communications_lock_send_gate($1)',[actor.organizationId]);const changed=await c.query('UPDATE contacts SET fictionalised=true,provenance=provenance || $4::jsonb WHERE id=$1 AND mandate_id=$2 AND organization_id=$3 AND personal_data->>\'email\'=$5 RETURNING id',[contact.id,mandateId,actor.organizationId,JSON.stringify({source:'Local simulator fixture',runId:'agent-mode-20261017',fictional:true}),lead.email]);if(changed.rowCount!==1)throw Error('Fixture contact changed');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    contacts.push({id:contact.id,leadId:lead.id,email:lead.email});
   }
   console.log(JSON.stringify({mandateId,contacts,executed:false}));
  }else if(action==='sync'){
   const configured=configuredAcquireCommunications();if(!await configured.host.renewScope(scope))throw Error('Current owner unavailable');
   const current=await client.connections(scope),results=[];
   for(const connection of current.connections){const source=await configured.host.history(connection.binding);const result=await source.refresh({binding:connection.binding,scope:'account',since:new Date(Date.now()-300000).toISOString(),cursor:null,refresh:true},{signal:AbortSignal.timeout(25000)});results.push({channel:connection.binding.channel,result});}
   console.log(JSON.stringify({results}));
  }else if(action==='transport-smoke'){
   const response=await fetch('https://127.0.0.1:5490/api/v1/accounts',{headers:{'x-api-key':process.env.UNIPILE_API_KEY!},signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Mock account read failed');
   const account=(await response.json()).items.find((a:{type:string})=>a.type==='GOOGLE_OAUTH');if(!account)throw Error('Mock email account missing');
   const transport=new UnipileV1Transport({apiVersion:'v1',baseUrl:'https://127.0.0.1:5490/api/v1',apiKey:process.env.UNIPILE_API_KEY!,timeoutMs:5000});
   const result=await transport.sendEmail(account.id,{to:[{identifier:'lead-001@agent-mode-20261017.leads.acquire.test'}],subject:'Local bridge smoke test',body:'Synthetic local connectivity check. No real mailbox is involved.'},'agent-mode-bridge-smoke-email-v1');
   if(result.kind!=='success')throw Error('Mock transport send failed');console.log(JSON.stringify({scope:'app-container actual Unipile HTTP transport only; not native agent admission',...result}));
  }else if(action==='setup'){
   const channel=process.argv[3] as Channel;if(!['email','whatsapp','linkedin'].includes(channel))throw Error('Choose a channel');
   const current=await client.connections(scope);if(current.connections.some(c=>c.binding.channel===channel))throw Error('Existing mock connection; inspect rather than recreate');
   const result=await client.setupConnection(scope,{channel,platform:channel==='email'?'gmail':channel});
   console.log(JSON.stringify({channel,...result}));
  }else if(action==='state'||action==='default'){
   const listed=await client.connections(scope);const connections=[];
   for(const c of listed.connections){let current=await client.connectionStatus(c.binding);if(action==='default'&&current.readiness.status==='ready'){current=await client.setDefaultConnection(current.binding);await saveManagedDefault(actor,current);}connections.push(current);}
   console.log(JSON.stringify({available:listed.available,connections}));
  }else throw Error('Choose setup, state, default, sync, seed or transport-smoke');
 }finally{await pool.end();}
}
void main().then(()=>process.exit(0)).catch(()=>{console.error('Isolated simulator probe failed; inspect profile, owner and service readiness');process.exit(1);});
