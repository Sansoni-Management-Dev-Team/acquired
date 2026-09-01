import { describe, expect, it, vi } from "vitest";
import { OpenRouterAiProvider } from "./openrouter";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenRouterAiProvider", () => {
  it("translates the neutral structured request and returns parsed JSON with usage", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      model: "test/model",
      choices: [{ message: { content: JSON.stringify({ result: "ok" }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    }));
    const provider = new OpenRouterAiProvider({ apiKey: "secret", model: "qwen/qwen3.8-flash", fetch: fetcher });

    const result = await provider.generateStructured({
      name: "test_response",
      system: "System instructions",
      user: "User context",
      schema: { type: "object", properties: { result: { type: "string" } }, required: ["result"], additionalProperties: false },
      maxTokens: 500,
      temperature: 0.2,
    });

    expect(result).toEqual({ json: { result: "ok" }, model: "test/model", usage: { inputTokens: 120, outputTokens: 30 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "qwen/qwen3.8-flash",
      messages: [{ role: "system", content: "System instructions" }, { role: "user", content: "User context" }],
      response_format: { type: "json_schema", json_schema: { name: "test_response", strict: true } },
      provider: { require_parameters: true, data_collection: "deny" },
      reasoning: { effort: "none", exclude: true },
    });
  });

  it("fails closed on malformed model JSON", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({ choices: [{ message: { content: "not-json" } }] })));
    const provider = new OpenRouterAiProvider({ apiKey: "secret", model: "test/model", fetch: fetcher, fallbackDelayMs: 0 });

    await expect(provider.generateStructured({ name: "test", system: "s", user: "u", schema: { type: "object" } })).rejects.toThrow(/valid JSON/);
  });

  it("falls through the configured model waterfall after a transient provider failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ error: { message: "Provider busy" } }, 429))
      .mockResolvedValueOnce(response({ error: { message: "Free model unavailable" } }, 404))
      .mockResolvedValueOnce(response({ error: { message: "Paid provider busy" } }, 429))
      .mockResolvedValueOnce(response({ model: "qwen/qwen3.8-flash", choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }));
    const provider = new OpenRouterAiProvider({ apiKey: "secret", models: ["z-ai/glm-5.2:free", "dots-studio/dots-3-note-preview:free", "qwen/qwen3.8-flash"], fetch: fetcher, fallbackDelayMs: 0 });

    const result = await provider.generateStructured({ name: "test", system: "s", user: "u", schema: { type: "object" } });

    expect(result.json).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).model).toBe("z-ai/glm-5.2:free");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).model).toBe("dots-studio/dots-3-note-preview:free");
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).model).toBe("qwen/qwen3.8-flash");
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body)).model).toBe("qwen/qwen3.8-flash");
  });

  it("caps a failed waterfall at one request per configured model", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { message: "Provider busy" } }, 429));
    const provider = new OpenRouterAiProvider({ apiKey: "secret", models: ["free/one", "free/two", "paid/three"], fetch: fetcher, fallbackDelayMs: 0 });

    await expect(provider.generateStructured({ name: "test", system: "s", user: "u", schema: { type: "object" } })).rejects.toThrow(/429/);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not fall through on a non-transient client error", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { message: "Invalid key" } }, 401));
    const provider = new OpenRouterAiProvider({ apiKey: "secret", models: ["free/one", "paid/two"], fetch: fetcher, fallbackDelayMs: 0 });

    await expect(provider.generateStructured({ name: "test", system: "s", user: "u", schema: { type: "object" } })).rejects.toThrow(/401/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
