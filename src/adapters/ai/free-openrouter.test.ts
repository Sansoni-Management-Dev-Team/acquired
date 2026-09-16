import { describe, expect, it, vi } from "vitest";
import { FreeOpenRouter, FREE_RESEARCH_MODELS, MERCURY_FALLBACK_MODEL, MERCURY_PRICE_CAP } from "./free-openrouter";
import { peopleExtractionSchema } from "../../domain/people-research";
import { researchExtractionRequest } from "../../domain/research-extraction-schema";

const request = {
  messages: [{ role: "user", content: "Use only supplied public source text" }], max_tokens: 300,
  response_format: { type: "json_schema", json_schema: {
    type: "object", properties: { value: { type: ["string", "null"] }, quote: { type: ["string", "null"] } },
    required: ["value", "quote"], additionalProperties: false,
  } },
};
const completion = (value: unknown, extra = {}) => Response.json({ model: FREE_RESEARCH_MODELS[1], choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { cost: 0 }, ...extra });

describe("free research OpenRouter service", () => {
  it("routes worker extraction without reasoning and records usage even if the output is truncated", async () => {
    const onUsage = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(completion({}, { choices: [{ finish_reason: "length", message: { content: "{}" } }] }));
    const ai = new FreeOpenRouter({ paidFallback: false, apiKey: "secret", fetch: fetcher, onUsage });
    await expect(ai.complete(researchExtractionRequest(request.messages))).rejects.toThrow(/output token limit/);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.reasoning.effort).toBe("none");
    expect(body.models).toEqual(FREE_RESEARCH_MODELS.filter(m => m.startsWith("nex-agi/")));
    expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ cost: 0 }));
  });
  it("delegates an ordered free-only waterfall in one request and records the actual answering model", async () => {
    const fetcher = vi.fn().mockResolvedValue(completion({ value: null, quote: null }));
    const onRequest = vi.fn(), onUsage = vi.fn();
    const result = await new FreeOpenRouter({ paidFallback: false, apiKey: "secret", fetch: fetcher, onRequest, onUsage }).complete(request);
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
    expect(() => new FreeOpenRouter({ paidFallback: false, apiKey: "secret", models: models as string[] })).toThrow(/approved free/);
  });

  it.each([401, 402, 404, 429, 503])("stops after routing failure %s without another request or leaking the provider body", async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { message: "sensitive-provider-body" } }, { status, headers: { "retry-after": "60" } }));
    const ai = new FreeOpenRouter({ paidFallback: false, apiKey: "secret", fetch: fetcher });
    await expect(ai.complete(request)).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{ value: 15, quote: "18 staff" }, { value: "18" }, { value: "18", quote: "18 staff", invented: true }])("rejects structurally invalid evidence %j", async value => {
    const ai = new FreeOpenRouter({ paidFallback: false, apiKey: "secret", fetch: vi.fn().mockResolvedValue(completion(value)) });
    await expect(ai.complete(request)).rejects.toThrow(/schema/);
  });

  it("validates the production people schema, including optional email", async () => {
    const finding = { kind: "person", name: "Jordan Example", value: "Director", quote: "Jordan Example, Director", website: "https://example.com", relevance: "unclear" };
    const ai = new FreeOpenRouter({ paidFallback: false, apiKey: "secret", fetch: vi.fn().mockResolvedValue(completion({ findings: [finding] })) });
    expect((await ai.complete({ ...request, response_format: { type: "json_schema", json_schema: peopleExtractionSchema } })).response).toEqual({ findings: [finding] });
  });

  it.each([
    { choices: [{ finish_reason: "length", message: { content: '{"value":null,"quote":null}' } }] },
    { choices: [{ message: { content: "not-json" } }] },
    { choices: [], error: { code: 502 } },
  ])("rejects incomplete or malformed completions", async payload => {
    const ai = new FreeOpenRouter({ paidFallback: false, apiKey: "secret", fetch: vi.fn().mockResolvedValue(Response.json(payload)) });
    await expect(ai.complete(request)).rejects.toThrow();
  });

  it("does not dispatch without a key and sanitizes transport failures", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("secret"));
    await expect(new FreeOpenRouter({ paidFallback: false, apiKey: "", fetch: fetcher }).complete(request)).rejects.toThrow(/not configured/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(new FreeOpenRouter({ paidFallback: false, apiKey: "secret", fetch: fetcher }).complete(request)).rejects.toThrow("Free research AI unavailable: request timed out or transport failed");
  });
  it("does not route reasoning-disabled requests to an incompatible fallback", async () => {
    const fetcher = vi.fn();
    const ai = new FreeOpenRouter({ paidFallback: false, apiKey: "secret", models: ["nvidia/nemotron-3-super-120b-a12b:free"], fetch: fetcher });
    await expect(ai.complete({ ...request, reasoning_effort: "none" })).rejects.toThrow(/reasoning mode/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Mercury fallback", () => {
  it("tries the free pool first, then only Mercury on quota exhaustion with its own price ceiling", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 429, message: "free-models-per-day" } }, { status: 429 })).mockResolvedValueOnce(completion({ value: "18", quote: "18 staff" }, { model: MERCURY_FALLBACK_MODEL, usage: { cost: 0.0001 } }));
    const onRequest = vi.fn(), onUsage = vi.fn();
    const result = await new FreeOpenRouter({ apiKey: "secret", fetch: fetcher, onRequest, onUsage }).complete(request);
    expect(result.response).toEqual({ value: "18", quote: "18 staff" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onRequest).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[0].provider.max_price).toEqual({ prompt: 0, completion: 0 });
    expect(bodies[1]).toMatchObject({ models: [MERCURY_FALLBACK_MODEL], provider: { max_price: MERCURY_PRICE_CAP, require_parameters: true, data_collection: "deny" } });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ model: MERCURY_FALLBACK_MODEL, cost: 0.0001, paidFallback: true }));
  });
  it("does not use paid inference after a successful free response", async () => {
    const fetcher = vi.fn().mockResolvedValue(completion({ value: null, quote: null }));
    await new FreeOpenRouter({ apiKey: "secret", fetch: fetcher }).complete(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 402, 403])("does not retry request/account errors %s against paid inference", async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status }));
    await expect(new FreeOpenRouter({ apiKey: "secret", fetch: fetcher }).complete(request)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stops after Mercury fails instead of starting an unbounded retry loop", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 503 }));
    await expect(new FreeOpenRouter({ apiKey: "secret", fetch: fetcher }).complete(request)).rejects.toThrow(/Mercury fallback/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not dispatch the fallback after the total request deadline", async () => {
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const fetcher = vi.fn().mockImplementation(async () => { now = 45001; throw new Error("transport failed"); });
      await expect(new FreeOpenRouter({ apiKey: "secret", fetch: fetcher }).complete(request)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
});

describe("sequential free fallback", () => {
  it("recovers from an HTTP-200 body timeout using a different free model within the total deadline", async () => {
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const stalled = new Response();
      vi.spyOn(stalled, "json").mockImplementation(async () => {
        now = 22500;
        throw new DOMException("Aborted", "TimeoutError");
      });
      const fetcher = vi.fn().mockResolvedValueOnce(stalled).mockResolvedValueOnce(completion({ value: null, quote: null }));
      const result = await new FreeOpenRouter({ apiKey: "secret", paidFallback: false, sequentialFreeFallback: true, models: FREE_RESEARCH_MODELS.slice(0, 2), fetch: fetcher }).complete(request);
      expect(result.response).toEqual({ value: null, quote: null });
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([22500, 22500]);
      expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init.body).models)).toEqual([[FREE_RESEARCH_MODELS[0]], [FREE_RESEARCH_MODELS[1]]]);
      for (const [, init] of fetcher.mock.calls) expect(JSON.parse(init.body).provider.max_price).toEqual({ prompt: 0, completion: 0 });
    } finally { clock.mockRestore(); timeout.mockRestore(); }
  });

  it.each([400, 401, 402, 403])("does not retry account or request failure %s", async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status }));
    await expect(new FreeOpenRouter({ apiKey: "secret", paidFallback: false, sequentialFreeFallback: true, fetch: fetcher }).complete(request)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry beyond the total deadline", async () => {
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const fetcher = vi.fn().mockImplementation(async () => { now = 45001; throw new DOMException("Aborted", "TimeoutError"); });
      await expect(new FreeOpenRouter({ apiKey: "secret", paidFallback: false, sequentialFreeFallback: true, fetch: fetcher }).complete(request)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
});
