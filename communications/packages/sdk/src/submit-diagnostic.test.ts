import {expect,it,vi} from 'vitest';
import {CommunicationsClient} from './index';
const binding={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'email',platform:'gmail',backend:'unipile'} as const;
const input={snapshot:{binding,key:'PRIVATE-operation-key',operation:'message' as const,payloadDigest:'a'.repeat(64)},message:{recipient:{kind:'email' as const,value:'PRIVATE@example.invalid'},subject:'PRIVATE',text:'PRIVATE'}};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'x-communications-contract-version':'1'}});
it.each([
 ['valid_service_unknown',()=>response({status:'unknown'})],
 ['invalid_receipt',()=>response(null)],
 ['invalid_receipt',()=>response({status:'submitted',secret:'PRIVATE'})],
 ['service_error',()=>response({error:{code:'internal'}},500)],
 ['protocol_error',()=>new Response('PRIVATE',{status:200})],
 ['transport_error',()=>{throw Error('PRIVATE transport detail');}],
] as const)('distinguishes %s while retaining conservative unknown and making one request',async(category,reply)=>{
 const diagnostic=vi.fn(),fetch=vi.fn(async()=>reply()),client=new CommunicationsClient({baseUrl:'https://service.invalid',contractVersion:'1',apiKey:'PRIVATE',fetch,submitDiagnostic:diagnostic});
 expect(await client.submit(input)).toEqual({status:'unknown'});expect(fetch).toHaveBeenCalledOnce();expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({stage:'sdk.submit',category,submission:'outcome_unknown',recovery:'lookup_original_operation',automaticResend:false}));expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('PRIVATE');
});
it('preserves known predispatch exceptions and reports only their allowlisted code/status',async()=>{
 const diagnostic=vi.fn(),client=new CommunicationsClient({baseUrl:'https://service.invalid',contractVersion:'1',apiKey:'PRIVATE',fetch:async()=>response({error:{code:'unauthorized'}},401),submitDiagnostic:diagnostic});
 await expect(client.submit(input)).rejects.toMatchObject({code:'unauthorized',status:401});expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({category:'predispatch_rejection',code:'unauthorized',httpStatus:401}));
});
it('logs by default and isolates a throwing custom sink',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),config={baseUrl:'https://service.invalid',contractVersion:'1' as const,apiKey:'PRIVATE',fetch:async()=>response({status:'unknown'})};
 try{await new CommunicationsClient(config).submit(input);expect(warn).toHaveBeenCalledOnce();expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE');expect(await new CommunicationsClient({...config,submitDiagnostic:()=>{throw Error('sink');}}).submit(input)).toEqual({status:'unknown'});}finally{warn.mockRestore();}
});
