import {expect,it,vi} from 'vitest';
import {assertManagementSetupResponse} from './management';
import {CommunicationsClient} from '../../sdk/src';
const origin='https://acquire-simulator.mlai.au',hostedDemo={capability:'hosted-demo',origin} as const;
const response=()=>({status:'redirect',action:{type:'redirect',url:origin+'/sim/v1/auth/original',expiresAt:new Date(Date.now()+60000).toISOString()}});
it('permits only an explicit trusted hosted-demo origin without enabling the local simulator path',async()=>{
 expect(()=>assertManagementSetupResponse(response(),{hostedDemo} as never)).not.toThrow();
 const client=new CommunicationsClient({baseUrl:origin,contractVersion:'1',apiKey:'fixture',hostedDemo,fetch:vi.fn(async()=>new Response(JSON.stringify(response()),{headers:{'content-type':'application/json','x-communications-contract-version':'1'}}))} as never);
 expect(await client.setupConnection({applicationId:'acquire',tenantId:'org',ownerId:'owner'},{channel:'email',platform:'gmail'})).toMatchObject({status:'redirect'});
});
it('does not infer hosted capability from response URL and refuses wrong capability/origin/mixed-local configuration',()=>{
 expect(()=>assertManagementSetupResponse(response())).toThrow();
 for(const value of[{capability:'unipile',origin},{capability:'hosted-demo',origin:'http://acquire-simulator.mlai.au'},{capability:'hosted-demo',origin:'https://127.0.0.1:5990'},{capability:'hosted-demo',origin:origin+'/path'},{...hostedDemo,privateSecret:'extra'}])expect(()=>new CommunicationsClient({baseUrl:origin,contractVersion:'1',apiKey:'fixture',hostedDemo:value} as never)).toThrow();
 expect(()=>assertManagementSetupResponse({...response(),action:{...response().action,url:'https://attacker.example/auth'}},{hostedDemo} as never)).toThrow();
 expect(()=>new CommunicationsClient({baseUrl:origin,contractVersion:'1',apiKey:'fixture',hostedDemo,localSimulatorOrigin:'https://127.0.0.1:5990'} as never)).toThrow();
});
