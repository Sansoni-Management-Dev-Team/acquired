import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual} from 'node:util';
import type {OperationSnapshot,MessagingAdapter} from '../../contracts/src';
type Scope={snapshot:OperationSnapshot;active:boolean;attempted:boolean;writeStarted:boolean;start:()=>Promise<void>};
const scopes=new AsyncLocalStorage<Scope>();
/** Internal server capability, never a request flag or proof by itself. A late
 * continuation retains the revoked scope and cannot acquire another write. */
export async function runWithTransportBoundary<T>(snapshot:OperationSnapshot,start:()=>Promise<void>,work:()=>Promise<T>):Promise<{value:T;writeStarted:boolean}>{
 const scope:Scope={snapshot:structuredClone(snapshot),active:true,attempted:false,writeStarted:false,start};
 return scopes.run(scope,async()=>{try{return{value:await work(),writeStarted:scope.writeStarted};}finally{scope.active=false;}});
}
/** Called immediately before every effectful dispatch transport invocation.
 * Uninstrumented legacy composition keeps its prior behavior and cannot prove
 * pre-write failure. The opted-in coordinator supplies the durable gate. */
export async function beforeTransportWrite(snapshot:OperationSnapshot):Promise<void>{
 const scope=scopes.getStore();if(!scope)return;
 if(!scope.active||scope.attempted||!isDeepStrictEqual(snapshot,scope.snapshot))throw Error('Transport boundary unavailable');
 scope.attempted=true;await scope.start();
 if(!scope.active)throw Error('Transport boundary expired');
 scope.writeStarted=true;
}

const instrumented=new WeakSet<object>();
/** Trusted adapter construction only, never derived from caller data. */
export function markTransportBoundaryAdapter<T extends MessagingAdapter>(adapter:T):T{instrumented.add(adapter);return adapter;}
export function supportsTransportBoundaryAdapter(adapter:MessagingAdapter):boolean{return instrumented.has(adapter);}
