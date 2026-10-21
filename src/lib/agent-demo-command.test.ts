import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createAgentDemoPreparationCommand,demoResearchPreparationKey} from './agent-demo-command';
import type {agentDemoProvisioningConfiguration} from './agent-demo-configuration';
import type {MandateResearchContext} from '@/domain/mandate-execution-context';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),actor={organizationId:'org',userId:'user'};
function fixture(){
 const context=vi.fn<()=>Promise<MandateResearchContext>>(async()=>({version:1,mandateId:id(1),mode:'real',identityScope:{kind:'organization',id:'org'}}));
 const configuration=vi.fn<()=>ReturnType<typeof agentDemoProvisioningConfiguration>>(()=>({control:{endpoint:'https://127.0.0.1:5890',adminKey:'test-private-key'},selection:{runId:'agent-real-research-demos',integrationId:'sim-agent-real-research-demos',configurationReference:'sim-agent-real-research-demos-v1'}})),plan=vi.fn(async()=>({kind:'complete' as const,count:4})),commit=vi.fn(),store=vi.fn(()=>({plan,commit})),prepare=vi.fn();
 const command=createAgentDemoPreparationCommand({context,configuration,store,prepare});return {context,configuration,plan,commit,store,prepare,command};
}
it('ordinary real research never reads simulator authority or performs CLI preparation',async()=>{const f=fixture();expect(await f.command(actor,id(1),id(2))).toEqual({kind:'real'});expect(f.context).toHaveBeenCalledWith(actor,id(1));expect(f.configuration).not.toHaveBeenCalled();expect(f.store).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();});
it('uses saved demo mode and the same exact persisted request on completion replay',async()=>{const f=fixture();f.context.mockResolvedValue({version:1,mandateId:id(1),mode:'demo',identityScope:{kind:'demo',id:id(1)}});const key=demoResearchPreparationKey(id(3),id(4));expect(await f.command(actor,id(1),key)).toEqual({kind:'demo',prepared:4,outreachReady:false,replayed:true});expect(f.plan).toHaveBeenCalledWith(id(1),key);expect(f.prepare).not.toHaveBeenCalled();});
it('does not continue after changed scope or absent dedicated configuration',async()=>{const f=fixture();f.context.mockResolvedValueOnce({version:1,mandateId:id(5),mode:'demo',identityScope:{kind:'demo',id:id(5)}});await expect(f.command(actor,id(1),id(2))).rejects.toThrow('scope changed');expect(f.configuration).not.toHaveBeenCalled();f.context.mockResolvedValueOnce({version:1,mandateId:id(1),mode:'demo',identityScope:{kind:'demo',id:id(1)}});f.configuration.mockReturnValueOnce(null);await expect(f.command(actor,id(1),id(2))).rejects.toMatchObject({status:503});expect(f.store).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();});
it('derives stable original-job retry identity rather than a key from a polling time or source PII',()=>{expect(demoResearchPreparationKey(id(3),id(4))).toBe(demoResearchPreparationKey(id(3),id(4)));expect(demoResearchPreparationKey(id(3),id(4))).not.toBe(demoResearchPreparationKey(id(5),id(4)));expect(demoResearchPreparationKey(id(3),id(4))).toMatch(/^[a-f0-9-]{14}8[a-f0-9-]{21}$/);});

it('explains testing-service readiness before touching source requests, accounts or simulator authority',async()=>{
 for(const actorMismatch of [false,true]){
  const f=fixture();f.context.mockResolvedValue({version:1,mandateId:id(1),mode:'demo',identityScope:{kind:'demo',id:id(1)}});
  f.configuration.mockReturnValue({control:{endpoint:'https://127.0.0.1:5990',adminKey:'separate-testing-key'},selection:{runId:'agent-deep-gui-test',integrationId:'sim-agent-deep-gui-test',configurationReference:'sim-agent-deep-gui-test-v1'},testing:{serviceOrigin:'https://127.0.0.1:5991',actor:{applicationId:'acquire',tenantId:actorMismatch?'foreign-org':'org',ownerId:'user'},capabilities:{dynamicRecipients:actorMismatch,recipientContextLookup:actorMismatch}}});
  await expect(f.command(actor,id(1),id(2))).rejects.toMatchObject({status:503,message:expect.stringMatching(/5991.*not ready/)});
  expect(f.store).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
 }
});
