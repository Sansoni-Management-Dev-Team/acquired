import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, generate: vi.fn(), audit: vi.fn(), conflictAt: 0, transactions: 0, organization: "synthetic-org" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "synthetic-owner" }, session: { activeOrganizationId: m.organization } }) } } }));
vi.mock("@/db/client", () => ({ requireDb: () => database }));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class {
        async getMandate() { return { id: ids.mandate, brief: {} }; }
        async memberships() { return [{ target: { id: ids.target }, assessment: { stage: "shortlisted", evidence: [] }, accreditations: [] }]; }
    } }));
vi.mock("@/adapters/outreach-drafting", () => ({ createOutreachDraftingProvider: () => ({ generateSequence: m.generate, mode: "fixture", providerName: "synthetic" }) }));
vi.mock("@/db/repositories", () => ({ OrganizationRepository: class {
        appendAudit = m.audit;
    } }));
import { contacts, messages, organization, sequenceEnrolments, targets } from "@/db/schema";
import { POST } from "./route";
import { writeOutreachMetadata } from "@/domain/outreach";
const ids = { mandate: "00000000-0000-4000-8000-000000000001", target: "00000000-0000-4000-8000-000000000002", contact: "00000000-0000-4000-8000-000000000003", enrolment: "00000000-0000-4000-8000-000000000004" };
const profile = { senderName: "Synthetic Buyer", about: "Synthetic independently reviewed outreach profile.", signature: "Synthetic Buyer" };
const generated = [1, 2].map(step => ({ step, subject: `Generated ${step}`, body: `Generated synthetic body ${step}`, channels: { email: { body: "Synthetic" }, linkedin: { body: "Synthetic" }, whatsapp: { body: "Synthetic" } }, signalIds: [], scheduledFor: new Date(), approved: false }));
const dialect = new PgDialect();
const database = {
    select(fields?: Record<string, unknown>) {
        let table: unknown;
        let condition: SQL | undefined;
        function values() {
            if (table === targets)
                return [{ id: ids.target, companyName: "Synthetic Company", firmographics: {} }];
            if (table === contacts)
                return [{ id: ids.contact, displayName: "Synthetic Person", fictionalised: false, personalData: { email: "synthetic@example.test" } }];
            if (table === organization)
                return [{ metadata: JSON.stringify({ buyerProfile: profile }) }];
            if (table === sequenceEnrolments)
                return [{ id: ids.enrolment, sequenceId: ids.enrolment }];
            if (table !== messages)
                return [];
            const query = condition && dialect.sqlToQuery(condition);
            const step = query?.sql.includes('"step_number"') ? query.params.find(p => typeof p === "number") : undefined;
            return m.rows.filter(row => step === undefined || row.stepNumber === step).map(row => fields ? Object.fromEntries(Object.keys(fields).map(key => [key, structuredClone(row[key])])) : structuredClone(row));
        }
        const chain = { from(value: unknown) { table = value; return chain; }, where(value: SQL) { condition = value; return chain; }, limit: async () => values(), then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(values()).then(resolve); } };
        return chain;
    },
    update(table: unknown) {
        let values: Record<string, unknown> = {};
        let condition: SQL;
        const perform = () => {
            if (table !== messages)
                throw Error("Unexpected mutation in this fixture");
            const query = dialect.sqlToQuery(condition);
            const row = m.rows.find(r => query.params.includes(r.id));
            if (!row)
                return [];
            if (m.conflictAt === row.stepNumber)
                return [];
            const cas = query.sql.includes('"updated_at"') && query.sql.includes('"state"') && query.sql.includes('"organization_id"');
            if (cas && (!query.params.includes(row.contentRevision) || !query.params.includes(row.state) || !query.params.includes(row.organizationId)))
                return [];
            Object.assign(row, values, { contentRevision: "2026-10-14 00:00:00.001+00" });
            return [{ id: row.id }];
        };
        const chain = { set(v: Record<string, unknown>) { values = v; return chain; }, where(v: SQL) { condition = v; return chain; }, returning: async () => perform(), then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(perform()).then(resolve); } };
        return chain;
    },
    async transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
        m.transactions++;
        const snapshot = structuredClone(m.rows);
        try {
            return await work(database);
        }
        catch (error) {
            m.rows = snapshot;
            throw error;
        }
    },
};
beforeEach(() => {
    m.audit.mockReset();
    m.generate.mockReset();
    m.conflictAt = 0;
    m.transactions = 0;
    m.rows = [1, 2].map(stepNumber => ({ id: `synthetic-message-${stepNumber}`, organizationId: m.organization, enrolmentId: ids.enrolment, stepNumber, state: "draft", subject: `Original ${stepNumber}`, body: `Original body ${stepNumber}`, providerMessageId: null, signalIds: [], contentRevision: "2026-10-14 00:00:00.000001+00" }));
    m.generate.mockResolvedValue(generated);
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("No external provider in this fixture"); }));
});
afterEach(() => vi.unstubAllGlobals());
const request = () => new Request("http://localhost/api/outreach/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mandateId: ids.mandate, targetId: ids.target, contactId: ids.contact }) });
it.each(["approved", "queued", "sent", "cancelled", "failed"])("blocks regenerating %s records even without a provider ID", async (state) => {
    m.rows[0].state = state;
    const before = structuredClone(m.rows);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(m.rows).toEqual(before);
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});
it.each(["approved", "edited"])("retains the %s revision that wins while generation is pending", async (change) => {
    m.generate.mockImplementation(async () => { m.rows[0].state = change === "approved" ? "approved" : "draft"; m.rows[0].body = "Concurrent saved content"; m.rows[0].contentRevision = "2026-10-14 00:00:00.000002+00"; return generated; });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(m.rows[0].body).toBe("Concurrent saved content");
    expect(m.rows[0].state).toBe(change === "approved" ? "approved" : "draft");
    expect(m.rows[1].body).toBe("Original body 2");
    expect(m.audit).not.toHaveBeenCalled();
});
it("rolls back earlier rewrites when a later row fails its revision fence", async () => {
    m.conflictAt = 2;
    const before = structuredClone(m.rows);
    expect((await POST(request())).status).toBe(409);
    expect(m.rows).toEqual(before);
    expect(m.audit).not.toHaveBeenCalled();
});
it("can regenerate unchanged local drafts without changing historical provider fields", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(m.rows.map(row => row.subject)).toEqual(["Generated 1", "Generated 2"]);
    expect(m.rows.every(row => row.providerMessageId === null && row.state === "draft")).toBe(true);
    expect(m.transactions).toBe(1);
    expect(m.audit).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
});
it("can reuse a complete historical sequence without generation or writes", async () => {
    const original = m.rows[0];
    m.rows = Array.from({ length: 7 }, (_, i) => ({ ...original, id: `historical-${i + 1}`, stepNumber: i + 1, state: "sent", providerMessageId: `historical-provider-${i + 1}`, signalIds: writeOutreachMetadata([], { linkedin: { body: "Historical LinkedIn copy" }, whatsapp: { body: "Historical WhatsApp copy" } }) }));
    const before = structuredClone(m.rows);
    const response = await POST(new Request("http://localhost/api/outreach/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mandateId: ids.mandate, targetId: ids.target, contactId: ids.contact, reuseExisting: true }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reused: true, messageCount: 7 });
    expect(m.rows).toEqual(before);
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.transactions).toBe(0);
    expect(m.audit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});
it("rolls back saved content when the transactional audit cannot be written", async () => {
    m.audit.mockRejectedValueOnce(Error("Synthetic private audit detail"));
    const before = structuredClone(m.rows);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
    expect(m.rows).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
});
