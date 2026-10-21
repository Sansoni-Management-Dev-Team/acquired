import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {defaultCampaignDefinition} from '@/domain/default-campaign';
vi.mock('next/link',()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock('@/components/campaign-sequence-editor',()=>({CampaignSequenceEditor:()=>null}));
vi.mock('@/components/agent-manual-feedback-form',()=>({AgentManualFeedbackForm:({source,busy}:{source:unknown;busy:boolean})=><aside data-source={JSON.stringify(source)} data-busy={String(busy)}>Saved draft feedback</aside>}));
import {CampaignStudio,type StudioData} from './campaign-studio';
const sequenceId='00000000-0000-4000-8000-000000000003',mandateId='00000000-0000-4000-8000-000000000004';
const initialData:StudioData={sequences:[{id:sequenceId,name:'Original human sequence',draft:defaultCampaignDefinition(),publishedDefinition:null,publishedVersion:0,n8nWorkflowId:null,draftRevision:'24',updatedAt:'2026-10-17T00:00:00Z'}],contacts:[],enrolments:[],mailbox:null};
it('only offers feedback for saved manual drafts when learning is explicitly enabled',()=>{
 const base={mandateId,mandateName:'Example',initialData,initialView:'sequences' as const};
 expect(renderToStaticMarkup(<CampaignStudio {...base}/>)).not.toContain('Saved draft feedback');
 const html=renderToStaticMarkup(<CampaignStudio {...base} learningEnabled/>);
 expect(html).toContain('Saved draft feedback');expect(html).toContain('&quot;kind&quot;:&quot;sequence_draft&quot;');expect(html).toContain('&quot;revision&quot;:&quot;24&quot;');expect(html).toContain(sequenceId);
});
it('keeps a feedback correction mounted but disabled when a manual draft becomes unsaved, then binds to the actual saved revision',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const updated={...initialData,sequences:[{...initialData.sequences[0],name:'Edited literal name',draftRevision:'25'}]};
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>initialData});vi.stubGlobal('fetch',fetcher);
 try{
  await act(async()=>{tree=create(<CampaignStudio mandateId={mandateId} mandateName="Example" initialData={initialData} initialView="sequences" learningEnabled/>);});
  const feedback=()=>tree!.root.findByType('aside');expect(feedback().props['data-busy']).toBe('false');
  const name=tree!.root.findAllByType('input').find(input=>input.props.value==='Original human sequence')!;
  await act(async()=>name.props.onChange({target:{value:'Edited literal name'}}));
  expect(feedback().props['data-busy']).toBe('true');expect(feedback().props['data-source']).toContain('"revision":"24"');
  fetcher.mockImplementation(async(_url:string,init?:RequestInit)=>({ok:true,json:async()=>init?.method==='PUT'?{draftRevision:'25'}:updated}));
  await act(async()=>{await tree!.root.findAllByType('button').find(button=>button.props.children==='Save draft')!.props.onClick();});
  expect(feedback().props['data-source']).toContain('"revision":"25"');expect(feedback().props['data-busy']).toBe('false');
  const write=fetcher.mock.calls.find(([,init])=>init?.method==='PUT');expect(JSON.parse(write![1]!.body as string)).toEqual({name:'Edited literal name',definition:initialData.sequences[0].draft,expectedRevision:'24'});
  expect(fetcher.mock.calls.some(([url])=>String(url).includes('/agent/'))).toBe(false);
 }finally{if(tree)await act(async()=>tree!.unmount());vi.unstubAllGlobals();}
});
