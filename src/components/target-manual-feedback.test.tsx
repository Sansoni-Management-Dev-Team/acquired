import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {expect,it,vi} from 'vitest';
import {initialAssessment,emptyBrief,type MandateView,type MembershipView} from '@/domain/acquisition';
import {rankTarget} from '@/domain/scoring';import {defaultMandate,seedTargets} from '@/test/fixtures/scoring-targets';
vi.mock('next/link',()=>({default:({children,href,...rest}:React.ComponentProps<'a'>)=><a href={href} {...rest}>{children}</a>}));
vi.mock('./app-shell',()=>({SidebarRegistration:()=>null}));vi.mock('./research-panel',()=>({TargetResearchEvidence:()=>null}));
import {TargetWorksheet} from './target-worksheet';import {CompanyReviewPanel} from './company-review-panel';
const mandate={id:'00000000-0000-4000-8000-000000000001',brief:emptyBrief()} as MandateView;
const member:MembershipView={target:rankTarget(seedTargets[0],defaultMandate),assessment:{...initialAssessment,reason:'Installation-heavy projects'},version:3,accreditations:[]};
it('offers optional manual feedback on the exact saved worksheet review only when learning is enabled',()=>{
 expect(renderToStaticMarkup(<TargetWorksheet mandates={[mandate]} mandate={mandate} initial={member}/>)).not.toContain('Suggest a preference from this saved company review');
 const html=renderToStaticMarkup(<TargetWorksheet learningEnabled mandates={[mandate]} mandate={mandate} initial={member}/>);
 expect(html).toContain('Suggest a preference from this saved company review');expect(html).toContain('version 3');expect(html).toContain('Company fit');
});
it('offers the same small disclosure on saved company overview without altering contact research controls',()=>{
 const html=renderToStaticMarkup(<CompanyReviewPanel learningEnabled mandate={mandate} initial={member} position="Company" onClose={()=>{}}/>);
 expect(html).toContain('Suggest a preference from this saved company review');expect(html).toContain('Installation-heavy projects');expect(html).toContain('Contacts');
});
it('holds feedback while assessment edits are unsaved and binds the freshly returned saved revision',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');const {AgentManualFeedbackForm}=await import('./agent-manual-feedback-form');let tree:ReturnType<typeof create>|undefined;
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({saved:true})}).mockResolvedValueOnce({ok:true,json:async()=>({memberships:[{...member,version:4}]})});vi.stubGlobal('fetch',fetcher);
 try{
  await act(async()=>{tree=create(<TargetWorksheet learningEnabled mandates={[mandate]} mandate={mandate} initial={member}/>);});
  const feedback=()=>tree!.root.findByType(AgentManualFeedbackForm);expect(feedback().props.busy).toBe(false);
  const form=()=>tree!.root.findAllByType('form').find(node=>node.props.className==='space-y-5')!;
  await act(async()=>form().props.onChangeCapture());expect(feedback().props.busy).toBe(true);expect(feedback().props.source.revision).toBe(3);
  await act(async()=>{form().props.onSubmit({preventDefault:vi.fn()});});
  expect(feedback().props.busy).toBe(false);expect(feedback().props.source.revision).toBe(4);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({action:'assessment',version:3});expect(fetcher.mock.calls.every(([url])=>!String(url).includes('/agent'))).toBe(true);
 }finally{if(tree)await act(async()=>tree!.unmount());vi.unstubAllGlobals();}
});
