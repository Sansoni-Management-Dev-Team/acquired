import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {AgentDemoApprovalControls} from './agent-demo-approval-controls';
import {AGENT_DEMO_AUTO_APPROVAL_OFF,AGENT_DEMO_AUTO_APPROVAL_ALL} from './agent-demo-auto-approval';

it('keeps demo approval preferences in a compact closed header disclosure with all selectable steps',()=>{
 const onChange=vi.fn(),html=renderToStaticMarkup(<AgentDemoApprovalControls value={AGENT_DEMO_AUTO_APPROVAL_OFF} onChange={onChange}/>);
 expect(html).toContain('Auto-approve: Off');expect(html).not.toMatch(/<details[^>]*\sopen(?:=|>)/);for(const label of ['Off','Custom','All','Contact selection','First messages','Replies','Follow-ups','Connection requests','Booking-link drafts','Drafts needing attention'])expect(html).toContain(label);expect(html).toContain('Simulated recipients only');expect(html).toContain('Saved for this demo in this browser');expect(html).not.toContain('Resets on reload');expect(html).toContain('Sending booking links and recording meetings still need you');expect(onChange).not.toHaveBeenCalled();
});
it('emits only the exact selected step while the parent retains ownership of state',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn());const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const onChange=vi.fn();
 try{await act(()=>{tree=create(<AgentDemoApprovalControls value={AGENT_DEMO_AUTO_APPROVAL_OFF} onChange={onChange}/>)});expect(fetch).not.toHaveBeenCalled();expect(onChange).not.toHaveBeenCalled();const check=tree!.root.findByProps({'aria-label':'Automatically approve demo replies'});await act(()=>check.props.onChange({target:{checked:true}}));const next={...AGENT_DEMO_AUTO_APPROVAL_OFF,replies:true};expect(onChange).toHaveBeenCalledExactlyOnceWith(next);expect(check.props.checked).toBe(false);await act(()=>tree!.update(<AgentDemoApprovalControls value={next} onChange={onChange}/>));expect(tree!.root.findByProps({'aria-label':'Auto-approve: Custom'})).toBeDefined();expect(tree!.root.findByProps({'aria-label':'Automatically approve demo replies'}).props.checked).toBe(true);expect(fetch).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});
it('makes all-step opt-in explicit, opens custom choices without silently enabling defaults, and can turn everything off',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const onChange=vi.fn(),focus=vi.fn();
 try{await act(()=>{tree=create(<AgentDemoApprovalControls value={AGENT_DEMO_AUTO_APPROVAL_OFF} onChange={onChange}/>,{createNodeMock:node=>node.type==='input'?{focus}:null})});const button=(label:string)=>tree!.root.findAllByType('button').find(b=>b.props.children===label)!;await act(()=>button('Custom').props.onClick());expect(onChange).not.toHaveBeenCalled();expect(focus).toHaveBeenCalledOnce();await act(()=>button('All').props.onClick());expect(onChange).toHaveBeenLastCalledWith(AGENT_DEMO_AUTO_APPROVAL_ALL);await act(()=>tree!.update(<AgentDemoApprovalControls value={AGENT_DEMO_AUTO_APPROVAL_ALL} onChange={onChange}/>));expect(tree!.root.findByProps({'aria-label':'Auto-approve: All'})).toBeDefined();await act(()=>button('Off').props.onClick());expect(onChange).toHaveBeenLastCalledWith(AGENT_DEMO_AUTO_APPROVAL_OFF);
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});
it('blocks enabling disabled options while preserving an explicit way to stop active demo approvals',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const onChange=vi.fn();
 try{await act(()=>{tree=create(<AgentDemoApprovalControls value={AGENT_DEMO_AUTO_APPROVAL_ALL} onChange={onChange} disabled/>)});const buttons=tree!.root.findAllByType('button'),off=buttons.find(b=>b.props.children==='Off')!;expect(off.props.disabled).toBe(false);expect(buttons.find(b=>b.props.children==='All')!.props.disabled).toBe(true);expect(tree!.root.findAllByType('input').every(input=>input.props.disabled)).toBe(true);await act(()=>off.props.onClick());expect(onChange).toHaveBeenCalledExactlyOnceWith(AGENT_DEMO_AUTO_APPROVAL_OFF);
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});
