import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), organizations: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session, listOrganizations: mocks.organizations } } }));
vi.mock("@/components/organization-form", () => ({ OrganizationForm: () => null }));
import OnboardingPage from "./page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ session: { activeOrganizationId: "org-a" } });
  mocks.organizations.mockResolvedValue([{ id: "org-a" }]);
});

describe("onboarding access", () => {
  it("requires sign-in when a cookie no longer has a valid session", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(OnboardingPage()).rejects.toThrow("redirect:/sign-in");
    expect(mocks.organizations).not.toHaveBeenCalled();
  });

  it("takes an existing active member into the app", async () => {
    await expect(OnboardingPage()).rejects.toThrow("redirect:/targets");
  });

  it.each([null, "removed-org"])("activates an existing workspace when the active workspace is %s", async activeOrganizationId => {
    mocks.session.mockResolvedValue({ session: { activeOrganizationId } });
    await expect(OnboardingPage()).rejects.toThrow("redirect:/auth/complete");
  });

  it("shows creation only for an account without memberships", async () => {
    mocks.organizations.mockResolvedValue([]);
    await expect(OnboardingPage()).resolves.toBeTruthy();
  });

  it("does not show creation when loading memberships fails", async () => {
    mocks.organizations.mockRejectedValue(new Error("Database unavailable"));
    await expect(OnboardingPage()).rejects.toThrow("Database unavailable");
  });
});
