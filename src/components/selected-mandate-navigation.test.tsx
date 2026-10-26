import React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {create,act} from 'react-test-renderer';
import {MandatePicker} from './cached-mandate-pages';
import {AppShell} from './app-shell';
import {emptyBrief} from '@/domain/acquisition';
const state=vi.hoisted(()=>({selected:undefined as string|undefined,pathname:'/mandates/select/targets',loaded:true,replace:vi.fn()}));
vi.mock('./use-cached-mandates',()=>({useSelectedMandate:()=>state.selected,useCachedSession:()=>null,useCachedMandates:()=>({mandates:[{id:'selected-mandate',brief:{...emptyBrief(),name:'Selected mandate'},createdAt:'2026-10-18T00:00:00Z'}],loaded:state.loaded,refreshing:false,error:'',retry:vi.fn()})}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:state.replace}),usePathname:()=>state.pathname,useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/image',()=>({default:()=>null}));
vi.mock('next/link',()=>({default:({children,...props}:React.ComponentProps<'a'>)=><a {...props}>{children}</a>}));
vi.mock('./theme-toggle',()=>({ThemeToggle:()=>null}));
vi.mock('./campaign-reply-alerts',()=>({CampaignReplyAlerts:()=>null}));
vi.mock('./acquisition-progress',()=>({AcquisitionProgress:()=>null}));
let tree:ReturnType<typeof create>|undefined;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);state.selected=undefined;state.loaded=true;state.replace.mockClear();});afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;vi.unstubAllGlobals();});
it.each([['brief','/mandates/selected-mandate?tab=brief'],['targets','/mandates/selected-mandate/companies'],['people','/mandates/selected-mandate/people'],['sequences','/mandates/selected-mandate/outreach/sequences']]as const)('opens the remembered mandate when entering the generic %s selection route',async(section,href)=>{state.selected='selected-mandate';await act(async()=>{tree=create(<MandatePicker section={section}/>);});expect(state.replace).toHaveBeenCalledWith(href);expect(tree!.root.findAllByProps({'aria-label':'Choose a mandate'})).toHaveLength(0);});
it('keeps the chooser and makes no redirect when no mandate was selected',async()=>{await act(async()=>{tree=create(<MandatePicker section="targets"/>);});expect(tree!.root.findAllByProps({'aria-label':'Choose a mandate'})).toHaveLength(1);expect(state.replace).not.toHaveBeenCalled();});
it('uses the same remembered context for sidebar links on a generic selection route',async()=>{state.selected='selected-mandate';await act(async()=>{tree=create(<AppShell><div>Page</div></AppShell>);});const links=tree!.root.findAllByType('a');expect(links.find(l=>l.props.title==='Companies')?.props.href).toBe('/mandates/selected-mandate/companies');expect(links.find(l=>l.props.title==='People')?.props.href).toBe('/mandates/selected-mandate/people');});

it('waits for the validated mandate cache before asking the user to choose',async()=>{state.loaded=false;await act(async()=>{tree=create(<MandatePicker section="targets"/>);});expect(tree!.root.findAllByProps({'aria-label':'Choose a mandate'})).toHaveLength(0);expect(state.replace).not.toHaveBeenCalled();});

it('refreshes a fresh but incomplete roster once for a direct mandate URL, then remembers the validated result',async()=>{
 const {useMandateCache}=await import('@/lib/mandate-cache'),before=useMandateCache.getState(),refresh=vi.fn().mockResolvedValue(undefined),mandate={id:'newly-opened',brief:emptyBrief(),createdAt:'2026-10-18T00:00:00Z'};state.pathname='/mandates/newly-opened';
 try{useMandateCache.setState({session:{scope:'current-scope',expiresAt:Date.now()+60000},entry:{scope:'current-scope',mandates:[],updatedAt:Date.now()},refresh});await act(async()=>{tree=create(<AppShell><div>Page</div></AppShell>);});expect(refresh).toHaveBeenCalledExactlyOnceWith(true);expect(useMandateCache.getState().entry?.selectedMandateId).toBeUndefined();await act(async()=>{useMandateCache.setState({entry:{scope:'current-scope',mandates:[mandate],updatedAt:Date.now()}});});expect(useMandateCache.getState().entry?.selectedMandateId).toBe('newly-opened');expect(refresh).toHaveBeenCalledTimes(1);}finally{if(tree)await act(async()=>tree!.unmount());tree=undefined;useMandateCache.setState(before);state.pathname='/mandates/select/targets';}
});
