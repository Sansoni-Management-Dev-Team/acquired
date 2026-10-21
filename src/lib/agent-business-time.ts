import {businessNow,type BusinessClock} from '../../communications/packages/core/src/business-clock';
export type AgentBusinessTimeScope=Readonly<{runId:string;organizationId:string;userId:string}>;
declare const issuedContext:unique symbol;
export type AgentBusinessTimeContext=BusinessClock&Readonly<{scope:AgentBusinessTimeScope;[issuedContext]:true}>;
export type AgentBusinessTimeSelection=Readonly<{context:AgentBusinessTimeContext;scope:AgentBusinessTimeScope}>;
const issued=new WeakMap<object,AgentBusinessTimeScope>();
const unavailable=():never=>{throw Error('Agent business time scope unavailable');};
function captureScope(value:AgentBusinessTimeScope):AgentBusinessTimeScope{
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)return unavailable();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).sort().join(',')!=='organizationId,runId,userId')return unavailable();
 const read=(name:keyof AgentBusinessTimeScope):string=>{const d=descriptors[name];if(!d||!('value'in d)||typeof d.value!=='string'||!d.value||d.value.length>200||d.value.trim()!==d.value||/[\u0000-\u001f\u007f]/.test(d.value))return unavailable();return d.value;};
 const captured={runId:read('runId'),organizationId:read('organizationId'),userId:read('userId')};
 if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(captured.runId))return unavailable();
 return Object.freeze(captured);
}
/** Trusted composition snapshots one business operation. The caller must own its
 * actual work pin; this object does not freeze another process or authorize work.
 * No environment, API or model field implicitly creates this context. */
export function createAgentBusinessTimeContext(scope:AgentBusinessTimeScope,clock:BusinessClock):AgentBusinessTimeContext{
 const captured=captureScope(scope),instant=businessNow(clock),context=Object.freeze({scope:captured,now:()=>instant}) as AgentBusinessTimeContext;
 issued.set(context,captured);return context;
}
export function assertAgentBusinessTimeScope(value:unknown,expected:AgentBusinessTimeScope):asserts value is AgentBusinessTimeContext{
 const captured=captureScope(expected),original=typeof value==='object'&&value!==null?issued.get(value):undefined;
 if(!original||original.runId!==captured.runId||original.organizationId!==captured.organizationId||original.userId!==captured.userId)unavailable();
}
