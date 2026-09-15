import { beforeEach, expect, it, vi } from "vitest";
import { emptyBrief } from "@/domain/acquisition";
const mocks = vi.hoisted(() => ({ session: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/adapters/mandate-generation", () => ({ generateMandate: mocks.generate }));
import { POST } from "./route";
const request = () => new Request("http://localhost/api/mandates/generate", { method: "POST" });
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ session: { activeOrganizationId: "org-a" } }); });
it("requires an authenticated organisation before invoking AI", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("returns the generated draft", async () => {
  mocks.generate.mockResolvedValue(emptyBrief());
  expect(await (await POST(request())).json()).toEqual({ brief: emptyBrief() });
});
it("returns a retryable error without exposing provider internals", async () => {
  mocks.generate.mockRejectedValue(new Error("provider details"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect((await response.json()).error).not.toContain("provider details");
});
