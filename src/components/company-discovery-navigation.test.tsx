import React from "react";
import {act,create,type ReactTestRenderer} from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ResearchJob, ResearchPanelData } from "./research-panel";

const mocks = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn(), onResults: vi.fn() }));
vi.mock("next/link",()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, prefetch: mocks.prefetch }) }));
vi.mock("./research-panel", () => ({ ResearchPanel: ({ onResultsChanged }: { onResultsChanged: unknown }) => {
  mocks.onResults(onResultsChanged);
  return null;
} }));
import { CompanyDiscoveryLoading } from "./company-discovery-loading";

const root = { id: "new", status: "complete", config: { seeds: [] } } as unknown as ResearchJob;
const snapshot = (jobs: ResearchJob[] = [root]): ResearchPanelData => ({ enabled: true, active: false, jobs, findings: [] });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });
let renderer:ReactTestRenderer;
afterEach(async()=>{if(renderer)await act(()=>renderer.unmount());});
async function observe(){
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 await act(()=>{renderer=create(<CompanyDiscoveryLoading mandateId="mandate" startedJobId="new"/>);});
 return async(data:ResearchPanelData)=>{await act(()=>mocks.onResults.mock.calls.at(-1)![0](data));};
}
function links(){return renderer.root.findAllByType('a');}
it('stays on search even after completion with no results',async()=>{
 const update=await observe();await update(snapshot());await update(snapshot());
 expect(mocks.push).not.toHaveBeenCalled();expect(links()).toHaveLength(0);expect(fetch).not.toHaveBeenCalled();
});
it('offers View companies while discovery is active, without navigating away',async()=>{
 const update=await observe();await update(snapshot([{...root,status:'discovering',config:{...root.config,newBusinessIds:['company']}}]));
 expect(mocks.push).not.toHaveBeenCalled();expect(links()[0].props.href).toBe('/mandates/mandate/companies');expect(links()[0].children).toContain('View companies');
 await update(snapshot([{...root,config:{...root.config,newBusinessIds:['company']}}]));expect(mocks.push).not.toHaveBeenCalled();expect(links()).toHaveLength(1);
});
it.each(['failed','partial','complete'])('keeps saved results available for a %s search and stays put',async status=>{
 const update=await observe();await update({...snapshot([{...root,status,config:{...root.config,researchRunId:'new'}}]),companyJobs:[{...root,id:'saved',config:{...root.config,researchRunId:'new',newBusinessIds:['company']}}]});
 expect(links()).toHaveLength(1);expect(mocks.push).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('does not offer older results or queued company identifiers as saved data',async()=>{
 const update=await observe();await update({...snapshot([{...root,status:'discovering'},{...root,id:'older',config:{...root.config,newBusinessIds:['old']}}]),companyJobs:[{...root,id:'queued',status:'queued',config:{...root.config,researchRunId:'new',targetId:'planned'}}]});
 expect(links()).toHaveLength(0);expect(mocks.push).not.toHaveBeenCalled();
});
