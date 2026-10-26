import { beforeEach, expect, it, vi } from "vitest";
import { emptyBrief } from "@/domain/acquisition";
const mocks = vi.hoisted(() => ({ session: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/adapters/mandate-generation", () => ({ generateMandate: mocks.generate }));
import { POST } from "./route";
const request = () => new Request("http://localhost/api/mandates/generate", { method: "POST", body: JSON.stringify({ description: "Commercial service businesses in Victoria" }) });
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ session: { activeOrganizationId: "org-a" } }); });
it("requires an authenticated organisation before invoking AI", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("returns the generated draft", async () => {
  mocks.generate.mockResolvedValue(emptyBrief());
  expect(await (await POST(request())).json()).toEqual({ brief: emptyBrief() });
  expect(mocks.generate).toHaveBeenCalledWith("Commercial service businesses in Victoria");
});
it("returns a retryable error without exposing provider internals", async () => {
  mocks.generate.mockRejectedValue(new Error("provider details"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect((await response.json()).error).not.toContain("provider details");
});
it('coalesces repeated generation for one owned request and refuses changed descriptions',async()=>{
 const id='30000000-0000-4000-8000-000000000003';mocks.session.mockResolvedValue({session:{activeOrganizationId:'org-a'},user:{id:'user-a'}});mocks.generate.mockResolvedValue(emptyBrief());
 const input=(description='Commercial service businesses in Victoria')=>new Request('http://localhost/api/mandates/generate',{method:'POST',body:JSON.stringify({description,requestId:id})});
 expect((await POST(input())).status).toBe(200);expect((await POST(input())).status).toBe(200);expect(mocks.generate).toHaveBeenCalledOnce();
 expect((await POST(input('Commercial maintenance companies in Queensland'))).status).toBe(409);expect(mocks.generate).toHaveBeenCalledOnce();
 mocks.session.mockResolvedValue({session:{activeOrganizationId:'org-a'},user:{id:'user-b'}});expect((await POST(input())).status).toBe(200);expect(mocks.generate).toHaveBeenCalledTimes(2);
});
