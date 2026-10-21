import {afterEach,expect,it,vi} from 'vitest';
import {create,act} from 'react-test-renderer';
import {emptyBrief} from '@/domain/acquisition';
vi.mock('./company-discovery-loading',()=>({CompanyDiscoveryLoading:()=>null}));
vi.mock('./company-pipeline-progress',()=>({CompanyPipelineProgress:()=>null}));
import {MandateBriefForm} from './mandate-brief-form';
afterEach(()=>vi.unstubAllGlobals());
it('keeps the revision the editor opened with despite background prop refreshes',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({brief:{...emptyBrief(),naturalLanguage:'Edited acquisition goal'},revision:'124'})).mockResolvedValueOnce(Response.json({jobId:'fixture-job'}));vi.stubGlobal('fetch',fetch);
 let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<MandateBriefForm mandateId="fixture" brief={emptyBrief()} revision="123"/>);});
  await act(async()=>{tree!.root.findByType('textarea').props.onChange({target:{value:'Edited acquisition goal'}});tree!.update(<MandateBriefForm mandateId="fixture" brief={emptyBrief()} revision="999"/>);});
  await act(async()=>tree!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({expectedRevision:'123'});
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
it('preserves unsaved text and does not launch research when saving conflicts',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetch=vi.fn().mockResolvedValue(Response.json({error:'The saved brief changed.'},{status:409}));vi.stubGlobal('fetch',fetch);let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<MandateBriefForm mandateId="fixture" brief={emptyBrief()} revision="123"/>);});
  await act(async()=>tree!.root.findByType('textarea').props.onChange({target:{value:'My unsaved acquisition description'}}));
  await act(async()=>tree!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  expect(tree!.root.findByType('textarea').props.value).toBe('My unsaved acquisition description');expect(fetch).toHaveBeenCalledTimes(1);
  expect(tree!.root.findAllByType('button').some(button=>button.props.children==='Load saved brief')).toBe(true);
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
it('adopts a new base revision only after the user explicitly loads the saved brief',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const saved={...emptyBrief(),naturalLanguage:'The winning saved acquisition goal'};
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({error:'The saved brief changed.'},{status:409}))
  .mockResolvedValueOnce(Response.json({mandate:{brief:saved,revision:'130'}}))
  .mockResolvedValueOnce(Response.json({brief:{...saved,naturalLanguage:'My revised acquisition goal'},revision:'131'}))
  .mockResolvedValueOnce(Response.json({jobId:'fixture-job'}));vi.stubGlobal('fetch',fetch);let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<MandateBriefForm mandateId="fixture" brief={emptyBrief()} revision="123"/>);});
  await act(async()=>tree!.root.findByType('textarea').props.onChange({target:{value:'My unsaved acquisition description'}}));
  await act(async()=>tree!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  await act(async()=>tree!.root.findAllByType('button').find(button=>button.props.children==='Load saved brief')!.props.onClick());
  expect(fetch.mock.calls[1][0]).toBe('/api/mandates/fixture?briefOnly=true');expect(tree!.root.findByType('textarea').props.value).toBe(saved.naturalLanguage);
  await act(async()=>tree!.root.findByType('textarea').props.onChange({target:{value:'My revised acquisition goal'}}));
  await act(async()=>tree!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  expect(JSON.parse(fetch.mock.calls[2][1].body).expectedRevision).toBe('130');
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
it('starts research directly when the saved description is unchanged',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const brief={...emptyBrief(),naturalLanguage:'Saved acquisition description'};
 const before=JSON.stringify(brief);
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({jobId:'fixture-job'}));vi.stubGlobal('fetch',fetch);
 let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<MandateBriefForm mandateId="fixture" brief={brief} revision="123"/>);});
  await act(async()=>tree!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/mandates/fixture/research');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({fromBrief:true});
  expect(JSON.stringify(brief)).toBe(before);
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
