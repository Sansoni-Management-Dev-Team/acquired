import { beforeEach, describe, expect, it, vi } from "vitest";
import { campaignDefinition } from "@/domain/campaign";

const mocks = vi.hoisted(() => ({ query: vi.fn(), rows: vi.fn(), withCampaignDb: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mocks.rows, withCampaignDb: mocks.withCampaignDb }));
import { ensureDefaultCampaign } from "./default-campaign-service";

const actor = { organizationId: "org", userId: "user" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.withCampaignDb.mockImplementation(async (_actor, callback) => callback({ query: mocks.query }));
});

describe("default campaign", () => {
  it("saves seven emails with valid waits as an unpublished draft for the current owner", async () => {
    mocks.rows.mockResolvedValue([]);
    await ensureDefaultCampaign(actor, "mandate");
    expect(mocks.withCampaignDb).toHaveBeenCalledWith(actor, expect.any(Function));
    const [sql, values] = mocks.query.mock.calls[1];
    expect(sql).toContain("INSERT INTO campaign_sequences");
    expect(sql).not.toContain("published_version");
    expect(values.slice(0, 4)).toEqual(["org", "user", "mandate", "7-step introduction sequence"]);
    const definition = campaignDefinition.parse(JSON.parse(values[4]));
    expect(definition.steps.filter(step => step.kind === "email")).toHaveLength(7);
    expect(definition.steps.filter(step => step.kind === "wait")).toHaveLength(6);
    expect(mocks.query.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.rows.mock.invocationCallOrder[0]);
  });

  it("leaves existing sequences alone on subsequent visits", async () => {
    mocks.rows.mockResolvedValue([{ id: "existing" }]);
    await ensureDefaultCampaign(actor, "mandate");
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.rows).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("owner_user_id = $2"), ["org", "user", "mandate"]);
  });
});
