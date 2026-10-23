import {expect,it,vi} from 'vitest';
import {AgentFeedbackForm} from './agent-feedback-form';
it('submits a correction tied to the displayed entity version and keeps failed edits for retry',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const save=vi.fn().mockResolvedValue(false),source={kind:'operation' as const,id:'00000000-0000-4000-8000-000000000001',revision:3};
 try{
  await act(async()=>{tree=create(<AgentFeedbackForm source={source} busy={false} onSave={save}/>);});
  const fields=tree!.root.findAllByType('textarea');
  await act(async()=>{fields[0].props.onChange({target:{value:'This reply is too pushy.'}});fields[1].props.onChange({target:{value:'Use a conversational tone.'}});});
  await act(async()=>{await tree!.root.findByType('form').props.onSubmit({preventDefault:vi.fn()});});
  expect(save).toHaveBeenCalledWith(expect.objectContaining({action:'feedback',input:{source,reason:'This reply is too pushy.',preference:'Use a conversational tone.',category:'qualification'}}));
  expect(tree!.root.findAllByType('textarea')[0].props.value).toBe('This reply is too pushy.');
  const key=save.mock.calls[0][0].requestKey;
  await act(async()=>{await tree!.root.findByType('form').props.onSubmit({preventDefault:vi.fn()});});
  expect(save.mock.calls[1][0].requestKey).toBe(key);
  save.mockResolvedValueOnce(true);
  await act(async()=>{await tree!.root.findByType('form').props.onSubmit({preventDefault:vi.fn()});});
  expect(JSON.stringify(tree!.toJSON())).toContain('Confirm it in saved guidance before use');
 }finally{if(tree)await act(async()=>tree!.unmount());vi.unstubAllGlobals();}
});
