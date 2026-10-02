export interface FirmableSessionEnv {
  FIRMABLE_CLIENT_COOKIE?: string;
  FIRMABLE_SESSION_ID?: string;
  FIRMABLE_ORGANIZATION_ID?: string;
}

type JsonRecord = Record<string, unknown>;
const companyId = "f000000173355"; // Successful Endeavours: known company, read-only probe.
const clerkOrigin = "https://clerk.firmable.com";
const apiOrigin = "https://api.firmable.com";
const appOrigin = "https://app.firmable.com";
const apiVersion = "__clerk_api_version=2026-05-12&_clerk_js_version=6.36.0";

class ValidationFailure extends Error {
  constructor(readonly phase: string, readonly status: number, readonly category: string, readonly retryAfter?: string) {
    super(category);
  }
}

async function upstreamJson(fetcher: typeof fetch, phase: string, url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    // Fetch errors contain runtime diagnostics, not response bodies. Remove URLs
    // and credential values before emitting a private Worker log.
    let message = error instanceof Error ? error.message : "Unknown transport error";
    for (const value of new Headers(init.headers).values()) if (value.length > 16) message = message.replaceAll(value, "[redacted]");
    console.warn("firmable-validation-transport", { phase, name: error instanceof Error ? error.name : "unknown", message: message.replace(/https?:\/\/\S+/g, "[upstream]").slice(0, 250) });
    throw new ValidationFailure(phase, 502, "transport_or_timeout");
  }
  if (!response.ok) {
    const category = response.status >= 300 && response.status < 400 ? "unexpected_redirect" : response.status === 429 ? "rate_limited"
      : [401, 403].includes(response.status) ? "authentication_or_policy" : "upstream_error";
    const retryAfter = response.headers.get("retry-after") || undefined;
    await response.body?.cancel();
    throw new ValidationFailure(phase, response.status, category, retryAfter);
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationFailure(phase, 502, "invalid_response");
  return { data: data as JsonRecord, response };
}

export async function validateFirmableSession(env: FirmableSessionEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (!env.FIRMABLE_CLIENT_COOKIE || !/^sess_[A-Za-z0-9]+$/.test(env.FIRMABLE_SESSION_ID || "")
    || !/^org_[A-Za-z0-9]+$/.test(env.FIRMABLE_ORGANIZATION_ID || "")
    || /[\r\n;]/.test(env.FIRMABLE_CLIENT_COOKIE)) {
    return Response.json({ error: "Firmable validation is not configured" }, { status: 503, headers });
  }
  try {
    const started = Date.now();
    const renewal = await upstreamJson(fetcher, "renewal", `${clerkOrigin}/v1/client/sessions/${env.FIRMABLE_SESSION_ID}/tokens?${apiVersion}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `__client=${env.FIRMABLE_CLIENT_COOKIE}`,
        Origin: appOrigin,
        Referer: `${appOrigin}/`,
      },
      body: new URLSearchParams({ organization_id: env.FIRMABLE_ORGANIZATION_ID!, tab_state: "visible" }).toString(),
    });
    const token = renewal.data.jwt;
    if (typeof token !== "string") throw new ValidationFailure("renewal", 502, "invalid_token_response");
    let claims: JsonRecord;
    try {
      const encoded = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
      claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    } catch {
      throw new ValidationFailure("renewal", 502, "invalid_token_response");
    }
    // Claims provide diagnostics only. Upstream API acceptance validates the token.
    const organization = claims.o as JsonRecord | undefined;
    if (claims.sid !== env.FIRMABLE_SESSION_ID || organization?.id !== env.FIRMABLE_ORGANIZATION_ID
      || typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000) {
      throw new ValidationFailure("renewal", 502, "unexpected_token_context");
    }
    const renewalMs = Date.now() - started;
    const cookieReplaced = (renewal.response.headers.get("set-cookie") || "").split(/,(?=\s*[^\s;,=]+=)/)
      .some(cookie => /^\s*__client=/.test(cookie) && cookie.split(";")[0].trim() !== `__client=${env.FIRMABLE_CLIENT_COOKIE}`);
    const providerHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const company = await upstreamJson(fetcher, "company", `${apiOrigin}/internal/company/${companyId}`, { headers: providerHeaders });
    if (company.data.id !== companyId || typeof company.data.name !== "string") throw new ValidationFailure("company", 502, "unexpected_company_response");
    const people = await upstreamJson(fetcher, "people", `${apiOrigin}/internal/people`, {
      method: "POST", headers: providerHeaders,
      body: JSON.stringify({ size: 10, from: 0, companyId, companyName: company.data.name, selectedCountry: "AU" }),
    });
    if (people.data.success !== true || !Array.isArray(people.data.records) || typeof people.data.total !== "number") {
      throw new ValidationFailure("people", 502, "invalid_people_response");
    }
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const fingerprint = Array.from(new Uint8Array(hash)).slice(0, 8).map(byte => byte.toString(16).padStart(2, "0")).join("");
    return Response.json({
      ok: true, checkedAt: new Date().toISOString(),
      renewal: { status: 200, issuedAt: claims.iat, expiresAt: claims.exp, remainingSeconds: Math.floor(claims.exp - Date.now() / 1000), fingerprint, cookieReplaced, elapsedMs: renewalMs },
      company: { status: 200, id: company.data.id, name: company.data.name },
      people: { status: 200, pageCount: people.data.records.length, total: people.data.total },
      elapsedMs: Date.now() - started,
    }, { headers });
  } catch (error) {
    if (!(error instanceof ValidationFailure)) return Response.json({ error: "Validation failed", category: "internal_error" }, { status: 502, headers });
    return Response.json({ error: "Firmable validation failed", phase: error.phase, upstreamStatus: error.status, category: error.category, retryAfter: error.retryAfter }, {
      status: error.status === 429 ? 429 : 502, headers,
    });
  }
}
