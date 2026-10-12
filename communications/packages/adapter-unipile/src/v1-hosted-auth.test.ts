import { describe, expect, it, vi } from 'vitest';
import { UnipileV1HostedAuth, type HostedAuthInput, type UnipileV1HostedAuthConfig } from './v1-hosted-auth';

const now=Date.parse('2026-10-12T10:00:00.000Z');
const input=():HostedAuthInput=>({type:'create',channel:'email',platform:'gmail',state:'synthetic_nonce_'.padEnd(48,'x'),expiresAt:'2026-10-12T10:10:00.000Z',successRedirectUrl:'https://app.example.com/settings?connected=1',failureRedirectUrl:'https://app.example.com/settings?failed=1',notifyUrl:'https://service.example.com/setup/notify?nonce=fixture'});
function fixture(){
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>Response.json({object:'HostedAuthURL',url:'https://account.unipile.com/opaque-auth-link'}));
  const config:UnipileV1HostedAuthConfig={apiVersion:'v1',baseUrl:'https://api1.unipile.com:20255/api/v1',apiKey:'synthetic-api-key',redirectOrigins:['https://app.example.com'],notifyOrigins:['https://service.example.com'],fetch,now:()=>now};
  return {fetch,config,api:new UnipileV1HostedAuth(config)};
}
describe('explicit v1 hosted connection links',()=>{
  it.each([
    ['email','gmail','GOOGLE'],['email','outlook','MICROSOFT'],['email','imap','IMAP'],['whatsapp','whatsapp','WHATSAPP'],['linkedin','linkedin','LINKEDIN'],
  ] as const)('creates a single %s/%s link with server-owned DSN',async(channel,platform,provider)=>{
    const f=fixture(),i={...input(),channel,platform};expect(await f.api.createLink(i)).toEqual({kind:'success',status:200,data:{object:'HostedAuthURL',url:'https://account.unipile.com/opaque-auth-link'}});
    const [url,request]=f.fetch.mock.calls[0];expect(String(url)).toBe('https://api1.unipile.com:20255/api/v1/hosted/accounts/link');expect(request?.method).toBe('POST');expect(request?.redirect).toBe('error');
    expect(JSON.parse(String(request?.body))).toEqual({type:'create',providers:[provider],api_url:'https://api1.unipile.com:20255',expiresOn:i.expiresAt,name:i.state,success_redirect_url:i.successRedirectUrl,failure_redirect_url:i.failureRedirectUrl,notify_url:i.notifyUrl});
    expect(request?.headers).toMatchObject({'X-API-KEY':'synthetic-api-key','Content-Type':'application/json'});
  });
  it('reconnects only the original recorded account with no create-provider list',async()=>{
    const f=fixture();await f.api.createLink({...input(),type:'reconnect',providerAccountId:'original-account'});
    const body=JSON.parse(String(f.fetch.mock.calls[0][1]?.body));expect(body.type).toBe('reconnect');expect(body.reconnect_account).toBe('original-account');expect(body.providers).toBeUndefined();
  });
  it.each([
    {channel:'whatsapp',platform:'gmail'}, {type:'create',providerAccountId:'account'}, {type:'reconnect'}, {state:'owner@email.example'}, {expiresAt:'2026-10-12T09:00:00.000Z'}, {expiresAt:'2026-10-12T11:00:00.000Z'}, {expiresAt:'2026-02-31T10:00:00.000Z'}, {successRedirectUrl:'https://other.example/settings'}, {failureRedirectUrl:'https://user:password@app.example.com/settings'}, {notifyUrl:'https://service.example.com/notify#secret'}, {notifyUrl:'http://service.example.com/notify'}, {unknown:'field'},
  ])('rejects unsafe setup input before provider I/O (%j)',async change=>{
    const f=fixture();await expect(f.api.createLink({...input(),...change} as HostedAuthInput)).rejects.toThrow('Invalid hosted authentication request');expect(f.fetch).not.toHaveBeenCalled();
  });
  it('does not execute getters on request data',async()=>{
    const f=fixture(),read=vi.fn(()=>input().state);const i=input();Object.defineProperty(i,'state',{get:read,enumerable:true});
    await expect(f.api.createLink(i)).rejects.toThrow('Invalid hosted authentication request');expect(read).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(['https://evil.example/auth','https://user:password@account.unipile.com/auth','http://account.unipile.com/auth','https://account.unipile.com/auth#fragment','javascript:alert(1)'])('does not expose an unsafe provider link: %s',async url=>{
    const f=fixture();f.fetch.mockResolvedValueOnce(Response.json({object:'HostedAuthURL',url}));expect(await f.api.createLink(input())).toMatchObject({kind:'unknown',reason:'invalid_response'});
  });
  it('does not expose extra provider fields or turn wrong object/status into a link',async()=>{
    const f=fixture();f.fetch.mockResolvedValueOnce(Response.json({object:'HostedAuthURL',url:'https://account.unipile.com/link',private:'vendor detail'}));
    expect(await f.api.createLink(input())).toEqual({kind:'success',status:200,data:{object:'HostedAuthURL',url:'https://account.unipile.com/link'}});
    f.fetch.mockResolvedValueOnce(Response.json({object:'Account',url:'https://account.unipile.com/link'}));expect(await f.api.createLink(input())).toMatchObject({kind:'unknown',reason:'invalid_response'});
    f.fetch.mockResolvedValueOnce(Response.json({object:'HostedAuthURL',url:'https://account.unipile.com/link'},{status:202}));expect(await f.api.createLink(input())).toMatchObject({kind:'unknown',reason:'invalid_response'});
  });
  it('keeps transport failures bounded, sanitized and without retries',async()=>{
    const f=fixture();f.fetch.mockRejectedValueOnce(Error('private provider trace'));expect(await f.api.createLink(input())).toEqual({kind:'unknown',reason:'transport'});expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('honors cancellation before link creation',async()=>{
    const f=fixture();const c=new AbortController();c.abort();expect(await f.api.createLink(input(),{signal:c.signal})).toEqual({kind:'not_submitted',reason:'canceled'});expect(f.fetch).not.toHaveBeenCalled();
  });
  it('snapshots configuration and request before awaiting network',async()=>{
    const f=fixture(),i=input();f.config.redirectOrigins=['https://other.example'];f.config.notifyOrigins=['https://other.example'];f.config.now=()=>0;f.config.apiKey='changed';
    const pending=f.api.createLink(i);i.state='changed';expect((await pending).kind).toBe('success');expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).name).toBe(input().state);
  });
  it.each([{apiVersion:'v2'},{redirectOrigins:['https://app.example.com/path']},{notifyOrigins:[]},{maxLinkAgeMs:0},{hostedAuthOrigins:['https://account.unipile.com/path']}])('rejects invalid trusted configuration (%j)',change=>{
    const f=fixture();expect(()=>new UnipileV1HostedAuth({...f.config,...change} as UnipileV1HostedAuthConfig)).toThrow('Invalid hosted authentication configuration');
  });
});
