import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({ session: { user: { id: 'owner' }, session: { activeOrganizationId: 'org' } } as unknown, message: null as unknown, updated: [] as Array<{ table: unknown; values: Record<string, unknown> }>, audit: vi.fn(), raced: false, contactAllowed: true }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn(async () => mock.session) } } }));
vi.mock('@/db/acquisition-repository', () => ({ AcquisitionRepository: class { async getMandate() { return { id: 'mandate' }; } async memberships() { return [{ target: { id: 'target' }, assessment: { stage: 'shortlisted' } }]; } } }));
vi.mock('@/domain/buyer-profile', () => ({ buyerProfileFromMetadata: () => ({ senderName: 'Synthetic sender' }) }));
vi.mock('@/db/repositories', () => ({ OrganizationRepository: class { appendAudit = mock.audit; } }));
vi.mock('@/db/client', () => ({ requireDb: () => database }));
import { contacts, mailboxConnections, messages, sequenceEnrolments, organization } from '@/db/schema';
import { POST } from './route';
import { PATCH } from '../route';
const selected: unknown[] = [];
const database = {
  select(fields?: unknown) {
    let table: unknown;
    const chain = { from(value: unknown) { table = value; selected.push(value); return chain; }, where() { return chain; }, limit: async () => rows(), then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(rows()).then(resolve); } };
    function rows(): unknown[] {
      if (table === messages) return fields && Object.keys(fields).length === 1 ? [{ state: 'approved' }] : mock.message ? [mock.message] : [];
      if (table === sequenceEnrolments) return [{ id: 'enrolment', mandateId: 'mandate', contactId: 'contact', targetId: 'target' }];
      if (table === organization) return [{ metadata: '{}' }];
      if (table === contacts) return [{ fictionalised: false, personalData: { email: 'person@example.invalid', doNotContact: !mock.contactAllowed } }];
      return [];
    }
    return chain;
  },
  update(table: unknown) {
    const chain = { set(values: Record<string, unknown>) { mock.updated.push({ table, values }); return chain; }, where() { return chain; }, returning: async () => mock.raced ? [] : [{ id: 'message' }], then(resolve: (value: unknown[]) => unknown) { return Promise.resolve([]).then(resolve); } };
    return chain;
  },
};
beforeEach(() => { mock.updated = []; mock.audit.mockReset(); mock.session = { user: { id: 'owner' }, session: { activeOrganizationId: 'org' } }; mock.message = { id: 'message', organizationId: 'org', enrolmentId: 'enrolment', subject: 'Synthetic subject', body: 'Synthetic body', state: 'draft', providerMessageId: null, providerThreadId: null, updatedAt: new Date('2026-10-13T00:00:00Z'), contentRevision: '2026-10-13 00:00:00.000001+00' }; mock.raced = false; mock.contactAllowed = true; selected.length = 0; vi.stubGlobal('fetch', vi.fn(() => { throw Error('Provider access is forbidden during draft approval'); })); });
afterEach(() => vi.unstubAllGlobals());
const request = (approved: boolean) => new Request('http://localhost/api/outreach/messages/message/approval', { method: 'POST', body: JSON.stringify({ approved }), headers: { 'Content-Type': 'application/json' } });
const context = { params: Promise.resolve({ id: 'message' }) };
it('approves the saved application draft without a mailbox or provider operation', async () => {
  const response = await POST(request(true), context);
  expect(response.status).toBe(200); expect(selected).not.toContain(mailboxConnections);
  expect(mock.updated.find(v => v.table === messages)?.values).toMatchObject({ state: 'approved', approvedBy: 'owner' });
  expect(mock.audit).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});
it('rejects a concurrent edit before changing enrolment or audit state', async () => {
  mock.raced = true;
  const response = await POST(request(true), context);
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: expect.stringContaining('changed') }); expect(mock.updated.filter(v => v.table === sequenceEnrolments)).toHaveLength(0); expect(mock.audit).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('revokes local approval while retaining historical provider identifiers without deleting a Gmail draft', async () => {
  mock.message = { ...(mock.message as object), state: 'approved', providerMessageId: 'historical-draft', providerThreadId: 'historical-thread' };
  const response = await POST(request(false), context);
  expect(response.status).toBe(200); expect(selected).not.toContain(mailboxConnections);
  const update = mock.updated.find(v => v.table === messages)?.values;
  expect(update).toMatchObject({ state: 'draft', approvedBy: null, approvedAt: null }); expect(update).not.toHaveProperty('providerMessageId'); expect(update).not.toHaveProperty('providerThreadId'); expect(fetch).not.toHaveBeenCalled();
});
it('retains suppression and authentication checks before local approval', async () => {
  mock.contactAllowed = false; expect((await POST(request(true), context)).status).toBe(409); expect(mock.updated).toHaveLength(0);
  mock.session = null; expect((await POST(request(true), context)).status).toBe(401); expect(fetch).not.toHaveBeenCalled();
});

it('cannot edit email after approval wins a concurrent update', async () => {
  mock.raced = true;
  const edit = new Request('http://localhost/api/outreach/messages/message', { method: 'PATCH', body: JSON.stringify({ subject: 'Changed subject', body: 'Changed saved application body' }), headers: { 'Content-Type': 'application/json' } });
  const response = await PATCH(edit, context);
  expect(response.status).toBe(409); expect(mock.audit).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('rejects concurrent social-copy edits rather than overwriting another saved revision', async () => {
  mock.raced = true; mock.message = { ...(mock.message as object), signalIds: [] };
  const edit = new Request('http://localhost/api/outreach/messages/message', { method: 'PATCH', body: JSON.stringify({ channel: 'linkedin', body: 'Changed saved social application body' }), headers: { 'Content-Type': 'application/json' } });
  expect((await PATCH(edit, context)).status).toBe(409); expect(mock.audit).not.toHaveBeenCalled();
});
