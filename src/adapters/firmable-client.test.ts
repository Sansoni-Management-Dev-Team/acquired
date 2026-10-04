import { describe, expect, it, vi } from "vitest";
import { FirmableClient, FirmableError } from "./firmable-client";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("FirmableClient", () => {
  it("uses one identifier and always requests AU", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input; void _init;
      return response({ id: "firm-1", revenue: "$10m-$20m", provider_only_field: { nested: true } });
    });
    const result = await new FirmableClient({ apiKey: "test", fetch: fetcher }).enrichCompany({ abn: "12 345 678 901", fqdn: "ignored.example" });
    expect(result.id).toBe("firm-1");
    expect(result.provider_only_field).toEqual({ nested: true });
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

  it("records every HTTP attempt without exposing authorization headers", async () => {
    const observations: import("./firmable-client").FirmableHttpObservation[] = [];
    const fetcher = vi.fn().mockResolvedValueOnce(response({ error: "temporary" }, 500)).mockResolvedValueOnce(response({ id: "firm-1" }));
    const client = new FirmableClient({ apiKey: "secret-test-key", fetch: fetcher, retries: 1, onObservation: observation => { observations.push(observation); } });

    await client.enrichCompany({ fqdn: "example.com" });

    expect(observations).toHaveLength(2);
    expect(observations.map(item => item.attempt)).toEqual([1, 2]);
    expect(new Set(observations.map(item => item.logicalCallId)).size).toBe(1);
    expect(observations[1]).toEqual(expect.objectContaining({ endpoint: "/company", method: "GET", httpStatus: 200, response: { id: "firm-1" } }));
    expect(JSON.stringify(observations)).not.toContain("secret-test-key");
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

  it("rejects a successful HTTP person response that has no person ID", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ name: "Unidentified person" }));
    await expect(new FirmableClient({ apiKey: "test", fetch: fetcher }).enrichPerson({ id: "requested-person" })).rejects.toThrow();
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

  it("paginates through every Firmable people-search result", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ person_id: `p${index}` }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ records: firstPage, success: true, total: 101 }))
      .mockResolvedValueOnce(response({ records: [{ person_id: "p100" }], success: true, total: 101 }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    const people = await client.searchAllPeople("c1");

    expect(people).toHaveLength(101);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({ from: "0", size: "100" }));
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(expect.objectContaining({ from: "100", size: "100" }));
  });

  it("exposes one people page for durable workflow checkpoints", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ records: [{ person_id: "p100", position: "Director" }], success: true, total: 101 }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    await expect(client.searchPeoplePage("c1", { from: 100, max: 100 })).resolves.toEqual({
      records: [expect.objectContaining({ id: "p100", position: "Director" })],
      total: 101,
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({ from: "100", size: "100" }));
  });

  it("does not claim a complete people search when pagination repeats a page", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ person_id: `p${index}` }));
    const fetcher = vi.fn(async () => response({ records: page, success: true, total: 200 }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    await expect(client.searchAllPeople("c1")).rejects.toMatchObject({ message: "Firmable people pagination did not advance" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not reconcile an incomplete final page whose reported total has not been reached", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ records: [{ person_id: "p1" }], success: true, total: 2 }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    await expect(client.searchAllPeople("c1")).rejects.toMatchObject({ message: "Firmable people search ended before its reported total" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("only retains the complete person response when real personal data is enabled", async () => {
    const body = { id: "p1", full_name: "Example Owner", work_email: "owner@example.test", linkedin_url: "https://www.linkedin.com/in/example-owner", extra_provider_field: { value: true } };
    const live = new FirmableClient({ apiKey: "test", fetch: vi.fn(async () => response(body)), fictionalise: false });
    const fictional = new FirmableClient({ apiKey: "test", fetch: vi.fn(async () => response(body)), fictionalise: true });

    await expect(live.enrichPerson({ id: "p1" })).resolves.toEqual(expect.objectContaining({ rawResponse: body, linkedinUrl: body.linkedin_url }));
    const protectedPerson = await fictional.enrichPerson({ id: "p1" });
    expect(protectedPerson.rawResponse).toBeUndefined();
    expect(protectedPerson.linkedinUrl).toBeUndefined();
  });

  it("treats Firmable's zero-people response as a complete empty search", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ success: false, totalPeople: 0 }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    await expect(client.searchPeoplePage("c1", { seniority: "2" })).resolves.toEqual({ records: [], total: 0 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("still rejects an unsuccessful people search that is not a confirmed empty result", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ success: false, totalPeople: 2 }));
    const client = new FirmableClient({ apiKey: "test", fetch: fetcher });

    await expect(client.searchPeople("c1")).rejects.toMatchObject({
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
it('uses the cloud service without retrying its shared cooldown', async () => {
  vi.stubEnv('FIRMABLE_TRANSPORT', 'cloudflare-session');
  vi.stubEnv('FIRMABLE_SERVICE_URL', 'https://worker.example/firmable');
  vi.stubEnv('FIRMABLE_SERVICE_SECRET', 'service-secret');
  try {
    const fetcher = vi.fn(async (_input: string | URL | Request) => { void _input; return response({ category: 'rate_limited' }, 429); });
    await expect(new FirmableClient({ fetch: fetcher }).enrichCompany({ fqdn: 'raymax.com.au', name: 'Raymax' })).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://worker.example/firmable/company?country=AU&fqdn=raymax.com.au&name=Raymax');
  } finally { vi.unstubAllEnvs(); }
});
it('keeps discovery people retrieval email-only even when a provider returns a phone', async () => {
 const fetcher = vi.fn(async(input: RequestInfo | URL)=>{void input;return Response.json({id:'fp123',full_name:'Example Person',emails:{work:[{value:'person@example.com'}]},phones:[{value:'0412345678'}]});});
 const client = new FirmableClient({apiKey:'test',fetch:fetcher,fictionalise:false});
 const person = await client.enrichPerson({id:'fp123'},{includePhones:false});
 expect(person.email).toBe('person@example.com');expect(person.phone).toBeUndefined();expect(person.phoneAvailable).toBe(false);
 expect(String(fetcher.mock.calls[0][0])).toContain('includePhones=false');
});
