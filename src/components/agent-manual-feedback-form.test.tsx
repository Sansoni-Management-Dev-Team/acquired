import {expect,it,vi} from 'vitest';
import {AgentManualFeedbackForm} from './agent-manual-feedback-form';
const source={kind:'sequence_draft' as const,sequenceId:'00000000-0000-4000-8000-000000000003',revision:'24'};
it('saves exact manual-version feedback as an unapproved suggestion, preserving corrections and request identity on retries',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const fetcher=vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'conflict'})});vi.stubGlobal('fetch',fetcher);
 try{
  await act(async()=>{tree=create(<AgentManualFeedbackForm source={source} mandateId="mandate" busy={false}/>);});
  await act(async()=>{const fields=tree!.root.findAllByType('textarea');fields[0].props.onChange({target:{value:'The wording is too formal.'}});fields[1].props.onChange({target:{value:'Prefer plain conversational writing.'}});});
  const submit=()=>tree!.root.findByType('form').props.onSubmit({preventDefault:vi.fn()});
  await act(async()=>{await submit();});const first=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(first).toMatchObject({action:'manualFeedback',input:{source,reason:'The wording is too formal.',preference:'Prefer plain conversational writing.',category:'tone'}});
  expect(fetcher.mock.calls[0][0]).toBe('/api/mandates/mandate/agent/guidance');expect(tree!.root.findAllByType('textarea')[0].props.value).toBe('The wording is too formal.');
  await act(async()=>{await submit();});expect(JSON.parse(fetcher.mock.calls[1][1].body).requestKey).toBe(first.requestKey);
  await act(async()=>{tree!.update(<AgentManualFeedbackForm source={{...source,revision:'25'}} mandateId="mandate" busy={false}/>);});
  expect(tree!.root.findAllByType('textarea')[0].props.disabled).toBe(true);
  await act(async()=>{await submit();});expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async()=>tree!.root.findAllByType('button').find(button=>button.props.children==='Use current version')!.props.onClick());
  fetcher.mockResolvedValue({ok:true,json:async()=>({guidance:{id:'guidance-id',name:'guidance.memory',revision:1,state:'proposed'}})});
  await act(async()=>{await submit();});expect(JSON.parse(fetcher.mock.calls[2][1].body).input.source.revision).toBe('25');expect(JSON.parse(fetcher.mock.calls[2][1].body).requestKey).not.toBe(first.requestKey);
  expect(JSON.stringify(tree!.toJSON())).toContain('Confirm it in saved guidance before use');expect(tree!.root.findByType('a').props.href).toBe('/mandates/mandate/agent');
  expect(fetcher.mock.calls.every(([url])=>String(url).endsWith('/guidance'))).toBe(true);
 }finally{if(tree)await act(async()=>tree!.unmount());vi.unstubAllGlobals();}
});
it('preserves an unconfirmed response for retry and does not clear another version after an in-flight response',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined,resolve!:(value:unknown)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>resolve=r)));
 try{
  await act(async()=>{tree=create(<AgentManualFeedbackForm source={source} mandateId="mandate" busy={false}/>);});
  await act(async()=>{const fields=tree!.root.findAllByType('textarea');fields[0].props.onChange({target:{value:'More personal context needed'}});fields[1].props.onChange({target:{value:'Use the approved buyer context'}});});
  let pending:Promise<void>;await act(async()=>{pending=tree!.root.findByType('form').props.onSubmit({preventDefault:vi.fn()});});
  await act(async()=>{tree!.update(<AgentManualFeedbackForm source={{...source,revision:'25'}} mandateId="mandate" busy={false}/>);});
  await act(async()=>{resolve({ok:true,json:async()=>({guidance:{id:'guidance-id',name:'guidance.memory',revision:1,state:'proposed'}})});await pending;});
  expect(tree!.root.findAllByType('textarea')[0].props.value).toBe('More personal context needed');expect(tree!.root.findAllByType('textarea')[0].props.disabled).toBe(true);
 }finally{if(tree)await act(async()=>tree!.unmount());vi.unstubAllGlobals();}
});

it('does not clear a correction when a successful HTTP response lacks a saved guidance receipt',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({guidance:{}})}));
 try{
  await act(async()=>{tree=create(<AgentManualFeedbackForm source={source} mandateId="mandate" busy={false}/>);});
  await act(async()=>{const fields=tree!.root.findAllByType('textarea');fields[0].props.onChange({target:{value:'This wording needs improvement'}});fields[1].props.onChange({target:{value:'Prefer plain concise language'}});});
  await act(async()=>{await tree!.root.findByType('form').props.onSubmit({preventDefault:vi.fn()});});
  expect(tree!.root.findAllByType('textarea')[0].props.value).toBe('This wording needs improvement');expect(JSON.stringify(tree!.toJSON())).toContain('Feedback could not be confirmed');
 }finally{if(tree)await act(async()=>tree!.unmount());vi.unstubAllGlobals();}
});
