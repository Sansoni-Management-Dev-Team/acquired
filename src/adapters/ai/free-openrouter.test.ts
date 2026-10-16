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
    expect(body.models).toEqual(FREE_RESEARCH_MODELS);
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
    expect(JSON.parse(init.body)).toMatchObject({ models: [...FREE_RESEARCH_MODELS], provider: { max_price: { prompt: 0, completion: 0 }, require_parameters: true, data_collection: "allow" } });
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
  it("accepts verified Nemotron reasoning-disabled requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(completion({value:null,quote:null}));
    const ai = new FreeOpenRouter({ paidFallback: false, apiKey: "secret", models: ["nvidia/nemotron-3-super-120b-a12b:free"], fetch: fetcher });
    await expect(ai.complete({ ...request, reasoning_effort: "none" })).resolves.toMatchObject({response:{value:null,quote:null}});
    expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning.effort).toBe("none");
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
    expect(bodies[1]).toMatchObject({ models: [MERCURY_FALLBACK_MODEL], provider: { max_price: MERCURY_PRICE_CAP, require_parameters: true, data_collection: "allow" } });
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
  it("stops after the bounded paid waterfall fails", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 503 }));
    await expect(new FreeOpenRouter({ apiKey: "secret", fetch: fetcher }).complete(request)).rejects.toThrow(/NeMo fallback/);
    expect(fetcher).toHaveBeenCalledTimes(3);
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

it('explicit fast primary uses approved paid route and retains the price ceiling', async () => {
  const fetcher = vi.fn().mockResolvedValue(completion({ value: null, quote: null }));
  await new FreeOpenRouter({ apiKey: 'secret', primaryRoute: 'fast-paid', fetch: fetcher }).complete(request);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.models).toEqual([MERCURY_FALLBACK_MODEL]);
  expect(body.provider.max_price).toEqual(MERCURY_PRICE_CAP);
});
it('rejects a paid primary configuration when free-only mode was requested', async () => {
  const fetcher = vi.fn();
  await expect(new FreeOpenRouter({ apiKey: 'secret', primaryRoute: 'fast-paid', paidFallback: false, fetch: fetcher }).complete(request)).rejects.toThrow(/free-only/);
  expect(fetcher).not.toHaveBeenCalled();
});
it('configures bounded extraction reasoning independently of planning', async () => {
  const fetcher = vi.fn().mockImplementation(async () => completion({ value: null, quote: null }));
  const ai = new FreeOpenRouter({ apiKey: 'secret', paidFallback: false, extractionReasoning: 'none', fetch: fetcher });
  await ai.complete({ ...request, operation: 'business_extraction' });
  await ai.complete({ ...request, operation: 'followup_planning' });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning.effort).toBe('none');
  expect(JSON.parse(fetcher.mock.calls[1][1].body).reasoning.effort).toBe('medium');
});


it('short circuits unavailable free routes within an instance and recovers after TTL', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 404 })).mockImplementation(async (_url, init) => {
      const paid = JSON.parse(init.body).models[0] === MERCURY_FALLBACK_MODEL;
      return paid ? completion({ value: null, quote: null }, { model: MERCURY_FALLBACK_MODEL }) : completion({ value: null, quote: null });
    });
    const ai = new FreeOpenRouter({ apiKey: 'secret', fetch: fetcher });
    await ai.complete(request);
    await ai.complete(request);
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60001);
    await ai.complete(request);
    expect(JSON.parse(fetcher.mock.calls[3][1].body).models).toEqual(FREE_RESEARCH_MODELS);
  } finally { vi.useRealTimers(); }
});
it('does not share unavailable routing between instances, reasoning/schema fingerprints or transient failures', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 404 }));
  const ai = new FreeOpenRouter({ apiKey: 'one', fetch: fetcher, paidFallback: false });
  await expect(ai.complete(request)).rejects.toThrow();
  await expect(ai.complete(request)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(ai.complete({ ...request, reasoning_effort: 'none' })).rejects.toThrow();
  await expect(ai.complete({ ...request, response_format: { ...request.response_format, json_schema: { type: 'object', properties: { alternate: { type: 'string' } }, required: ['alternate'], additionalProperties: false } } })).rejects.toThrow();
  await expect(new FreeOpenRouter({ apiKey: 'two', fetch: fetcher, paidFallback: false }).complete(request)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(4);
  const transient = vi.fn().mockResolvedValue(Response.json({}, { status: 503 }));
  const retry = new FreeOpenRouter({ apiKey: 'one', fetch: transient, paidFallback: false });
  for (let i = 0; i < 2; i++) await expect(retry.complete(request)).rejects.toThrow();
  expect(transient).toHaveBeenCalledTimes(2);
});

it('uses the live free pool with collection allowed and preserves free zero-price routing', async () => {
 const fetcher=vi.fn().mockResolvedValue(completion({value:null,quote:null}));
 await new FreeOpenRouter({apiKey:'secret',fetch:fetcher}).complete({...request,reasoning_effort:'none'});
 const body=JSON.parse(fetcher.mock.calls[0][1].body);
 expect(body.models).toEqual(['dots-studio/dots-3-note-preview:free','nvidia/nemotron-3.5-super-vl:free','nvidia/nemotron-3-super-120b-a12b:free']);
 expect(body.provider).toMatchObject({data_collection:'allow',max_price:{prompt:0,completion:0}});
});
it('waterfalls from free to Mercury then NeMo, omitting unsupported NeMo reasoning and retaining schema validation',async()=>{
 const fetcher=vi.fn()
  .mockResolvedValueOnce(Response.json({}, {status:404}))
  .mockResolvedValueOnce(Response.json({}, {status:429}))
  .mockResolvedValueOnce(completion({value:'18',quote:'18 staff'},{model:'mistralai/mistral-nemo',usage:{cost:0.000001}}));
 const usage=vi.fn();
 expect((await new FreeOpenRouter({apiKey:'secret',fetch:fetcher,onUsage:usage}).complete({...request,reasoning_effort:'none'})).response).toEqual({value:'18',quote:'18 staff'});
 const bodies=fetcher.mock.calls.map(([,init])=>JSON.parse(init.body));
 expect(bodies.map(body=>body.models)).toEqual([FREE_RESEARCH_MODELS,[MERCURY_FALLBACK_MODEL],['mistralai/mistral-nemo']]);
 expect(bodies[2]).not.toHaveProperty('reasoning');
 expect(bodies[2].response_format.type).toBe('json_schema');
 for(const body of bodies){expect(body.provider.data_collection).toBe('allow');expect(body.provider.require_parameters).toBe(true)}
 expect(bodies[2].provider.max_price).toEqual(MERCURY_PRICE_CAP);
 expect(usage).toHaveBeenCalledWith(expect.objectContaining({model:'mistralai/mistral-nemo',paidFallback:true}));
});
it('does not accept schema-invalid NeMo output or retry after account errors',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({}, {status:404})).mockResolvedValueOnce(Response.json({}, {status:429})).mockResolvedValueOnce(completion({value:18}));
 await expect(new FreeOpenRouter({apiKey:'secret',fetch:fetcher}).complete(request)).rejects.toThrow(/schema/);
 expect(fetcher).toHaveBeenCalledTimes(3);
});
it('reserves bounded time for both paid fallbacks after a free timeout',async()=>{
 let now=0;
 const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 const timeout=vi.spyOn(AbortSignal,'timeout');
 try{
  const fetcher=vi.fn().mockImplementationOnce(async()=>{now=25000;throw new DOMException('Timeout','TimeoutError')})
   .mockImplementationOnce(async()=>{now=35000;throw new DOMException('Timeout','TimeoutError')})
   .mockResolvedValueOnce(completion({value:null,quote:null},{model:'mistralai/mistral-nemo'}));
  await new FreeOpenRouter({apiKey:'secret',fetch:fetcher}).complete(request);
  expect(timeout.mock.calls.map(([ms])=>ms)).toEqual([25000,10000,10000]);
 }finally{clock.mockRestore();timeout.mockRestore()}
});
it('does not try NeMo after a paid account authentication failure',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({}, {status:429})).mockResolvedValueOnce(Response.json({}, {status:401}));
 await expect(new FreeOpenRouter({apiKey:'secret',fetch:fetcher}).complete(request)).rejects.toThrow('HTTP 401');
 expect(fetcher).toHaveBeenCalledTimes(2);
});
