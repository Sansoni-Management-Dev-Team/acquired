import {describe,it,expect} from 'vitest';
import {configuredLocalSetupOrigin,hostedSetupRedirect} from './communications-setup-redirect';
const origin='https://127.0.0.1:5490';
const response=(url:string)=>({status:'redirect',action:{type:'redirect',url,expiresAt:new Date(Date.now()+60000).toISOString()}});
describe('agent local simulator setup',()=>{
 it('preserves normal public hosted setup',()=>expect(hostedSetupRedirect(response('https://account.unipile.com/fixture'))).toBe('https://account.unipile.com/fixture'));
 it('accepts configured mock redirects from the exact isolated app origins',()=>{
  for(const pageOrigin of ['http://acquire-agent.orb.local','http://localhost:3026','https://127.0.0.1:5491'])expect(hostedSetupRedirect(response(origin+'/auth/fixture'),{localSimulatorOrigin:origin,pageOrigin})).toBe(origin+'/auth/fixture');
 });
 it('rejects remote pages, other provider origins, expired and unconfigured local links',()=>{
  for(const pageOrigin of ['https://app.example','http://acquire-agent.orb.local.attacker.test','http://localhost:3000'])expect(()=>hostedSetupRedirect(response(origin+'/auth/fixture'),{localSimulatorOrigin:origin,pageOrigin})).toThrow();
  expect(()=>hostedSetupRedirect(response('https://127.0.0.1:5499/auth/fixture'),{localSimulatorOrigin:origin,pageOrigin:'http://acquire-agent.orb.local'})).toThrow();
  expect(()=>hostedSetupRedirect(response(origin+'/auth/fixture'))).toThrow();
  expect(()=>hostedSetupRedirect({...response(origin+'/auth/fixture'),action:{type:'redirect',url:origin+'/auth/fixture',expiresAt:'2020-01-01T00:00:00.000Z'}},{localSimulatorOrigin:origin,pageOrigin:'http://acquire-agent.orb.local'})).toThrow();
 });
 it('exports local origin only for the explicit non-production simulator profile',()=>{
  expect(configuredLocalSetupOrigin({NODE_ENV:'development'})).toBeUndefined();
  expect(configuredLocalSetupOrigin({NODE_ENV:'development',AGENT_MODE_COMMUNICATIONS_MODE:'simulator',COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:origin})).toBe(origin);
  for(const env of [{NODE_ENV:'production',AGENT_MODE_COMMUNICATIONS_MODE:'simulator'},{NODE_ENV:'development',AGENT_MODE_COMMUNICATIONS_MODE:'connect-only'}])expect(()=>configuredLocalSetupOrigin({...env,COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:origin})).toThrow();
 });
});
