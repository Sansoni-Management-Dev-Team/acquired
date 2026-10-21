import {z} from 'zod';
/** Trusted server configuration only. Empty/malformed values never widen work. */
export function nativeWorkerMandateScope(input:{mandateId?:unknown;required?:boolean}):string|undefined{
 if(input.mandateId===undefined){if(input.required)throw Error('An exact native worker mandate scope is required');return undefined;}
 return z.string().uuid().parse(input.mandateId);
}

/** Explicit server-owned registration lane. SQL enforces the exact runtime tuple.
 * Production identity validity never grants local simulator policy/acceleration. */
export function nativeRegisteredRuntime(input:{scopeMode?:unknown;runtimeId?:unknown;mandateId?:unknown;required?:boolean}):string|undefined{
 if(input.scopeMode===undefined||input.scopeMode==='exact'){if(input.runtimeId!==undefined)throw Error('Unexpected native runtime registration');return undefined;}
 if(input.scopeMode!=='registered'||input.mandateId!==undefined||input.required!==true)throw Error('An exact registered native runtime scope is required');
 return z.string().regex(/^[a-z][a-z0-9-]{2,99}$/).parse(input.runtimeId);
}
