import {runNativeAgentTick} from './agent-native-tick';
// A postcommit wake during discovery must not disappear into an older idle tick.
// One retained follow-up shares the same lane; no concurrent or unbounded drain.
const shared=globalThis as typeof globalThis & {
 acquireNativeTickInFlight?:ReturnType<typeof runNativeAgentTick>;
 acquireNativeTickWake?:{pending:boolean;following:boolean};
};
export function coalescedNativeAgentTick(options:{postCommit?:boolean}={}){
 if(shared.acquireNativeTickInFlight){
  if(options.postCommit&&shared.acquireNativeTickWake&&!shared.acquireNativeTickWake.following)shared.acquireNativeTickWake.pending=true;
  return shared.acquireNativeTickInFlight;
 }
 const wake={pending:false,following:false};shared.acquireNativeTickWake=wake;
 return shared.acquireNativeTickInFlight=(async()=>{
  const result=await runNativeAgentTick();
  // Failures/cancellation, disabled execution and deferred/lost/review work keep
  // their normal scheduler backoff. A wake is never an automatic effect retry.
  if(wake.pending&&result.enabled&&(result.outcome==='idle'||result.outcome==='complete')){
   wake.following=true;const follow=await runNativeAgentTick();
   return follow.enabled&&follow.processed===0&&result.processed===1?result:follow;
  }
  return result;
 })().finally(()=>{shared.acquireNativeTickInFlight=undefined;shared.acquireNativeTickWake=undefined;});
}
