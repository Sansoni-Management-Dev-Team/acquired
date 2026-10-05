import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), provision: vi.fn(), remove: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, callback: (client: unknown) => unknown) => callback({ query: mock.query }), withCampaignWorker: vi.fn() }));
vi.mock("@/lib/campaign-n8n", () => ({ n8nCampaignEnabled: () => true, provisionSequenceWorkflow: mock.provision, removeSequenceWorkflow: mock.remove }));
import { publishCampaign, saveCampaign, createCampaign } from "./campaign-service";
const actor = { organizationId: "org", userId: "owner" }; const id = randomUUID();
const definition = { schemaVersion: 1, steps: [{ id: randomUUID(), kind: "email", title: "First", subject: "Hi", body: "Hello" }] };
const version = { id, name: "Sequence", draft: definition, published_version: 1, updated_at: new Date("2026-10-06T01:00:00Z") };
beforeEach(() => { vi.resetAllMocks(); mock.query.mockResolvedValue({ rows: [], rowCount: 1 }); mock.provision.mockResolvedValue("workflow"); mock.remove.mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllEnvs());
it.each(["edit", "publish", "delete"])("cleans up provisioning when concurrent %s invalidates the snapshot", async conflict => {
  mock.rows.mockResolvedValueOnce([version]).mockResolvedValueOnce(conflict === "delete" ? [] : [{ ...version, ...(conflict === "edit" ? { updated_at: new Date(version.updated_at.getTime() + 1) } : { published_version: 2 }) }]);
  await expect(publishCampaign(actor, id)).rejects.toThrow(conflict === "delete" ? "not found" : "changed during publishing"); expect(mock.provision).toHaveBeenCalledOnce(); expect(mock.remove).toHaveBeenCalledWith("workflow"); expect(mock.query).not.toHaveBeenCalled();
});
it("persists exactly the prepared immutable version and owner scope", async () => {
  mock.rows.mockResolvedValueOnce([version]).mockResolvedValueOnce([version]).mockResolvedValueOnce([{ id: "new-version", version: 2, n8n_workflow_id: "workflow" }]);
  expect(await publishCampaign(actor, id)).toMatchObject({ id: "new-version", version: 2, n8nWorkflowId: "workflow" });
  expect(mock.rows.mock.calls[2][2]).toEqual([expect.any(String), "org", "owner", id, 2, JSON.stringify(definition), "workflow"]); expect(mock.remove).not.toHaveBeenCalled();
});
it("preserves a transaction failure when cleanup also fails", async () => { mock.rows.mockResolvedValueOnce([version]).mockRejectedValueOnce(new Error("database failed")); mock.remove.mockRejectedValue(new Error("cleanup failed")); await expect(publishCampaign(actor, id)).rejects.toThrow("database failed"); expect(mock.remove).toHaveBeenCalledOnce(); });
it("invalid stored definition cannot create a workflow", async () => { mock.rows.mockResolvedValueOnce([{ ...version, draft: { schemaVersion: 1, steps: [] } }]); await expect(publishCampaign(actor, id)).rejects.toThrow(); expect(mock.provision).not.toHaveBeenCalled(); });
it("missing sequence cannot be published or saved by another owner", async () => { mock.rows.mockResolvedValue([]); await expect(publishCampaign(actor, id)).rejects.toMatchObject({ status: 404 }); await expect(saveCampaign(actor, id, "Changed", definition as never)).rejects.toMatchObject({ status: 404 }); expect(mock.rows.mock.calls.every(([, sql, params]) => sql.includes("owner_user_id") && params.includes(actor.userId))).toBe(true); expect(mock.provision).not.toHaveBeenCalled(); });
it("a mandate outside the organisation cannot receive a sequence", async () => { mock.rows.mockResolvedValue([]); await expect(createCampaign(actor, id, "Test", definition as never)).rejects.toMatchObject({ status: 404 }); expect(mock.rows).toHaveBeenCalledOnce(); expect(mock.rows.mock.calls[0][2]).toEqual([id, actor.organizationId]); });
