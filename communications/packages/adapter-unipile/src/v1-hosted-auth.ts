import type { Channel, Platform } from '../../contracts/src';
import type { UnipileV1TransportConfig } from './v1-http';
import { BoundedUnipileHttp, type UnipileHttpResult, type UnipileRequestOptions } from './http-core';
import { types } from 'node:util';

export interface UnipileV1HostedAuthConfig extends UnipileV1TransportConfig {
  redirectOrigins: readonly string[];
  notifyOrigins: readonly string[];
  hostedAuthOrigins?: readonly string[];
  maxLinkAgeMs?: number;
  now?: () => number;
}
export interface HostedAuthInput {
  type: 'create' | 'reconnect';
  channel: Channel;
  platform: Platform;
  /** Opaque service-generated setup nonce, not an application user ID. */
  state: string;
  expiresAt: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
  notifyUrl: string;
  /** Exact recorded account for reconnect; service authorization remains required. */
  providerAccountId?: string;
}
/** Provider link creation only; never binds an account or establishes send readiness. */
export class UnipileV1HostedAuth {
  #http:BoundedUnipileHttp;
  #redirects:Set<string>;
  #notifications:Set<string>;
  #hosted:Set<string>;
  #maxAge:number;
  #now:()=>number;
  #loopback:boolean;
  constructor(config: UnipileV1HostedAuthConfig) {
    try{
      if(config.apiVersion!=='v1')throw Error();
      this.#loopback=config.allowLoopbackHttp===true;
      this.#redirects=this.#origins(config.redirectOrigins);
      this.#notifications=this.#origins(config.notifyOrigins);
      this.#hosted=this.#origins(config.hostedAuthOrigins??['https://account.unipile.com']);
      this.#maxAge=config.maxLinkAgeMs??900000;
      if(!Number.isSafeInteger(this.#maxAge)||this.#maxAge<1||this.#maxAge>3600000||config.now!==undefined&&typeof config.now!=='function')throw Error();
      this.#now=config.now?.bind(config)??Date.now;
      this.#http=new BoundedUnipileHttp({...config,basePath:'/api/v1',strictWriteRejections:true});
    }catch{throw Error('Invalid hosted authentication configuration');}
  }
  #url(value:unknown):URL {
    if(typeof value!=='string'||value.length<1||value.length>8192||value!==value.trim()||/[\u0000-\u0020\u007f]/.test(value))throw Error();
    const url=new URL(value),loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.hash||!(url.protocol==='https:'||this.#loopback&&loopback&&url.protocol==='http:'))throw Error();
    return url;
  }
  #origins(values:readonly string[]):Set<string>{
    if(!Array.isArray(values)||values.length<1||values.length>16)throw Error();
    const origins=new Set<string>();for(const value of values){const url=this.#url(value);if(url.origin!==value)throw Error();origins.add(value);}return origins;
  }
  async createLink(input: HostedAuthInput, options: UnipileRequestOptions = {}): Promise<UnipileHttpResult> {
    let body:string,expiresAtMs:number;
    try{
      if(!input||typeof input!=='object'||Array.isArray(input)||types.isProxy(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error();
      const allowed=['type','channel','platform','state','expiresAt','successRedirectUrl','failureRedirectUrl','notifyUrl','providerAccountId'];
      const descriptors=Object.getOwnPropertyDescriptors(input);
      if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!allowed.includes(key)||!('value' in descriptors[key])||!descriptors[key].enumerable))throw Error();
      const copied=Object.fromEntries(Object.entries(descriptors).map(([key,value])=>[key,value.value])) as unknown as HostedAuthInput;
      // Request primitives are validated before interpolation/parsing: no nested coercion hooks.
      if(typeof copied.channel!=='string'||typeof copied.platform!=='string'||typeof copied.expiresAt!=='string')throw Error();
      const providers:Record<string,string>={'email:gmail':'GOOGLE','email:outlook':'MICROSOFT','email:imap':'IMAP','linkedin:linkedin':'LINKEDIN','whatsapp:whatsapp':'WHATSAPP'};
      const provider=providers[`${copied.channel}:${copied.platform}`];
      if(!provider||!['create','reconnect'].includes(copied.type)||typeof copied.state!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(copied.state))throw Error();
      if(copied.type==='create'&&copied.providerAccountId!==undefined||copied.type==='reconnect'&&(typeof copied.providerAccountId!=='string'||!copied.providerAccountId.length||copied.providerAccountId.length>2048||copied.providerAccountId!==copied.providerAccountId.trim()||/[\u0000-\u0020\u007f]/.test(copied.providerAccountId)))throw Error();
      const expires=Date.parse(copied.expiresAt),now=this.#now();expiresAtMs=expires;
      if(typeof copied.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(copied.expiresAt)||!Number.isFinite(expires)||new Date(expires).toISOString()!==copied.expiresAt||!Number.isFinite(now)||expires<=now||expires-now>this.#maxAge)throw Error();
      const success=this.#url(copied.successRedirectUrl),failure=this.#url(copied.failureRedirectUrl),notify=this.#url(copied.notifyUrl);
      if(!this.#redirects.has(success.origin)||!this.#redirects.has(failure.origin)||!this.#notifications.has(notify.origin))throw Error();
      body=JSON.stringify({type:copied.type,...(copied.type==='create'?{providers:[provider]}:{reconnect_account:copied.providerAccountId}),api_url:this.#http.url('').origin,expiresOn:copied.expiresAt,name:copied.state,success_redirect_url:success.href,failure_redirect_url:failure.href,notify_url:notify.href});
    }catch{throw Error('Invalid hosted authentication request');}
    const result=await this.#http.request('POST',this.#http.url('hosted/accounts/link'),body,{signal:options.signal},{'Content-Type':'application/json'});
    if(result.kind!=='success')return result;
    try{
      if(result.status!==200||!result.data||typeof result.data!=='object'||Array.isArray(result.data)||!('object' in result.data)||result.data.object!=='HostedAuthURL'||!('url' in result.data))throw Error();
      // Provider round-trip can consume the complete requested link lifetime.
      const observedAt=this.#now();if(!Number.isFinite(observedAt)||observedAt>=expiresAtMs)throw Error();
      const url=this.#url(result.data.url);if(!this.#hosted.has(url.origin))throw Error();
      return {kind:'success',status:200,data:{object:'HostedAuthURL',url:url.href}};
    }catch{return {kind:'unknown',reason:'invalid_response',status:result.status};}
  }
}
