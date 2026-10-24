import type{HostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
import type{HostedRecipientQuery}from'./hosted-demo-recipient-context';
import type{SqlClient}from'../../communications/packages/storage-postgres/src/webhook-repository';
import{isDeepStrictEqual}from'node:util';
import{parseHostedRecipientRequest,parseHostedRecipientProjection}from'./hosted-demo-recipient-context';
export type HostedRecipientDb=<T>(work:(client:Pick<SqlClient,'query'>)=>Promise<T>)=>Promise<T>;
const mappingSql=`SELECT m.id AS mapping_id,m.contact_id,m.mandate_id,m.source_revision,m.source_fingerprint,m.wire,
 r.run_id,r.integration_id,r.configuration_ref,sender,to_jsonb(b) AS binding,
 public.agent_effective_contact(m.mandate_id,m.contact_id) AS effective,t.company_name,
 jsonb_build_object('sector',coalesce(t.firmographics->'sector',t.firmographics->'industry',t.firmographics->'industryName'),
 'region',coalesce(t.firmographics->'state',t.firmographics->'region',t.firmographics->'location'->'state'),
 'headcount',t.firmographics->'headcount','companySize',coalesce(t.firmographics->'headcountBand',t.firmographics->'employeeRange'),
 'establishedYear',t.firmographics->'establishedYear','description',coalesce(t.firmographics->'firmable'->'description',t.firmographics->'websiteProfile'->'description')) AS facts
 FROM public.agent_effective_demo_contact_mappings m
 JOIN public.agent_demo_runs r ON r.id=m.demo_run_id AND r.organization_id=m.organization_id AND r.owner_user_id=m.created_by
 JOIN LATERAL jsonb_array_elements(r.senders) sender ON sender->>'channel'=$4 AND sender->>'providerAccountId'=$5
 JOIN public.communication_bindings b ON b.id::text=sender->>'bindingId' AND b.organization_id=m.organization_id AND b.owner_user_id=m.created_by AND b.authority='service'
 JOIN public.contacts c ON c.id=m.contact_id AND c.organization_id=m.organization_id
 LEFT JOIN public.targets t ON t.id=c.target_id AND t.organization_id=c.organization_id
 WHERE m.organization_id=$1 AND m.created_by=$2 AND r.run_id=$3 AND m.wire->>$6=$7 LIMIT 2`;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
function clean(value:unknown,max=200){const v=value&&typeof value==='object'?object(value).value:value,text=typeof v==='number'&&Number.isFinite(v)?String(v):v;return typeof text==='string'&&text.trim()&&!/@|\+\d{7,}|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)?text.trim().slice(0,max):undefined;}
/** The original normal effective-contact definer validates current source CAS,
 * owned demo mapping and sender identity. No copied profile or raw addresses
 * leave this application-owned transaction. It supplies no sending authority. */
export function createHostedDemoRecipientResolver(input:HostedDemoCommunicationsDescriptor,db:HostedRecipientDb){
 const descriptor=structuredClone(input),scope={runId:descriptor.runId,organizationId:descriptor.actor.tenantId,userId:descriptor.actor.ownerId};
 return async(raw:HostedRecipientQuery)=>{
  try{const query=parseHostedRecipientRequest({version:1,kind:'recipient.resolve',scope,query:raw},descriptor);
   let value=query.value;const field=query.kind==='email'?'email':query.kind==='phone'?'phone':query.kind==='provider_id'||query.value.startsWith('ACo_sim_')?'providerId':'linkedin';
   if(query.channel==='email')value=value.toLowerCase();
   if(query.channel==='whatsapp'){value=value.replace(/@s\.whatsapp\.net$/,'');if(/^999\d{12}$/.test(value))value='+'+value;}
   if(query.channel==='linkedin'&&value.startsWith('sim-'))value='https://www.linkedin.com/in/'+value;
   return await db(async client=>{
    const rows=(await client.query(mappingSql,[scope.organizationId,scope.userId,scope.runId,query.channel,query.accountId,field,value])).rows;if(rows.length!==1)throw Error();const row=rows[0],b=object(row.binding),source=object(row.effective),person=object(source.sourceContact),demo=object(source.demoProjection),wire=object(row.wire),recipients=object(demo.recipients),data=object(person.personalData);
    const binding={applicationId:b.application_id,tenantId:b.organization_id,ownerId:b.owner_user_id,connectionId:b.service_connection_id,accountId:b.service_account_id,generation:b.generation,channel:b.channel,platform:b.platform,backend:b.backend};
    if(!descriptor.bindings.some(v=>isDeepStrictEqual(v,binding))||b.authority!=='service'||row.run_id!==scope.runId||row.integration_id!==descriptor.integrationId||row.configuration_ref!==descriptor.configurationReference||source.mode!=='demo'||person.id!==row.contact_id||person.revision!==row.source_revision||person.fingerprint!==row.source_fingerprint||person.fictionalised!==false||data.doNotContact!==undefined&&data.doNotContact!==false&&data.doNotContact!=='false'||demo.mappingId!==row.mapping_id||demo.demoId!==row.mandate_id||demo.runId!==scope.runId||demo.integrationId!==descriptor.integrationId||demo.configurationRef!==descriptor.configurationReference||demo.sourceRevision!==row.source_revision||demo.sourceFingerprint!==row.source_fingerprint||recipients.email!==wire.email||recipients.whatsapp!==wire.phone||recipients.linkedin!==wire.linkedin||demo.providerId!==wire.providerId||wire[field]!==value)throw Error();
    if(query.operationKey){const intents=await client.query("SELECT id FROM public.communication_dispatch_intents WHERE organization_id=$1 AND owner_user_id=$2 AND binding_id=$3 AND operation_key=$4 AND contact_id=$5 AND execution_mode='demo' AND execution_mandate_id=$6 LIMIT 2",[scope.organizationId,scope.userId,b.id,query.operationKey,row.contact_id,row.mandate_id]);if(intents.rows.length!==1)throw Error();}
    const facts:Record<string,string>={};for(const[key,rawValue]of Object.entries({...object(row.facts),role:person.role})){if(!['role','sector','region','headcount','companySize','establishedYear','description'].includes(key))continue;const v=clean(rawValue,key==='description'?2000:200);if(v)facts[key]=v;}
    return parseHostedRecipientProjection({scope,personId:row.contact_id,companyId:person.targetId,mandateId:row.mandate_id,mappingId:row.mapping_id,sourceRevision:row.source_revision,sourceFingerprint:row.source_fingerprint,name:clean(person.displayName),company:person.targetId===null?'Unknown saved company':clean(row.company_name),facts,aliases:{email:wire.email,phone:wire.phone,linkedin:wire.linkedin,providerId:wire.providerId}},descriptor,query);
   });
  }catch{throw Error('Hosted recipient unavailable');}
 };
}
