import {after} from 'next/server';
/** Call only after an event-producing command has confirmed its durable commit.
 * One tick, no polling loop or retries. The scheduled worker remains the fallback. */
export function wakeNativeAgentAfterCommit(){
 try{after(async()=>{try{const {coalescedNativeAgentTick}=await import('./agent-native-tick-coalesced');await coalescedNativeAgentTick();}catch{console.info('native-agent-wake',JSON.stringify({stage:'postcommit_wake_deferred'}));}});}catch{
  // Scheduling failure cannot change the result of an already committed command.
  console.info('native-agent-wake',JSON.stringify({stage:'postcommit_wake_unavailable'}));
 }
}
