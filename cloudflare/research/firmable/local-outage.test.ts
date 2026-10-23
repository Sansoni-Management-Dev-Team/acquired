import {afterEach,describe,expect,it,vi} from 'vitest';
import {FirmableAccount} from './account';
import {validateFirmableSession} from '../firmable-session-validation';
const base={FIRMABLE_CLIENT_COOKIE:'private-cookie-never-transmit',FIRMABLE_SESSION_ID:'sess_saved',FIRMABLE_ORGANIZATION_ID:'org_saved',FIRMABLE_CREDENTIAL_KEY:'private-key-never-transmit-0123456789'};
afterEach(()=>vi.restoreAllMocks());
describe('explicit local Firmable outage',()=>{
 it.each(['/company/search','/company','/people/search','/people','/people/phones','/reconnect'])('blocks %s before stored credentials, renewal, accounting or transport',async path=>{
  const physical=vi.fn<typeof fetch>().mockRejectedValue(Error('Unexpected network')),storage={get:vi.fn(),put:vi.fn()},env={...base,LOCAL_DEVELOPMENT:'true',LOCAL_FIRMABLE_MODE:'disabled'};
  const result=await new FirmableAccount(storage,env,physical).handle({path,method:'POST',query:{id:'f123'},body:{cookie:base.FIRMABLE_CLIENT_COOKIE,sessionId:base.FIRMABLE_SESSION_ID,organizationId:base.FIRMABLE_ORGANIZATION_ID},nativeResearch:{jobId:'00000000-0000-4000-8000-000000000001',key:'synthetic-offline'}});
  expect(result).toMatchObject({status:503,body:{category:'provider_offline',providerOffline:true}});expect(physical).not.toHaveBeenCalled();expect(storage.get).not.toHaveBeenCalled();expect(storage.put).not.toHaveBeenCalled();
 });
 it('reports the pause without claiming renewed credentials or changing the saved account',async()=>{
  const physical=vi.fn<typeof fetch>(),storage={get:vi.fn(),put:vi.fn()},env={...base,LOCAL_DEVELOPMENT:'true',LOCAL_FIRMABLE_MODE:'disabled'};
  const result=await new FirmableAccount(storage,env,physical).handle({path:'/status',method:'GET',query:{}});
  expect(result).toEqual({status:200,body:{configured:false,providerOffline:true,category:'provider_offline'}});expect(JSON.stringify(result)).not.toContain(base.FIRMABLE_CLIENT_COOKIE);expect(storage.get).not.toHaveBeenCalled();expect(physical).not.toHaveBeenCalled();
 });
 it('also blocks the independent renewal/company/People diagnostic',async()=>{
  const physical=vi.fn<typeof fetch>().mockRejectedValue(Error('Unexpected network'));const response=await validateFirmableSession({...base,LOCAL_DEVELOPMENT:'true',LOCAL_FIRMABLE_MODE:'disabled'},physical);
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({providerOffline:true,category:'provider_offline'});expect(physical).not.toHaveBeenCalled();
 });
 it.each([{LOCAL_DEVELOPMENT:'false',LOCAL_FIRMABLE_MODE:'disabled'},{LOCAL_DEVELOPMENT:'true',LOCAL_FIRMABLE_MODE:'typo'}])('refuses a misplaced or unknown mode without falling back to live transport',async flags=>{
  const physical=vi.fn<typeof fetch>().mockRejectedValue(Error('Unexpected network')),storage={get:vi.fn(),put:vi.fn()},env={...base,...flags};
  const result=await new FirmableAccount(storage,env,physical).handle({path:'/status',method:'GET',query:{}});expect(result).toMatchObject({status:503,body:{category:'invalid_local_provider_configuration'}});const response=await validateFirmableSession(env,physical);expect(response.status).toBe(503);expect(physical).not.toHaveBeenCalled();expect(storage.get).not.toHaveBeenCalled();
 });
});
