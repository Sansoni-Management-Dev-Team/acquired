import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({run:vi.fn(),reveal:vi.fn(),progress:vi.fn(),finish:vi.fn(),contacts:[] as Record<string,unknown>[]}));
vi.mock('@/db/client',()=>({requireDb:()=>({select:()=>{const q={from:()=>q,where:()=>q,orderBy:async()=>mocks.contacts,then:(resolve:(rows:unknown[])=>unknown)=>Promise.resolve(mocks.contacts).then(resolve)};return q;},update:()=>({set:()=>({where:()=>({returning:async()=>[{id:"contact"}],then:(resolve:(rows:unknown[])=>unknown)=>Promise.resolve([]).then(resolve)})})})})}));
vi.mock('@/db/firmable-history-repository',()=>({FirmableHistoryRepository:class{run=mocks.run;updateProgress=mocks.progress;finishRun=mocks.finish;}}));
vi.mock('@/adapters/firmable-client',async importOriginal=>({...await importOriginal<typeof import('@/adapters/firmable-client')>(),FirmableClient:class{revealPersonPhones=mocks.reveal;}}));
import { refreshFirmablePhoneBatch } from './firmable-refresh';
beforeEach(()=>{vi.clearAllMocks();mocks.run.mockResolvedValue({id:'run',trigger:'phones',organizationId:'org',targetId:'target'});mocks.contacts=[];});
it('rejects phone retrieval from automatic discovery jobs',async()=>{mocks.run.mockResolvedValue({trigger:'discovery'});await expect(refreshFirmablePhoneBatch('run',0)).rejects.toThrow('explicit manual');expect(mocks.reveal).not.toHaveBeenCalled();});
it('never repeats an uncertain credit request when a workflow callback is replayed',async()=>{
 mocks.contacts=[{id:'contact',firmablePersonId:'fp123',personalData:{email:'person@example.com'},provenance:{phoneLookup:{runId:'run',status:'pending'}}}];
 expect(await refreshFirmablePhoneBatch('run',0)).toMatchObject({complete:true,failed:1});expect(mocks.reveal).not.toHaveBeenCalled();expect(mocks.finish).toHaveBeenCalledWith('run',expect.objectContaining({failed:1}));
});
it('preserves already saved phone numbers without spending credits',async()=>{
 mocks.contacts=[{id:'contact',firmablePersonId:'fp123',personalData:{email:'person@example.com',phone:'0412345678'},provenance:{}}];
 expect(await refreshFirmablePhoneBatch('run',0)).toMatchObject({complete:true,saved:1,failed:0});expect(mocks.reveal).not.toHaveBeenCalled();
});
