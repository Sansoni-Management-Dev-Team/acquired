import { describe, expect, it, vi } from "vitest";
import { FirmableClient, FirmableError } from "./firmable-client";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("FirmableClient", () => {
  it("uses one identifier and always requests AU", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input; void _init;
      return response({ id: "firm-1", revenue: "$10m-$20m" });
    });
    const result = await new FirmableClient({ apiKey: "test", fetch: fetcher }).enrichCompany({ abn: "12 345 678 901", fqdn: "ignored.example" });
    expect(result.id).toBe("firm-1");
    expect(String(fetcher.mock.calls[0][0])).toContain("country=AU&abn=12345678901");
    expect(String(fetcher.mock.calls[0][0])).not.toContain("fqdn");
  });

  it("retries transient failures but not bad requests", async () => {
    const retrying = vi.fn().mockResolvedValueOnce(response({}, 500)).mockResolvedValue(response({ id: "ok" }));
    await new FirmableClient({ apiKey: "test", fetch: retrying, retries: 1 }).enrichCompany({ id: "x" });
    expect(retrying).toHaveBeenCalledTimes(2);
    const bad = vi.fn(async () => response({}, 400));
    await expect(new FirmableClient({ apiKey: "test", fetch: bad }).enrichCompany({ id: "x" })).rejects.toBeInstanceOf(FirmableError);
    expect(bad).toHaveBeenCalledOnce();
  });

  it("deduplicates people and fictionalises revealed personal data", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([{ person_id: "p1", position: "Owner" }, { person_id: "p1", position: "Owner" }]))
      .mockResolvedValueOnce(response({ id: "p1", full_name: "Real Name", work_email: "real@company.com", phones: [{ number: "0400111222", is_dnd: true }] }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher, fictionalise: true });
    expect(await client.searchPeople("c1")).toHaveLength(1);
    const person = await client.enrichPerson({ id: "p1" });
    expect(person.email).toMatch(/example\.invalid$/);
    expect(person.doNotContact).toBe(true);
    expect(JSON.stringify(person)).not.toContain("Real Name");
  });
});
