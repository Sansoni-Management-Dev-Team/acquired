import {expect,it,vi} from 'vitest';vi.mock('server-only',()=>({}));
vi.mock('../../communications/services/api/src/service',()=>({createCommunicationsService:()=>({server:{},close:async()=>{}})}));
import {createAcquireCommunicationsService} from './communications-service';
it('refuses service startup when required storage is missing and never initializes or migrates it',async()=>{const preflight=vi.fn(async()=>false),webhooks=vi.fn();await expect(createAcquireCommunicationsService({unipile:{store:{preflight}},host:{createWebhooks:webhooks}} as never)).rejects.toThrow('Communications storage is not ready');expect(preflight).toHaveBeenCalledOnce();expect(webhooks).not.toHaveBeenCalled();});

it('external history maintenance owns scans while service still consumes all channel deliveries',async()=>{
 const scope={applicationId:'acquire',tenantId:'synthetic',ownerId:'synthetic'},refresh=vi.fn(),consumePending=vi.fn();
 const configured={options:{},unipile:{store:{preflight:async()=>true,list:async()=>['email','whatsapp','linkedin'].map(channel=>({active:true,status:'connected',binding:{...scope,connectionId:channel,accountId:channel,generation:1,channel,platform:channel==='email'?'gmail':channel,backend:'unipile'}}))}},host:{serverDependencies:{},createWebhooks:()=>({ingress:{},runOne:async()=>({status:'idle'})}),renewScope:async()=>true,drainRetainedOutbound:async()=>{},pendingReplyBindings:async()=>[],consumePending,history:async()=>({repository:{coverage:async()=>null},refresh})}};
 const service=await createAcquireCommunicationsService(configured as never,{historyMaintenance:'external'});
 try{await service.tick([scope]);expect(refresh).not.toHaveBeenCalled();expect(consumePending).toHaveBeenCalledTimes(3);}finally{await service.close();}
});
