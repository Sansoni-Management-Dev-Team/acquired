type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : undefined;

/** Classify provider messages in memory; never persist arbitrary error bodies or echoed prompts. */
export function providerDiagnostics(status: number, headers: Headers, body: unknown) {
  const data = object(body), error = object(data.error), metadata = object(error.metadata);
  const errors = Array.isArray(data.errors) ? data.errors.map(object) : [];
  const message = [error.message, metadata.raw, ...errors.map(e => e.message)].filter(v => typeof v === "string").join(" ").slice(0, 16000);
  let category = status === 429 ? "rate_limit_unspecified" : "provider_error";
  if (/free-models-per-day|requests per day|daily.{0,40}(limit|quota)|limit.{0,30}(today|per day)/i.test(message)) category = "daily_quota";
  else if (/free-models-per-min|per.minute|requests per second|rate.{0,15}per.second/i.test(message)) category = "request_rate";
  else if (/concurren|simultaneous|too many browsers/i.test(message)) category = "concurrency";
  else if (/upstream|overload|capacity|temporarily rate.limited/i.test(message)) category = "upstream_capacity";
  else if (/credit|balance|payment/i.test(message) || status === 402) category = "credits";
  else if (status === 401 || status === 403) category = "authentication_or_policy";
  const metadataHeaders = object(metadata.headers);
  const limits: Record<string, number | string> = {};
  for (const name of ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"]) {
    const entry = Object.entries(metadataHeaders).find(([key]) => key.toLowerCase() === name)?.[1];
    const value = headers.get(name) ?? entry;
    const number = numeric(value);
    if (number !== undefined) limits[name] = number;
    else if (name === "retry-after" && typeof value === "string" && /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) limits[name] = value;
  }
  const ids: Record<string, string> = {};
  for (const name of ["cf-ray", "x-request-id", "x-openrouter-request-id"]) {
    const value = headers.get(name);
    if (value && /^[a-zA-Z0-9_-]{8,100}$/.test(value)) ids[name] = value;
  }
  // Only known provider names are emitted; metadata may otherwise contain arbitrary text.
  const providerName = typeof metadata.provider_name === "string" && /^(Nex AGI|NEX|Nvidia|NVIDIA|OpenRouter|Cloudflare|Chutes|DeepInfra|Together|Google AI Studio|Novita|SambaNova)$/i.test(metadata.provider_name) ? metadata.provider_name : undefined;
  return { category, classificationBasis: category === "rate_limit_unspecified" || category === "provider_error" ? "http_status" : "provider_message_pattern", errorCodes: [error.code, ...errors.map(e => e.code)].map(numeric).filter(v => v !== undefined), limits, providerRequestIds: ids, upstreamProvider: providerName };
}

export type RequestContext = {
  provider: "openrouter" | "openai" | "cloudflare-browser" | "research-worker" | "local-crawl4ai" | "local-openserp";
  operation: string;
  jobId?: string;
  requestId?: string;
  modelCandidates?: string[];
  verbose?: boolean;
};

/** One request; no retries, additional provider calls, request content or secrets in logs. */
export async function providerJsonRequest<T>(fetcher: typeof fetch, url: string, init: RequestInit, context: RequestContext): Promise<{ response: Response; data: T }> {
  const { verbose = true, ...fields } = context;
  const requestId = context.requestId || crypto.randomUUID();
  const base = { ...fields, requestId };
  const started = Date.now();
  const emit = (event: string, fields: object) => console.info("research-provider", JSON.stringify({ timestamp: new Date().toISOString(), ...base, event, elapsedMs: Date.now() - started, ...fields }));
  if (verbose) emit("request_started", {});
  let response: Response;
  try { response = await fetcher(url, init); }
  catch (error) {
    emit("request_failed", { failureOrigin: "provider_transport", category: init.signal?.aborted || (error instanceof Error && /TimeoutError|AbortError/.test(error.name)) ? "timeout" : "transport" });
    throw error;
  }
  let data: T;
  try { data = await response.json() as T; }
  catch (error) {
    const timedOut = init.signal?.aborted || (error instanceof Error && /TimeoutError|AbortError/.test(error.name));
    emit("request_failed", { failureOrigin: "upstream_response", httpStatus: response.status, ...providerDiagnostics(response.status, response.headers, {}), category: timedOut ? "timeout" : response.status === 429 ? "rate_limit_unspecified" : "invalid_json_or_interrupted_body", classificationBasis: timedOut ? "abort_signal" : "response_body" });
    if (!response.ok) return { response, data: {} as T };
    throw error;
  }
  const payload = object(data);
  if (!response.ok || payload.error || payload.success === false) emit("request_failed", { failureOrigin: "upstream_response", httpStatus: response.status, ...providerDiagnostics(response.status, response.headers, data) });
  else if (verbose) emit("request_completed", { httpStatus: response.status, providerRequestIds: providerDiagnostics(response.status, response.headers, {}).providerRequestIds });
  return { response, data };
}
