import { describe, expect, it, vi } from "vitest";
import { FreeOpenRouter, FREE_RESEARCH_MODELS } from "./free-openrouter";
import { peopleExtractionSchema } from "../../domain/people-research";

const request = {
  messages: [{ role: "user", content: "Use only supplied public source text" }], max_tokens: 300,
  response_format: { type: "json_schema", json_schema: {
    type: "object", properties: { value: { type: ["string", "null"] }, quote: { type: ["string", "null"] } },
    required: ["value", "quote"], additionalProperties: false,
  } },
};
const completion = (value: unknown, extra = {}) => Response.json({ model: FREE_RESEARCH_MODELS[1], choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { cost: 0 }, ...extra });

describe("free research OpenRouter service", () => {
  it("delegates an ordered free-only waterfall in one request and records the actual answering model", async () => {
    const fetcher = vi.fn().mockResolvedValue(completion({ value: null, quote: null }));
    const onRequest = vi.fn(), onUsage = vi.fn();
    const result = await new FreeOpenRouter({ apiKey: "secret", fetch: fetcher, onRequest, onUsage }).complete(request);
    expect(result.response).toEqual({ value: null, quote: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ models: [...FREE_RESEARCH_MODELS], provider: { max_price: { prompt: 0, completion: 0 }, require_parameters: true, data_collection: "deny" } });
    expect(JSON.parse(init.body).plugins).toBeUndefined();
    expect(JSON.parse(init.body).reasoning.effort).toBe("medium");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ model: FREE_RESEARCH_MODELS[1], cost: 0 }));
  });

  it.each([["openrouter/free"], ["paid/model"], ["unreviewed/model:free"], []])("rejects unapproved routing %j", (...models) => {
    expect(() => new FreeOpenRouter({ apiKey: "secret", models: models as string[] })).toThrow(/approved free/);
  });

  it.each([401, 402, 404, 429, 503])("stops after routing failure %s without another request or leaking the provider body", async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { message: "sensitive-provider-body" } }, { status, headers: { "retry-after": "60" } }));
    const ai = new FreeOpenRouter({ apiKey: "secret", fetch: fetcher });
    await expect(ai.complete(request)).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{ value: 15, quote: "18 staff" }, { value: "18" }, { value: "18", quote: "18 staff", invented: true }])("rejects structurally invalid evidence %j", async value => {
    const ai = new FreeOpenRouter({ apiKey: "secret", fetch: vi.fn().mockResolvedValue(completion(value)) });
    await expect(ai.complete(request)).rejects.toThrow(/schema/);
  });

  it("validates the production people schema, including optional email", async () => {
    const finding = { kind: "person", name: "Jordan Example", value: "Director", quote: "Jordan Example, Director", website: "https://example.com", relevance: "unclear" };
    const ai = new FreeOpenRouter({ apiKey: "secret", fetch: vi.fn().mockResolvedValue(completion({ findings: [finding] })) });
    expect((await ai.complete({ ...request, response_format: { type: "json_schema", json_schema: peopleExtractionSchema } })).response).toEqual({ findings: [finding] });
  });

  it.each([
    { choices: [{ finish_reason: "length", message: { content: '{"value":null,"quote":null}' } }] },
    { choices: [{ message: { content: "not-json" } }] },
    { choices: [], error: { code: 502 } },
  ])("rejects incomplete or malformed completions", async payload => {
    const ai = new FreeOpenRouter({ apiKey: "secret", fetch: vi.fn().mockResolvedValue(Response.json(payload)) });
    await expect(ai.complete(request)).rejects.toThrow();
  });

  it("does not dispatch without a key and sanitizes transport failures", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("secret"));
    await expect(new FreeOpenRouter({ apiKey: "", fetch: fetcher }).complete(request)).rejects.toThrow(/not configured/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(new FreeOpenRouter({ apiKey: "secret", fetch: fetcher }).complete(request)).rejects.toThrow("Free research AI unavailable: request timed out or transport failed");
  });
  it("does not route reasoning-disabled requests to an incompatible fallback", async () => {
    const fetcher = vi.fn();
    const ai = new FreeOpenRouter({ apiKey: "secret", models: ["nvidia/nemotron-3-super-120b-a12b:free"], fetch: fetcher });
    await expect(ai.complete({ ...request, reasoning_effort: "none" })).rejects.toThrow(/reasoning mode/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
