import {expect,it,vi} from 'vitest';
import {createCommunicationsService} from './service';
it('composes native API, setup and webhook handlers from explicit ports without app/framework dependencies',async()=>{
 const complete=vi.fn(async()=>({status:'queued' as const})),capture=vi.fn(async()=>({status:'accepted' as const}));
 const service=createCommunicationsService({api:{authorize:async()=>null,connections:{get:async()=>null},resolveAdapter:async()=>{throw Error('Unauthenticated request cannot resolve sender');}},setup:{completeSetupNotification:complete},webhook:{authenticate:()=>true,capture}});
 await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));const address=service.server.address();if(!address||typeof address==='string')throw Error();const base=`http://127.0.0.1:${address.port}`;
 try{expect(await (await fetch(base+'/health')).json()).toEqual({contractVersion:'1'});expect((await fetch(base+'/v1/submit',{method:'POST',headers:{'X-Communications-Contract-Version':'1','Content-Type':'application/json'},body:'{}'})).status).toBe(401);expect((await fetch(base+'/v1/setup/notify?capability=synthetic',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(200);expect((await fetch(base+'/v1/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(200);expect(complete).toHaveBeenCalledOnce();expect(capture).toHaveBeenCalledOnce();}finally{await service.close();}
});
