import {expect,it} from 'vitest';
import {acceptAgentHistory,validateAgentWakeup,nextAgentEngagement} from './agent-history';
const at='2026-10-17T08:00:00Z';
const message={id:'inbound-1',direction:'inbound' as const,text:'Who is buying?',at};
const previous={source:'local_fixture' as const,observedAt:at,complete:true,messages:[message]};
it('rejects a late snapshot and a conflicting replay of an immutable message',()=>{
 expect(()=>acceptAgentHistory(previous,{...previous,observedAt:'2026-10-17T07:00:00Z'},'local_sink','2026-10-17T09:00:00Z')).toThrow(/older/);
 expect(()=>acceptAgentHistory(previous,{...previous,messages:[{...message,text:'Book now'}]},'local_sink','2026-10-17T09:00:00Z')).toThrow(/changed/);
});
it('never allows a fixture history to stand in for a provider account',()=>{
 expect(()=>acceptAgentHistory(undefined,previous,'communications','2026-10-17T09:00:00Z')).toThrow(/provenance/);
});
it('does not silently drop earlier conversation history or reorder equal timestamp messages',()=>{
 expect(()=>acceptAgentHistory(previous,{...previous,messages:[]},'local_sink','2026-10-17T09:00:00Z')).toThrow(/missing/);
 const other={...message,id:'outbound-2',direction:'outbound' as const};
 expect(acceptAgentHistory(undefined,{...previous,messages:[other,message]},'local_sink','2026-10-17T09:00:00Z').messages.map(m=>m.id)).toEqual(['inbound-1','outbound-2']);
});
it('rejects future observations and messages newer than the observation',()=>{
 expect(()=>acceptAgentHistory(undefined,{...previous,observedAt:'2026-10-18T08:00:00Z'},'local_sink','2026-10-17T09:00:00Z')).toThrow(/future/);
 expect(()=>acceptAgentHistory(undefined,{...previous,messages:[{...message,at:'2026-10-17T10:00:00Z'}]},'local_sink','2026-10-17T09:00:00Z')).toThrow(/observation/);
});
it('accepts a bounded future reminder and refuses a past or unbounded wakeup',()=>{
 const input={wakeAt:'2026-10-18T08:00:00Z',timeZone:'Australia/Melbourne',reason:'Requested follow-up'};
 expect(validateAgentWakeup(input,at)).toEqual(input);
 expect(()=>validateAgentWakeup({...input,wakeAt:at},at)).toThrow(/future/);
 expect(()=>validateAgentWakeup({...input,wakeAt:'2027-11-01T08:00:00Z'},at)).toThrow(/366 days/);
});

it('does not reopen the engagement state of a meeting handoff when another lead reply arrives',()=>{
 expect(nextAgentEngagement('handoff',[message])).toBe('handoff');
 expect(nextAgentEngagement('stopped',[message])).toBe('stopped');
});

it('can persist a lead-requested three or six month wake-up with a one year bound',()=>{
 for(const wakeAt of ['2027-01-17T08:00:00Z','2027-04-17T08:00:00Z']){
  expect(validateAgentWakeup({wakeAt,timeZone:'Australia/Sydney',reason:'The lead asked us to reconnect then.'},at).wakeAt).toBe(wakeAt);
 }
 expect(()=>validateAgentWakeup({wakeAt:'2027-11-01T08:00:00Z',timeZone:'UTC',reason:'Too far'},at)).toThrow(/366 days/);
});

it('keeps the recorded channel identity and provider message reference immutable',()=>{
 const routed={...message,routeId:'20000000-0000-4000-8000-000000000002',channel:'whatsapp' as const,providerMessageId:'raw-provider-message',bindingDigest:'a'.repeat(64)};
 for(const changed of [{routeId:'30000000-0000-4000-8000-000000000003'},{channel:'linkedin'},{providerMessageId:'different-provider-message'},{bindingDigest:'b'.repeat(64)}]){
  expect(()=>acceptAgentHistory({...previous,messages:[routed]},{...previous,messages:[{...routed,...changed}]},'local_sink',at)).toThrow(/changed/);
 }
});
