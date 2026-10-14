import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { assertSameBinding,type AccessScope,type Backend,type Channel,type ConnectionBinding,type Platform,type SetupAction } from '../../contracts/src';

export interface IssuedSetupState { nonce:string; expiresAt:string; expectedConnectionId:string; expectedGeneration:number }
export type CommittedSetupNotification = {status:'completed';binding:ConnectionBinding} |
  {status:'consumed';binding?:ConnectionBinding;needsReconciliation?:true} |
  {status:'rejected';code:'unauthenticated'|'invalid'|'expired'|'forbidden'|'reconnect_changed'};
export interface DurableSetupStatePort {
  /** Resolve only AFTER durable state commit, never from an in-memory fallback. Construct this port
   * from the SAME trusted scope/channel/platform/backend/redirectOrigin as the coordinator. */
  issue(input?:{reconnectBinding?:ConnectionBinding}):Promise<IssuedSetupState>;
  /** Required authenticated notification/state correlation and provider-owner verification stay inside
   * this durable boundary. Resolve completed/consumed only after binding/state commit or exact replay. */
  complete(input:{nonce:string;notification:unknown}):Promise<CommittedSetupNotification>;
}
export interface HostedSetupInput {
  type:'create'|'reconnect'; channel:Channel; platform:Platform; state:string; expiresAt:string;
  successRedirectUrl:string; failureRedirectUrl:string; notifyUrl:string; providerAccountId?:string;
}
/** Structural transport port compatible with a validated provider hosted-auth implementation.
 * Its concrete adapter owns response/status/host allowlists and operation-specific HTTP semantics. */
export interface HostedSetupPort {
  createLink(input:HostedSetupInput,options?:{signal?:AbortSignal}):Promise<
    {kind:'success';status:number;data:unknown} |
    {kind:'rejected';status:number;reason:string;retryAfterSeconds?:number} |
    {kind:'unknown'|'unavailable';reason:string;status?:number} | {kind:'not_submitted';reason:string}>;
}
export interface ConnectionSetupOptions {
  scope:AccessScope; channel:Channel; platform:Platform; backend:Backend;
  redirectOrigin:string; successPath:string; failurePath:string; notifyUrl:string;
  allowLoopbackHttp?:boolean; timeoutMs?:number;
  states:DurableSetupStatePort; hostedAuth:HostedSetupPort;
  /** Trusted service lookup/decryption of the exact current recorded binding. Never resolve from a
   * caller-supplied provider account ID or silently select a newer generation/different backend. */
  resolveReconnect(binding:ConnectionBinding,signal:AbortSignal):Promise<{binding:ConnectionBinding;providerAccountId:string}>;
}
export type BeginSetupResult = {status:'redirect';action:Extract<SetupAction,{type:'redirect'}>} |
  {status:'rejected';code:'invalid'|'provider_rejected'} | {status:'unavailable'|'unknown'};
export type CompleteSetupResult = {status:'recorded'|'duplicate';binding:ConnectionBinding} |
  {status:'review';code:'reconciliation_required'} |
  {status:'rejected';code:'unauthenticated'|'invalid'|'expired'|'forbidden'|'reconnect_changed'} | {status:'unknown'};
const scopeFields=['applicationId','tenantId','ownerId'] as const;
const bindingFields=[...scopeFields,'connectionId','accountId','generation','channel','platform','backend'] as const;
function fail():never { throw Error('Connection setup unavailable'); }
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=200&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
function record(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
  const descriptors=Object.getOwnPropertyDescriptors(value),result:Record<string,unknown>={};
  if(required.some(key=>!Object.hasOwn(descriptors,key))||Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||![...required,...optional].includes(key)||!('value' in descriptors[key])||!descriptors[key].enumerable))fail();
  for(const key of Object.keys(descriptors))result[key]=descriptors[key].value;
  return result;
}
function parsedBinding(value:unknown):ConnectionBinding {
  const raw=record(value,bindingFields);
  if(bindingFields.some(key=>key!=='generation'&&!id(raw[key])))fail();
  const binding=raw as unknown as ConnectionBinding;assertSameBinding(binding,binding);
  if(binding.generation>2_147_483_647)fail();
  return structuredClone(binding);
}
/** P3.2 lifecycle composition only. A hosted link or browser redirect establishes no connection,
 * readiness, capability or application selection. No automatic retries, state fallback, account
 * binding or provider verification. Timed-out durable work may still commit; replay its SAME nonce
 * through the authenticated durable port. Provider URL/account credentials must never be logged. */
export function createConnectionSetupCoordinator(options:ConnectionSetupOptions):{
  begin(input?:{reconnectBinding?:ConnectionBinding}):Promise<BeginSetupResult>;
  complete(input:{nonce:string;notification:unknown}):Promise<CompleteSetupResult>;
} {
  let scope:AccessScope,successRedirectUrl:string,failureRedirectUrl:string,notifyUrl:string;
  const channel=options.channel,platform=options.platform,backend=options.backend,timeout=options.timeoutMs??25000;
  const loopback=options.allowLoopbackHttp===true;
  function url(value:unknown):URL {
    if(typeof value!=='string'||value.length<1||value.length>8192||value!==value.trim()||/[\u0000-\u0020\u007f]/.test(value))fail();
    const parsed=new URL(value);
    if(parsed.username||parsed.password||parsed.hash||!(parsed.protocol==='https:'||loopback&&parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)))fail();
    return parsed;
  }
  try {
    const raw=record(options.scope,scopeFields);if(scopeFields.some(key=>!id(raw[key])))fail();scope=raw as unknown as AccessScope;
    const origin=url(options.redirectOrigin);if(origin.origin!==options.redirectOrigin)fail();
    const path=(value:unknown)=>{if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.length>2000||/[\u0000-\u0020\u007f]/.test(value))fail();const resolved=url(new URL(value,origin).href);if(resolved.origin!==origin.origin)fail();return resolved.href;};
    successRedirectUrl=path(options.successPath);failureRedirectUrl=path(options.failurePath);notifyUrl=url(options.notifyUrl).href;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>=30000||!['direct','baileys','browser','unipile'].includes(backend)||
      !(channel==='email'&&['gmail','outlook','imap'].includes(platform)&&['direct','unipile'].includes(backend)||channel==='whatsapp'&&platform==='whatsapp'&&['baileys','unipile'].includes(backend)||channel==='linkedin'&&platform==='linkedin'&&['browser','unipile'].includes(backend))||
      typeof options.states?.issue!=='function'||typeof options.states?.complete!=='function'||typeof options.hostedAuth?.createLink!=='function'||typeof options.resolveReconnect!=='function')fail();
  } catch { throw Error('Invalid connection setup configuration'); }
  const fixedScope=Object.freeze({...scope}),issue=Function.prototype.bind.call(options.states.issue,options.states),complete=Function.prototype.bind.call(options.states.complete,options.states),createLink=Function.prototype.bind.call(options.hostedAuth.createLink,options.hostedAuth),resolve=Function.prototype.bind.call(options.resolveReconnect,options);
  function scoped(value:unknown):ConnectionBinding {
    const binding=parsedBinding(value);
    if(scopeFields.some(key=>binding[key]!==fixedScope[key])||binding.channel!==channel||binding.platform!==platform||binding.backend!==backend)fail();return binding;
  }
  async function bounded<T>(work:(step:<R>(invoke:(signal:AbortSignal)=>Promise<R>)=>Promise<R>)=>Promise<T>):Promise<T> {
    const controller=new AbortController(),deadline=performance.now()+timeout;
    const check=()=>{if(controller.signal.aborted||performance.now()>=deadline){controller.abort();fail();}};
    let timer:ReturnType<typeof setTimeout>|undefined;
    const stopped=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Connection setup unavailable'));},timeout);});
    async function step<R>(invoke:(signal:AbortSignal)=>Promise<R>):Promise<R>{check();const result=await invoke(controller.signal);check();return result;}
    const pending=Promise.resolve().then(async()=>{check();const result=await work(step);check();return result;});
    try{return await Promise.race([pending,stopped]);}finally{clearTimeout(timer);controller.abort();}
  }
  function issued(value:unknown,reconnect?:ConnectionBinding):IssuedSetupState {
    const raw=record(value,['nonce','expiresAt','expectedConnectionId','expectedGeneration']);
    if(typeof raw.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw.nonce)||typeof raw.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.expiresAt)||
      !Number.isFinite(Date.parse(raw.expiresAt))||new Date(raw.expiresAt).toISOString()!==raw.expiresAt||Date.parse(raw.expiresAt)<=Date.now()||!id(raw.expectedConnectionId)||
      !Number.isSafeInteger(raw.expectedGeneration)||raw.expectedGeneration!==(reconnect?reconnect.generation+1:1)||reconnect&&raw.expectedConnectionId!==reconnect.connectionId)fail();
    return raw as unknown as IssuedSetupState;
  }
  return {
    async begin(input={}):Promise<BeginSetupResult> {
      let reconnect:ConnectionBinding|undefined;
      try{const raw=record(input,[],['reconnectBinding']);if(raw.reconnectBinding!==undefined){reconnect=scoped(raw.reconnectBinding);if(reconnect.generation>=2_147_483_647)fail();}}
      catch{return {status:'rejected',code:'invalid'};}
      let providerRequested=false;
      try{return await bounded(async step=>{
        let providerAccountId:string|undefined;
        if(reconnect){const proof=record(await step(signal=>resolve(structuredClone(reconnect!),signal)),['binding','providerAccountId']);assertSameBinding(reconnect,scoped(proof.binding));if(typeof proof.providerAccountId!=='string'||proof.providerAccountId.length===0)fail();providerAccountId=proof.providerAccountId;}
        const state=issued(await step(()=>issue(reconnect?{reconnectBinding:structuredClone(reconnect)}:{})),reconnect);
        const request:HostedSetupInput={type:reconnect?'reconnect':'create',channel,platform,state:state.nonce,expiresAt:state.expiresAt,successRedirectUrl,failureRedirectUrl,notifyUrl,...(providerAccountId===undefined?{}:{providerAccountId})};
        const response=record(await step(signal=>{providerRequested=true;return createLink(Object.freeze(request),{signal});}),['kind'],['status','data','reason','retryAfterSeconds']);
        if(response.kind==='rejected')return {status:'rejected',code:'provider_rejected'};
        if(response.kind!=='success')return {status:'unknown'};
        const data=record(response.data,['url'],['object']);
        if(Date.parse(state.expiresAt)<=Date.now())fail();
        return {status:'redirect',action:{type:'redirect',url:url(data.url).href,expiresAt:state.expiresAt}};
      });}catch{return {status:providerRequested?'unknown':'unavailable'};}
    },
    async complete(input):Promise<CompleteSetupResult> {
      let notification:{nonce:string;notification:unknown};
      try{const raw=record(input,['nonce','notification']);if(typeof raw.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw.nonce))fail();notification={nonce:raw.nonce,notification:structuredClone(raw.notification)};}
      catch{return {status:'rejected',code:'invalid'};}
      try{return await bounded(async step=>{
        const result=record(await step(()=>complete(notification)),['status'],['binding','needsReconciliation','code']);
        if(typeof result.status!=='string')fail();
        if(result.status==='rejected'){
          if(typeof result.code!=='string'||!['unauthenticated','invalid','expired','forbidden','reconnect_changed'].includes(result.code)||result.binding!==undefined||result.needsReconciliation!==undefined)fail();
          return {status:'rejected',code:result.code as Extract<CompleteSetupResult,{status:'rejected'}>['code']};
        }
        if(result.status==='consumed'&&result.binding===undefined&&result.needsReconciliation===true&&result.code===undefined)return {status:'review',code:'reconciliation_required'};
        if(!['completed','consumed'].includes(result.status)||result.needsReconciliation!==undefined||result.code!==undefined)fail();
        return {status:result.status==='completed'?'recorded':'duplicate',binding:scoped(result.binding)};
      });}catch{return {status:'unknown'};}
    },
  };
}
