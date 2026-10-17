import 'server-only';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import {CommunicationsClient} from '../../communications/packages/sdk/src';
import {createScopedServiceAuth} from '../../communications/packages/core/src/scoped-service-auth';
/** Only trusted application code can mint a scope, after current owner membership.
 * The service independently verifies the signature/expiry and renews a bounded grant. */
export async function actorCommunicationsClient(actor:CampaignActor):Promise<CommunicationsClient>{
 if(process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')throw Error('Communications runtime unavailable');
 await withCampaignDb(actor,async()=>undefined);
 try{
  const encoded=process.env.COMMUNICATIONS_SCOPED_AUTH_KEY||'';if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded))throw Error();const key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw Error();
  const applicationId=process.env.COMMUNICATIONS_APPLICATION_ID||'acquire';const signer=createScopedServiceAuth({key,audience:'communications',applicationId,authorize:async()=>false});
  return new CommunicationsClient({baseUrl:process.env.COMMUNICATIONS_SERVICE_URL||'',contractVersion:'1',apiKey:signer.issue({applicationId,tenantId:actor.organizationId,ownerId:actor.userId}),allowLoopbackHttp:process.env.NODE_ENV!=='production',timeoutMs:28000,...(process.env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN?{localSimulatorOrigin:process.env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN}:{})});
 }catch{throw Error('Communications runtime unavailable');}
}
