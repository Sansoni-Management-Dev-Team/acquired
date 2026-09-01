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

  it("does not retry Firmable's 500 company-not-found response", async () => {
    const fetcher = vi.fn(async () => response({ error: "Company profile not found" }, 500));
    await expect(new FirmableClient({ apiKey: "test", fetch: fetcher, retries: 2 }).enrichCompany({ fqdn: "missing.example" })).rejects.toMatchObject({ message: "Firmable company profile not found" });
    expect(fetcher).toHaveBeenCalledOnce();
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

  it("maps email, phone, and DND status from Firmable's live person envelope", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({
      id: "p1",
      name: "Example Owner",
      position: "Managing Director",
      emails: { work: [{ value: "owner@example.test" }] },
      phones: [{ value: "+61400000000", is_dnd: true }],
    }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher, fictionalise: false });

    await expect(client.enrichPerson({ id: "p1" })).resolves.toEqual(expect.objectContaining({
      id: "p1",
      name: "Example Owner",
      email: "owner@example.test",
      phone: "+61400000000",
      emailAvailable: true,
      phoneAvailable: true,
      fictionalised: false,
      doNotContact: true,
    }));
  });

  it("parses Firmable's live records envelope and availability fields", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({
      records: [{ person_id: "p1", position: "Owner", has_email: true, has_phone: false }],
      success: true,
      total: 1,
    }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    await expect(client.searchPeople("c1")).resolves.toEqual([
      expect.objectContaining({ id: "p1", position: "Owner", emailAvailable: true, phoneAvailable: false }),
    ]);
  });

  it("rejects Firmable's HTTP 200 unsuccessful people-search response", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ success: false, totalPeople: 0 }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    await expect(client.searchPeople("c1", { seniority: "2" })).rejects.toMatchObject({
      endpoint: "/people/search",
      status: 200,
    });
  });

  it("uses one bounded unfiltered search and ranks decision-maker titles locally", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ records: [
      { person_id: "p0", position: "Software Engineer" },
      { person_id: "p4", position: "General Manager" },
      { person_id: "p3", position: "Chief Executive Officer" },
      { person_id: "p1", position: "Owner and Managing Director" },
      { person_id: "p5", position: "Operations Manager" },
      { person_id: "p2", position: "Board Director" },
    ], success: true, total: 6 }));
    const attempts: Array<{ label: string; returnedCount: number; addedCount: number }> = [];
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    const candidates = await client.searchDecisionMakers("c1", {
      max: 3,
      onAttempt: (attempt) => attempts.push(attempt),
    });

    expect(candidates.map(({ id }) => id)).toEqual(["p1", "p2", "p3"]);
    expect(attempts).toEqual([{ label: "Company people ranked locally", returnedCount: 6, addedCount: 3 }]);
    expect(fetcher).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(requestBody).toEqual(expect.objectContaining({ companyId: "c1", selectedCountry: "AU", from: "0", size: "50" }));
    expect(requestBody).not.toHaveProperty("seniority");
    expect(requestBody).not.toHaveProperty("department");
  });
});
