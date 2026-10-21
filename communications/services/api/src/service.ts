import {createCommunicationsServer,type CommunicationsServerDependencies} from './server';
import {createSetupCallbackServer,type SetupCallbackServerOptions} from './setup-callback-server';
import {createReplyWebhookServer,type ReplyWebhookServerDependencies} from './reply-webhook-server';
import {createCommunicationsListener,type CommunicationsAroundRequest} from './listener';
/** Deployable native service boundary. Callers supply their authentication, durable
 * journals, provider/account runtime and application policy; no defaults grant permission. */
export function createCommunicationsService(options:{api:CommunicationsServerDependencies;setup:SetupCallbackServerOptions['runtime'];webhook:ReplyWebhookServerDependencies['ingress'];aroundRequest?:CommunicationsAroundRequest}){
 const parts={api:createCommunicationsServer(options.api),setup:createSetupCallbackServer({runtime:options.setup}),webhook:createReplyWebhookServer({ingress:options.webhook})},server=createCommunicationsListener(parts,options.aroundRequest?{aroundRequest:options.aroundRequest}:undefined);
 return {server,async close(){server.closeAllConnections();for(const child of Object.values(parts))child.closeAllConnections();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
