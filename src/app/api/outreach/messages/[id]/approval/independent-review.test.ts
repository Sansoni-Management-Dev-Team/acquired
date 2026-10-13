import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const review = vi.hoisted(() => ({ state: "draft", writes: [] as unknown[], audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "synthetic-owner" }, session: { activeOrganizationId: "synthetic-org" } }) } } }));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class { async getMandate() { return { id: "synthetic-mandate" }; } async memberships() { return [{ target: { id: "synthetic-target" }, assessment: { stage: "shortlisted" } }]; } } }));
vi.mock("@/domain/buyer-profile", () => ({ buyerProfileFromMetadata: () => ({ senderName: "Synthetic Buyer" }) }));
vi.mock("@/db/repositories", () => ({ OrganizationRepository: class { appendAudit = review.audit; } }));
vi.mock("@/db/client", () => ({ requireDb: () => database }));
import { contacts, messages, organization, sequenceEnrolments } from "@/db/schema";
import { POST } from "./route";
const database = {
    select(fields?: object) {
        let table: unknown;
        function rows() {
            if (table === messages) return fields && Object.keys(fields).length === 1 ? [{ state: review.state }] : [{ id: "synthetic-message", organizationId: "synthetic-org", enrolmentId: "synthetic-enrolment", state: review.state, providerMessageId: "historical-provider-message", updatedAt: new Date("2026-10-13T00:00:00Z"), contentRevision: "2026-10-13 00:00:00.000001+00" }];
            if (table === sequenceEnrolments) return [{ id: "synthetic-enrolment", mandateId: "synthetic-mandate", targetId: "synthetic-target", contactId: "synthetic-contact" }];
            if (table === contacts) return [{ fictionalised: false, personalData: { email: "synthetic@example.test" } }];
            if (table === organization) return [{ metadata: "{}" }];
            return [];
        }
        const chain = { from(value: unknown) { table = value; return chain; }, where() { return chain; }, limit: async () => rows(), then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(rows()).then(resolve); } };
        return chain;
    },
    update(table: unknown) {
        const chain = { set(values: unknown) { review.writes.push({ table, values }); return chain; }, where() { return chain; }, returning: async () => [{ id: "synthetic-message" }], then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve([]).then(resolve); } };
        return chain;
    },
};
beforeEach(() => { review.writes = []; review.audit.mockReset(); vi.stubGlobal("fetch", vi.fn(() => { throw Error("No provider access in this review"); })); });
afterEach(() => vi.unstubAllGlobals());
for (const state of ["queued", "sent", "cancelled", "failed"]) {
    it.each([true, false])(`does not rewrite historical ${state} state through approval=%s`, async approved => {
        review.state = state;
        const response = await POST(new Request("http://localhost/api/outreach/messages/synthetic-message/approval", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ approved }) }), { params: Promise.resolve({ id: "synthetic-message" }) });
        expect(response.status).toBe(409);
        expect(review.writes).toHaveLength(0);
        expect(review.audit).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });
}
