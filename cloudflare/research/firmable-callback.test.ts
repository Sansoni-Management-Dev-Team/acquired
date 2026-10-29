import { afterEach, expect, it, vi } from 'vitest';
import { checkFirmableCallback, FirmableCallbackError } from './firmable-callback';
afterEach(()=>vi.restoreAllMocks());
it('preserves a provider cooldown as deferred work instead of a failed callback',async()=>{
 const response=Response.json({provider:'firmable',category:'rate_limited',retryAfterMs:75000},{status:429});
 await expect(checkFirmableCallback(response,'profiles',Date.now())).rejects.toMatchObject({retryAfterMs:75000,status:429});
});
it('RC-12-regression: application 502 diagnostics include action and request ID without provider attribution',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const response=new Response(JSON.stringify({code:'DATABASE_UNAVAILABLE',error:'private profile details'}),{status:502,headers:{'x-vercel-id':'iad1:request-2'}});
 const error=await checkFirmableCallback(response,'people-page',Date.now()-10).catch(error=>error);
 expect(error).toBeInstanceOf(FirmableCallbackError);
 expect(error.diagnostic).toMatchObject({origin:'application-callback',status:502,action:'people-page',requestId:'iad1:request-2',errorCode:'DATABASE_UNAVAILABLE'});
 expect(JSON.stringify(log.mock.calls)).not.toContain('private profile');
});
it('RC-12-generalization: HTML gateway errors and malicious headers cannot leak body or header content',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 const error=await checkFirmableCallback(new Response('<html>secret email@example.test</html>',{status:503,headers:{'x-request-id':'secret email@example.test'}}),'profiles',Date.now()).catch(error=>error);
 expect(error.diagnostic).toMatchObject({origin:'application-callback',status:503,requestId:undefined,errorCode:undefined});
 expect(error.message).not.toContain('email@example');
 await expect(checkFirmableCallback(new Response('{}'),'profiles',Date.now())).resolves.toBeUndefined();
});
