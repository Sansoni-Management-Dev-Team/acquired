import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({db:vi.fn(),query:vi.fn(),identity:vi.fn(),defaultClient:vi.fn(),defaultHost:vi.fn()}));
vi.mock('@/db/campaign-client',()=>({withCampaignDb:f.db}));
vi.mock('./campaign-reply-store',()=>({saveReplyIdentity:f.identity}));
vi.mock('./communications-client',()=>({actorCommunicationsClient:f.defaultClient}));
vi.mock('./communications-configuration',()=>({configuredAcquireCommunicationsForBinding:f.defaultHost}));
import {refreshConfiguredDraft} from './communications-configured-monitor';
const actor={organizationId:'org',userId:'owner'},at='2031-01-01T00:00:00.000Z';
const row={binding_id:'binding',application_id:'acquire',organization_id:'org',owner_user_id:'owner',service_connection_id:'original',service_account_id:'physical',generation:1,channel:'email',platform:'gmail',backend:'unipile',authority:'service',required_since:at,contact_id:'contact',personal_data:{email:'person@example.test'}};
beforeEach(()=>{vi.clearAllMocks();f.db.mockImplementation(async(_actor,work)=>work({query:f.query}));f.query.mockResolvedValue({rows:[row]});});
it('uses explicit same-operation monitor clock, driver and original host without configured singleton capture',async()=>{
 const applicationPool={connect:vi.fn()},connectionStatus=vi.fn(),refreshAndConsume=vi.fn(),hostForBinding=vi.fn(async()=>({refreshAndConsume}));
 await refreshConfiguredDraft(actor,'draft',{businessClock:{now:()=>Date.parse(at)},applicationPool,client:{connectionStatus},hostForBinding} as never);
 expect(f.db.mock.calls[0][2]).toEqual({pool:applicationPool});expect(f.identity.mock.calls[0][2]).toEqual({pool:applicationPool});
 expect(hostForBinding).toHaveBeenCalledWith(expect.objectContaining({connectionId:'original',accountId:'physical'}));expect(connectionStatus).toHaveBeenCalledOnce();expect(refreshAndConsume).toHaveBeenCalledWith(expect.objectContaining({since:at}));expect(f.defaultClient).not.toHaveBeenCalled();expect(f.defaultHost).not.toHaveBeenCalled();
});
it('refuses a since boundary later than selected business time before client, identity or history work',async()=>{
 const hostForBinding=vi.fn();await expect(refreshConfiguredDraft(actor,'draft',{businessClock:{now:()=>Date.parse(at)-1},hostForBinding} as never)).rejects.toThrow();
 expect(f.identity).not.toHaveBeenCalled();expect(hostForBinding).not.toHaveBeenCalled();expect(f.defaultClient).not.toHaveBeenCalled();
});
