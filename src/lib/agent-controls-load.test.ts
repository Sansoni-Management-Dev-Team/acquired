import {expect,it,vi} from 'vitest';
import {loadAgentControls} from './agent-controls-load';
it('reads controls sequentially so one page cannot fan out six competing gate transactions',async()=>{
 let active=0,maximum=0;const order:string[]=[];
 const read=vi.fn(async(kind:string)=>{order.push(kind);active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return kind==='execution'?{enabled:true,state:null,mandateRevision:'1'}:kind==='authority'?{grants:[]}:kind==='handoffs'?{tasks:[]}:{enabled:true};});
 const result=await loadAgentControls(read);expect(maximum).toBe(1);expect(order).toEqual(['execution','handoffs','authority','targets','readiness','channel-policy']);expect(result).toMatchObject({enabled:true,mandateRevision:'1',grants:[],inbox:{tasks:[]}});
});
it('does not fabricate execution or authority when a required read fails',async()=>{
 const read=vi.fn(async(kind:string)=>{if(kind==='authority')throw Error('unavailable');return{};});
 await expect(loadAgentControls(read)).rejects.toThrow('unavailable');expect(read.mock.calls.map(([kind])=>kind)).toEqual(['execution','handoffs','authority']);
});
it('marks optional readiness/policy failures unavailable',async()=>{
 const read=vi.fn(async(kind:string)=>{if(['readiness','channel-policy'].includes(kind))throw Error('unavailable');return kind==='authority'?{grants:[]}:{enabled:true,state:null,tasks:[]};});
 expect(await loadAgentControls(read)).toMatchObject({readinessUnavailable:true,channelPolicyUnavailable:true,channelPolicy:{enabled:false,policy:null,accounts:[]}});
});
it('uses an authoritative bundled response without repeating the required reads',async()=>{
 const read=vi.fn(async(kind:string)=>kind==='execution'?{enabled:true,state:null,controls:{inbox:{tasks:[]},grants:[],targetOptions:{bindings:[]}}}:{});
 expect(await loadAgentControls(read)).toMatchObject({enabled:true,inbox:{tasks:[]},grants:[]});expect(read.mock.calls.map(([kind])=>kind)).toEqual(['execution','readiness','channel-policy']);
});
