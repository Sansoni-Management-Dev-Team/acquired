import {afterEach,expect,it,vi} from 'vitest';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {useEffect} from 'react';
import {useAgentDemoApprovalPreference} from './use-agent-demo-approval-preference';
import {AGENT_DEMO_AUTO_APPROVAL_OFF,AGENT_DEMO_AUTO_APPROVAL_ALL} from './agent-demo-auto-approval';

let tree:ReactTestRenderer|undefined;
let current:ReturnType<typeof useAgentDemoApprovalPreference>;
function Harness({allowed=true,owner='owner',mandate='demo'}:{allowed?:boolean;owner?:string;mandate?:string}){const value=useAgentDemoApprovalPreference(mandate,owner,allowed);useEffect(()=>{current=value;},[value]);return null;}
function setup(){
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const values=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
 return values;
}
afterEach(async()=>{if(tree)await act(()=>tree!.unmount());tree=undefined;vi.unstubAllGlobals();});

it('pauses approvals on readiness loss while retaining the explicit choice for verified recovery and reload',async()=>{
 setup();await act(()=>{tree=create(<Harness/>);});await act(()=>current.setSelection(AGENT_DEMO_AUTO_APPROVAL_ALL));await act(()=>tree!.unmount());
 await act(()=>{tree=create(<Harness allowed={false}/>);});expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);
 await act(()=>tree!.update(<Harness/>));expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_ALL);
 await act(()=>tree!.update(<Harness allowed={false}/>));expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);
 await act(()=>tree!.update(<Harness/>));expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_ALL);
 await act(()=>tree!.unmount());await act(()=>{tree=create(<Harness/>);});expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_ALL);
});
it('does not carry a selection into another mandate or owner in the same mounted component',async()=>{
 setup();await act(()=>{tree=create(<Harness/>);});await act(()=>current.setSelection(AGENT_DEMO_AUTO_APPROVAL_ALL));
 await act(()=>tree!.update(<Harness mandate="other"/>));expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);
 await act(()=>tree!.update(<Harness owner="other"/>));expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);
 await act(()=>tree!.update(<Harness/>));expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_ALL);
});
it.each(['{','null','{"version":9,"selection":{}}',JSON.stringify({version:1,selection:{...AGENT_DEMO_AUTO_APPROVAL_ALL,replies:'true'}}),JSON.stringify({version:1,selection:{...AGENT_DEMO_AUTO_APPROVAL_ALL,extra:true}})])('defaults Off for invalid saved preferences (%s)',async raw=>{
 const values=setup();await act(()=>{tree=create(<Harness/>);});await act(()=>current.setSelection(AGENT_DEMO_AUTO_APPROVAL_ALL));values.set([...values.keys()][0],raw);
 await act(()=>tree!.unmount());await act(()=>{tree=create(<Harness/>);});expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);
});
it('keeps choices usable on this page and reports when browser storage is unavailable',async()=>{
 setup();vi.stubGlobal('localStorage',{getItem:()=>{throw Error('Storage blocked');},setItem:()=>{throw Error('Storage blocked');}});
 await act(()=>{tree=create(<Harness/>);});expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);expect(current.persistent).toBe(false);
 await act(()=>current.setSelection(AGENT_DEMO_AUTO_APPROVAL_ALL));expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_ALL);expect(current.persistent).toBe(false);
 await act(()=>tree!.unmount());await act(()=>{tree=create(<Harness/>);});expect(current.selection).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);
});
