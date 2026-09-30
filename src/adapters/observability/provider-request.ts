type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : undefined;

/** Classify provider messages in memory; never persist arbitrary error bodies or echoed prompts. */
export function providerDiagnostics(status: number, headers: Headers, body: unknown, provider?: string) {
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
  const readerReasons = ["reader_busy", "domain_backoff", "origin_rate_limit", "origin_http_error", "page_unavailable", "reader_timeout", "reader_failure"];
  const readerReason = provider === "local-crawl4ai" && typeof data.category === "string" && readerReasons.includes(data.category) ? data.category : undefined;
  if (readerReason) category = readerReason;
  const reader: Record<string, number | string | boolean> = {};
  if (provider === "local-crawl4ai") {
    const diagnostics = object(data.reader);
    const originStatus = numeric(data.originHttpStatus);
    if (originStatus !== undefined && Number.isInteger(originStatus) && originStatus >= 100 && originStatus <= 599) reader.originHttpStatus = originStatus;
    for (const key of ["activeReads", "maxReads", "availableReads", "elapsedMs", "retryAfterMs"]) {
      const value = numeric(diagnostics[key]);
      if (value !== undefined && value >= 0 && value <= 86400000) reader[key] = value;
    }
    if (typeof diagnostics.domainActive === "boolean") reader.domainActive = diagnostics.domainActive;
    if (typeof diagnostics.domainKey === "string" && /^[a-f0-9]{12}$/.test(diagnostics.domainKey)) reader.domainKey = diagnostics.domainKey;
  }
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
  return { category, classificationBasis: readerReason ? "reader_category" : category === "rate_limit_unspecified" || category === "provider_error" ? "http_status" : "provider_message_pattern", errorCodes: [error.code, ...errors.map(e => e.code)].map(numeric).filter(v => v !== undefined), limits, providerRequestIds: ids, upstreamProvider: providerName, ...(Object.keys(reader).length ? { reader } : {}) };
}

export type RequestContext = {
  provider: "openrouter" | "openai" | "cloudflare-browser" | "research-worker" | "local-crawl4ai" | "local-openserp";
  operation: string;
  jobId?: string;
  requestId?: string;
  modelCandidates?: string[];
  verbose?: boolean;
};

/** Internal response metrics only; never emit arbitrary header names or descriptions. */
function callbackMeasurements(headers: Headers) {
  const timing = headers.get("server-timing") || "";
  const responseServerTiming: { appMs?: number; dbMs?: number } = {};
  if (timing.length <= 4096) {
    for (const entry of timing.split(",")) {
      // The app emits duration-only metrics. Ignore extensions/descriptions rather
      // than interpreting arbitrary strings as timing values.
      const match = /^\s*(app|db)\s*;\s*dur\s*=\s*(\d+(?:\.\d+)?)\s*$/i.exec(entry);
      if (!match) continue;
      const duration = Number(match[2]);
      if (Number.isFinite(duration) && duration <= 86400000) responseServerTiming[match[1].toLowerCase() === "app" ? "appMs" : "dbMs"] = duration;
    }
  }
  const calls = headers.get("x-research-db-calls");
  const databaseCalls = calls && /^\d{1,6}$/.test(calls) && Number(calls) <= 100000 ? Number(calls) : undefined;
  const bytes = headers.get('x-research-response-body-bytes');
  const responseBodyBytes = bytes && /^\d{1,9}$/.test(bytes) && Number(bytes) <= 100_000_000 ? Number(bytes) : undefined;
  return { ...(Object.keys(responseServerTiming).length ? { responseServerTiming } : {}), ...(databaseCalls !== undefined ? { databaseCalls } : {}), ...(responseBodyBytes !== undefined ? { responseBodyBytes, bodyByteMeasurement: 'application_utf8_body' } : {}) };
}

/** One request; no retries, additional provider calls, request content or secrets in logs. */
export async function providerJsonRequest<T>(fetcher: typeof fetch, url: string, init: RequestInit, context: RequestContext): Promise<{ response: Response; data: T }> {
  const { verbose = true, ...fields } = context;
  const requestId = context.requestId && (context.provider !== "research-worker" || /^[a-zA-Z0-9_-]{8,100}$/.test(context.requestId)) ? context.requestId : crypto.randomUUID();
  if (context.provider === "research-worker") {
    const headers = new Headers(init.headers);
    headers.set("x-request-id", requestId);
    init = { ...init, headers };
  }
  const requestBodyBytes = typeof init.body === 'string' ? new TextEncoder().encode(init.body).byteLength : init.body == null ? 0 : undefined;
  const base = { ...fields, requestId, ...(requestBodyBytes !== undefined ? { requestBodyBytes, bodyByteMeasurement: 'application_utf8_body' } : {}) };
  const started = Date.now();
  const emit = (event: string, fields: object) => console.info("research-provider", JSON.stringify({ timestamp: new Date().toISOString(), ...base, event, elapsedMs: Date.now() - started, ...fields }));
  if (verbose) emit("request_started", {});
  let response: Response;
  try { response = await fetcher(url, init); }
  catch (error) {
    emit("request_failed", { failureOrigin: "provider_transport", category: init.signal?.aborted || (error instanceof Error && /TimeoutError|AbortError/.test(error.name)) ? "timeout" : "transport" });
    throw error;
  }
  const measurements = context.provider === "research-worker" ? callbackMeasurements(response.headers) : {};
  let data: T;
  try { data = await response.json() as T; }
  catch (error) {
    const timedOut = init.signal?.aborted || (error instanceof Error && /TimeoutError|AbortError/.test(error.name));
    emit("request_failed", { failureOrigin: "upstream_response", httpStatus: response.status, ...measurements, ...providerDiagnostics(response.status, response.headers, {}), category: timedOut ? "timeout" : response.status === 429 ? "rate_limit_unspecified" : "invalid_json_or_interrupted_body", classificationBasis: timedOut ? "abort_signal" : "response_body" });
    if (!response.ok) return { response, data: {} as T };
    throw error;
  }
  const payload = object(data);
  const diagnostics = providerDiagnostics(response.status, response.headers, data, context.provider);
  if (!response.ok || payload.error || payload.success === false) emit("request_failed", { failureOrigin: "upstream_response", httpStatus: response.status, ...measurements, ...diagnostics });
  else if (verbose) emit("request_completed", { httpStatus: response.status, ...measurements, providerRequestIds: diagnostics.providerRequestIds, ...("reader" in diagnostics ? { reader: diagnostics.reader } : {}) });
  return { response, data };
}
