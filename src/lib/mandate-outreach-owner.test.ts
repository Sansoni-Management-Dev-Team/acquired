import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({rows:vi.fn()}));
vi.mock('@/db/campaign-client',()=>({rows:m.rows}));
import {mandateOutreachOwner} from './mandate-outreach-owner';
const actor={organizationId:'org',userId:'owner'},client={} as never;
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('ACQUISITION_WORKFLOW_SCHEMA_READY','true');});
afterEach(()=>vi.unstubAllEnvs());
it.each([['live-research-test','agent','research-only'],['live-research-test','workspace','research-only'],['demo','workspace','agent'],['live','agent','agent'],['live','workspace','sequences']])('derives %s/%s outreach ownership from its persisted workflow',async(preset,presentation,owner)=>{m.rows.mockResolvedValueOnce([{preset,presentation}]);expect(await mandateOutreachOwner(client,actor,'mandate')).toBe(owner);expect(m.rows).toHaveBeenCalledOnce();expect(m.rows.mock.calls[0][2]).toEqual(['mandate','org','owner']);});
it('retains historical receipt behavior when no execution exists',async()=>{m.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{agent_managed:true}]);expect(await mandateOutreachOwner(client,actor,'mandate')).toBe('agent');});
