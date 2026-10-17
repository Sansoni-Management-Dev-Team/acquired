import 'server-only';
import { auth } from './auth';
import { hasTrustedRequestOrigin } from './request-origin';
import { withCampaignDb } from '../db/campaign-client';
import { CommunicationsClient } from '../../communications/packages/sdk/src';
import { createScopedServiceAuth } from '../../communications/packages/core/src/scoped-service-auth';
import { assertManagementBinding, type ConnectionSetupRequest } from '../../communications/packages/contracts/src/management';
import { parseBinding } from '../../communications/services/api/src/schema';
import { readManagedDefaults, saveManagedDefault } from './communications-bindings';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
async function readBody(request:Request) {
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!request.body)throw Error('Invalid body');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let count=0,timer:ReturnType<typeof setTimeout>|undefined;
 try {const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Invalid body')),5000);});
  for(;;){const result=await Promise.race([reader.read(),deadline]);if(result.done)break;count+=result.value.byteLength;if(count>8192)throw Error('Invalid body');chunks.push(result.value);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 }finally{clearTimeout(timer);void reader.cancel().catch(()=>undefined);}
}
export async function connectionManagementRequest(request: Request): Promise<Response> {
 const session=await auth.api.getSession({headers:request.headers});
 if(!session)return respond({error:'Sign in to manage connections'},401);
 const tenant=session.session.activeOrganizationId;if(!tenant)return respond({error:'Choose an organisation'},403);
 if(request.method!=='GET'&&request.method!=='POST')return respond({error:'Unsupported method'},405);
 if(request.method==='POST'&&!hasTrustedRequestOrigin(request))return respond({error:'Invalid origin'},403);
 const scope={applicationId:process.env.COMMUNICATIONS_APPLICATION_ID||'acquire',tenantId:tenant,ownerId:session.user.id};
 let action:string|undefined,raw:Record<string,unknown>={},binding:ReturnType<typeof parseBinding>|undefined,setup:ConnectionSetupRequest|undefined;
 if(request.method==='POST')try {
  const data=await readBody(request);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid');raw=data;action=String(raw.action);
  const fields:Record<string,string[]>={setup:['action','channel','platform','reconnectBinding'],status:['action','binding'],disconnect:['action','binding','key'],default:['action','binding']};
  if(!fields[action]||Object.keys(raw).some(k=>!fields[action!].includes(k)))throw Error('Invalid');
  if(action==='setup'){
   if(typeof raw.platform !== 'string'||!(raw.channel==='email'&&['gmail','outlook','imap'].includes(String(raw.platform))||raw.channel==='whatsapp'&&raw.platform==='whatsapp'||raw.channel==='linkedin'&&raw.platform==='linkedin'))throw Error('Invalid');
   setup={channel:raw.channel as ConnectionSetupRequest['channel'],platform:raw.platform as ConnectionSetupRequest['platform']};
   if(raw.reconnectBinding!==undefined){binding=parseBinding(raw.reconnectBinding);assertManagementBinding(binding,scope);if(binding.channel!==setup.channel||binding.platform!==setup.platform)throw Error('Invalid');setup.reconnectBinding=binding;}
  }else{binding=parseBinding(raw.binding);assertManagementBinding(binding,scope);if(action==='disconnect'&&(typeof raw.key!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(raw.key)))throw Error('Invalid');}
 }catch{return respond({error:'Invalid connection request'},400);}
 try {await withCampaignDb({organizationId:tenant,userId:session.user.id},async()=>undefined);}catch{return respond({error:'Connection access unavailable'},403);}
 if(process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')return respond({available:false,connections:[],checkedAt:new Date().toISOString()},503);
 let client:CommunicationsClient;
 try {
  const encoded=process.env.COMMUNICATIONS_SCOPED_AUTH_KEY||'';if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded))throw Error('Invalid configuration');
  const key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw Error('Invalid configuration');
  const signer=createScopedServiceAuth({key,audience:'communications',applicationId:scope.applicationId,authorize:async()=>false});
  client=new CommunicationsClient({baseUrl:process.env.COMMUNICATIONS_SERVICE_URL||'',contractVersion:'1',apiKey:signer.issue(scope),allowLoopbackHttp:process.env.NODE_ENV!=='production',timeoutMs:28000,...(process.env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN?{localSimulatorOrigin:process.env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN}:{})});
 }catch{return respond({available:false,connections:[],checkedAt:new Date().toISOString()},503);}
 try {
  if(request.method==='GET'){
   const snapshot=await client.connections(scope),defaults=await readManagedDefaults({organizationId:tenant,userId:session.user.id});
   return respond({...snapshot,connections:snapshot.connections.map(c=>({...c,isDefault:defaults.some(d=>d.channel===c.binding.channel&&d.connectionId===c.binding.connectionId&&d.generation===c.binding.generation&&d.accountId===c.binding.accountId)}))});
  }
  if(action==='setup')return respond(await client.setupConnection(scope,setup!));
  if(action==='status')return respond(await client.connectionStatus(binding!));
  if(action==='default'){const selected=await client.setDefaultConnection(binding!);await saveManagedDefault({organizationId:tenant,userId:session.user.id},selected);return respond(selected);}
  return respond(await client.disconnectConnection(binding!,raw.key as string));
 }catch{return respond({error:'Connection service unavailable'},503);}
}
