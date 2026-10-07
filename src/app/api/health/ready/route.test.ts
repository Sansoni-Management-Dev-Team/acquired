import { beforeEach, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ requireDb: () => ({ execute }) }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_READINESS_SECRET", "operator-readiness-test-secret");
});

it("does not query the database for missing or incorrect credentials", async () => {
  for (const token of [undefined, "wrong", "operator-readiness-test-secrex"]) {
    const response = await GET(new Request("https://app.example/api/health/ready", { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(execute).not.toHaveBeenCalled();
});

it("reports readiness only after an authenticated database check", async () => {
  execute.mockResolvedValueOnce({ rows: [{ value: 1 }] });
  const response = await GET(new Request("https://app.example/api/health/ready", { headers: { Authorization: "Bearer operator-readiness-test-secret" } }));
  expect(response.status).toBe(200);
  expect(execute).toHaveBeenCalledOnce();
});

it("does not expose database errors", async () => {
  execute.mockRejectedValueOnce(new Error("database credential details"));
  const response = await GET(new Request("https://app.example/api/health/ready", { headers: { Authorization: "Bearer operator-readiness-test-secret" } }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
});
