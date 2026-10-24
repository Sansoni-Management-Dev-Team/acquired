import {runNativeAgentTick} from './agent-native-tick';
// The persistent app node shares the lane across route bundles and wake callers.
// A wake is only a scheduling hint; the ordinary claim/admission fences remain.
const shared=globalThis as typeof globalThis & {acquireNativeTickInFlight?:ReturnType<typeof runNativeAgentTick>};
export function coalescedNativeAgentTick(){
 return shared.acquireNativeTickInFlight??=runNativeAgentTick().finally(()=>{shared.acquireNativeTickInFlight=undefined;});
}
