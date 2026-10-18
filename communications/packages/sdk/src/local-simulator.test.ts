import {afterEach,expect,it,vi} from 'vitest';
import {CommunicationsClient} from './index';
const scope={applicationId:'acquire',tenantId:'org',ownerId:'owner'},local='https://127.0.0.1:5490';
const response=(body:unknown)=>Response.json(body,{headers:{'x-communications-contract-version':'1'}});
const result=(origin=local)=>({status:'redirect',action:{type:'redirect',url:origin+'/hosted/fixture',expiresAt:new Date(Date.now()+60000).toISOString()}});
afterEach(()=>vi.unstubAllEnvs());
it('accepts only the explicit local hosted origin and preserves no-retry semantics',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response(result())).mockResolvedValueOnce(response(result('https://127.0.0.1:9999')));
 const client=new CommunicationsClient({baseUrl:'https://127.0.0.1:5491',contractVersion:'1',apiKey:'synthetic-private',localSimulatorOrigin:local,fetch:fetcher});
 expect(await client.setupConnection(scope,{channel:'email',platform:'gmail'})).toMatchObject({status:'redirect',action:{url:local+'/hosted/fixture'}});
 expect(await client.setupConnection(scope,{channel:'email',platform:'gmail'})).toEqual({status:'unknown'});expect(fetcher).toHaveBeenCalledTimes(2);
});
it('remote/default clients never trust a hosted loopback origin implicitly',async()=>{
 const fetcher=vi.fn().mockResolvedValue(response(result()));
 const client=new CommunicationsClient({baseUrl:'https://service.example',contractVersion:'1',apiKey:'synthetic-private',fetch:fetcher});
 expect(await client.setupConnection(scope,{channel:'email',platform:'gmail'})).toEqual({status:'unknown'});expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects explicit local mode for production, remote services or plaintext',()=>{
 const config={baseUrl:'https://127.0.0.1:5491',contractVersion:'1' as const,apiKey:'synthetic-private',localSimulatorOrigin:local};
 for(const baseUrl of ['https://service.example','http://127.0.0.1:5491'])expect(()=>new CommunicationsClient({...config,baseUrl,allowLoopbackHttp:true})).toThrow();
 vi.stubEnv('NODE_ENV','production');expect(()=>new CommunicationsClient(config)).toThrow();
});
