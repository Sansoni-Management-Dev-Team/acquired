import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({rows:vi.fn(),ready:vi.fn(),provider:vi.fn(),mailbox:vi.fn(),grant:vi.fn(),fresh:vi.fn()}));
vi.mock('@/db/campaign-client',()=>({rows:mock.rows,withCampaignDb:(_actor:unknown,work:(client:unknown)=>unknown)=>work({})}));
vi.mock('@/lib/channels/delivery-registry',()=>({deliveryProvider:mock.provider}));
vi.mock('@/test/fixtures/campaign-mailbox',()=>({campaignMailboxForConnection:mock.mailbox}));
vi.mock('@/test/fixtures/gmail-connection',()=>({connectionCanMonitorReplies:mock.grant}));
vi.mock('@/lib/campaign-reply-monitor',()=>({assertContactReplyFresh:mock.fresh}));
import {campaignReplyReadiness} from './campaign-reply-readiness';
import {ReplyCheckPending,ReplyCheckReview} from './campaign-reply-status';
const actor={organizationId:'synthetic-org',userId:'synthetic-owner'};
let unresolved=false;
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE','enforce');unresolved=false;
 mock.provider.mockReturnValue({ready:mock.ready});
 mock.rows.mockImplementation(async(_client:unknown,sql:string)=>{if(sql.includes('mailbox_connections'))throw Error('Retired Gmail grants must not gate configured delivery');return [{id:'enrolment',contact_id:'contact',state:'active',stop_reason:null,started_at:new Date(0),unresolved_attempt:unresolved,definition:{schemaVersion:1,steps:[{id:'00000000-0000-4000-8000-000000000001',kind:'email',title:'Hello',subject:'Hello',body:'Hello'}]}}];});
});
afterEach(()=>vi.unstubAllEnvs());
it('uses configured email readiness without requiring or reading a historical Gmail grant',async()=>{
 expect(await campaignReplyReadiness(actor)).toMatchObject({recoveryReady:true,enrolments:[{coverage:'ready',delivery:'ready'}]});
 expect(mock.rows.mock.calls.some(([,sql])=>String(sql).includes('mailbox_connections'))).toBe(false);expect(mock.mailbox).not.toHaveBeenCalled();expect(mock.grant).not.toHaveBeenCalled();expect(mock.provider).toHaveBeenCalledWith('email',undefined);expect(mock.ready).toHaveBeenCalledWith(actor);
});
it.each([['waiting',()=>new ReplyCheckPending('incomplete','email'),'incomplete'],['review',()=>new ReplyCheckReview('account_changed','email'),'account_changed']] as const)('preserves configured %s readiness rather than substituting Gmail reconnect',async(delivery,failure,code)=>{
 mock.ready.mockRejectedValue(failure());expect(await campaignReplyReadiness(actor)).toMatchObject({recoveryReady:false,enrolments:[{coverage:'ready',delivery,deliveryDiagnostic:{code,channel:'email'}}]});expect(mock.mailbox).not.toHaveBeenCalled();
});
it('never clears unresolved recorded attempts when configured readiness succeeds',async()=>{
 unresolved=true;expect(await campaignReplyReadiness(actor)).toMatchObject({recoveryReady:false,enrolments:[{coverage:'ready',delivery:'ready',unresolvedAttempt:true}]});
});
it('uses the paused delivery boundary without reading retired Gmail grants when runtime is disabled',async()=>{
 vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','false');mock.ready.mockRejectedValue(new ReplyCheckReview('delivery_disabled','email'));
 expect(await campaignReplyReadiness(actor)).toMatchObject({recoveryReady:false,enrolments:[{delivery:'review',deliveryDiagnostic:{code:'delivery_disabled'}}]});
 expect(mock.rows.mock.calls.some(([,sql])=>String(sql).includes('mailbox_connections'))).toBe(false);expect(mock.ready).toHaveBeenCalledWith(actor);expect(mock.mailbox).not.toHaveBeenCalled();expect(mock.grant).not.toHaveBeenCalled();
});
