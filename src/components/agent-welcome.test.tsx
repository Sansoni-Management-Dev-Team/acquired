import {expect,it,vi} from 'vitest';
import {AgentWelcome} from './agent-welcome';
import {agentWelcomeMessage} from '@/domain/agent-welcome';
it.each([false,true])('saves exactly the visible welcome copy and original two-sentence summary (research only: %s)',async researchOnly=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const description='Find Australian packaging businesses. Prefer family-owned companies. This third sentence stays in the saved original brief.';
 try{await act(()=>{tree=create(<AgentWelcome description={description} researchOnly={researchOnly}><button>Start</button></AgentWelcome>);});
 const paragraphs=tree!.root.findAllByType('p').map(p=>p.children.join(''));
 expect(paragraphs[1]).toBe('You’re looking for Australian packaging businesses. Prefer family-owned companies.');
 expect(agentWelcomeMessage(description,researchOnly).split('\n\n')).toEqual([tree!.root.findByType('h2').children.join(''),paragraphs[0],paragraphs[1]]);
 expect(agentWelcomeMessage(description,researchOnly)).not.toContain('Ready to begin?');
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});
it('shows the welcome, saved mandate and Start immediately without making a request',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentWelcome description="We are seeking an Australian food packaging business."><button>Start</button></AgentWelcome>);});
 expect(JSON.stringify(tree!.toJSON())).toContain('Hi, I’m Acquire');expect(JSON.stringify(tree!.toJSON())).toContain('Australian food packaging business');expect(tree!.root.findByType('button').props.children).toBe('Start');expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it('turns an Explore acquisition brief into a natural summary without duplicating the instruction',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentWelcome description="Explore the acquisition of an established laundry business in Victoria."><button>Start</button></AgentWelcome>);});const text=JSON.stringify(tree!.toJSON());expect(text).toContain('an established laundry business in Victoria');expect(text).not.toContain('Explore the acquisition');expect(tree!.root.findByType('h2').props.style.fontFamily).toBe('inherit');}finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
