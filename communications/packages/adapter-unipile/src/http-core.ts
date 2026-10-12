/** Shared bounded I/O; provider versions own paths, payloads and capabilities. */
export type UnipileHttpResult = {
    kind: "success";
    status: number;
    data: unknown;
} | {
    kind: "rejected";
    status: number;
    reason: "authentication" | "authorization" | "not_found" | "rate_limited" | "invalid_request" | "provider_rejection";
    retryAfterSeconds?: number;
} | {
    kind: "unknown" | "unavailable";
    reason: "transport" | "timeout" | "canceled" | "provider_failure" | "invalid_response";
    status?: number;
} | {
    kind: "not_submitted";
    reason: "canceled";
};
export interface BoundedUnipileConfig {
    basePath: "/v2" | "/api/v1";
    baseUrl: string;
    apiKey: string;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    maxResponseBytes?: number;
    allowLoopbackHttp?: boolean;
    /** V1 status-only 422/unknown 4xx cannot establish an unsent operation. */
    strictWriteRejections?: boolean;
}
export interface UnipileRequestOptions {
    signal?: AbortSignal;
}
class InvalidResponse extends Error {
}
export function boundedInteger(value: number, min: number, max: number) {
    return Number.isSafeInteger(value) && value >= min && value <= max;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted)
        return Promise.reject(new Error("Request canceled"));
    return new Promise((resolve, reject) => {
        const abort = () => reject(new Error("Request canceled"));
        signal.addEventListener("abort", abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}
async function readJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
    const declaredBytes = response.headers.get("content-length");
    if (declaredBytes && Number(declaredBytes) > maxBytes) {
        void response.body?.cancel().catch(() => undefined);
        throw new InvalidResponse();
    }
    if (!response.body)
        return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await abortable(reader.read(), signal);
            if (done)
                break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes)
                throw new InvalidResponse();
            chunks.push(value);
        }
        if (totalBytes === 0)
            return null;
        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        try {
            return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        }
        catch {
            throw new InvalidResponse();
        }
    }
    finally {
        void reader.cancel().catch(() => undefined);
    }
}
export class BoundedUnipileHttp {
    // ECMAScript private fields prevent accidental JSON/debug enumeration of credentials.
    #baseUrl: URL;
    #apiKey: string;
    #fetch: typeof globalThis.fetch;
    #timeoutMs: number;
    #maxResponseBytes: number;
    #strictWriteRejections: boolean;
    constructor(config: BoundedUnipileConfig) {
        let url: URL;
        try {
            url = new URL(config.baseUrl);
        }
        catch {
            throw new Error("Invalid Unipile configuration");
        }
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        const secure = url.protocol === "https:" || (url.protocol === "http:" && loopback && config.allowLoopbackHttp === true);
        const timeoutMs = config.timeoutMs ?? 15000;
        const maxResponseBytes = config.maxResponseBytes ?? 1048576;
        if (!secure || url.username || url.password || url.search || url.hash ||
            url.pathname.replace(/\/$/, "") !== config.basePath || !config.apiKey || config.apiKey.trim() !== config.apiKey ||
            /[\r\n]/.test(config.apiKey) || !boundedInteger(timeoutMs, 1, 60000) ||
            !boundedInteger(maxResponseBytes, 1, 5242880)) {
            throw new Error("Invalid Unipile configuration");
        }
        url.pathname = config.basePath + "/";
        this.#baseUrl = url;
        this.#apiKey = config.apiKey;
        this.#fetch = config.fetch ?? globalThis.fetch;
        this.#timeoutMs = timeoutMs;
        this.#maxResponseBytes = maxResponseBytes;
        this.#strictWriteRejections = config.strictWriteRejections === true;
    }
    url(path: string): URL {
        const result = new URL(path, this.#baseUrl);
        if (result.origin !== this.#baseUrl.origin || !result.pathname.startsWith(this.#baseUrl.pathname))
            throw new Error("Invalid Unipile request");
        return result;
    }
    async request(method: "GET" | "POST", url: URL, body: BodyInit | undefined, options: UnipileRequestOptions, extraHeaders: Record<string, string> = {}): Promise<UnipileHttpResult> {
        if (url.origin !== this.#baseUrl.origin || !url.pathname.startsWith(this.#baseUrl.pathname))
            throw new Error("Invalid Unipile request");
        if (options.signal?.aborted)
            return { kind: "not_submitted", reason: "canceled" };
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeoutMs);
        const cancel = () => controller.abort();
        options.signal?.addEventListener("abort", cancel, { once: true });
        const uncertainKind = method === "POST" ? "unknown" : "unavailable";
        try {
            const response = await abortable(this.#fetch(url, {
                method, redirect: "error", signal: controller.signal,
                headers: {
                    "X-API-KEY": this.#apiKey, Accept: "application/json",
                    ...(method === "GET" ? { "Cache-Control": "no-store" } : {}),
                    ...extraHeaders,
                },
                ...(body !== undefined ? { body } : {}),
            }), controller.signal);
            if (response.status >= 500) {
                void response.body?.cancel().catch(() => undefined);
                return { kind: uncertainKind, reason: "provider_failure", status: response.status };
            }
            if (response.status >= 400) {
                // Never return provider titles/details/body; those can contain tokens or message content.
                if (method === "POST" && this.#strictWriteRejections) {
                    const definiteStatuses = [400, 401, 403, 404, 405, 413, 415, 429];
                    if ([409, 422].includes(response.status)) {
                        const error = await readJson(response, this.#maxResponseBytes, controller.signal);
                        const envelope = error && typeof error === "object" && !Array.isArray(error) && "type" in error && "status" in error ? error : undefined;
                        const type = envelope && envelope.status === response.status ? envelope.type : undefined;
                        const definite422 = ["errors/invalid_account", "errors/invalid_recipient", "errors/no_connection_with_recipient",
                            "errors/blocked_recipient", "errors/user_unreachable", "errors/invalid_message", "errors/invalid_headers",
                            "errors/parent_mail_not_found", "errors/parent_mail_invalid_provider_id", "errors/invalid_reply_subject",
                            "errors/invalid_thread", "errors/cannot_invite_attendee", "errors/already_connected", "errors/already_invited_recently",
                            "errors/cannot_resend_yet", "errors/insufficient_credits", "errors/not_allowed_inmail"];
                        if (!((response.status === 409 && type === "errors/already_used") ||
                            (response.status === 422 && typeof type === "string" && definite422.includes(type)))) {
                            return { kind: "unknown", reason: "invalid_response", status: response.status };
                        }
                    }
                    else if (!definiteStatuses.includes(response.status)) {
                        void response.body?.cancel().catch(() => undefined);
                        return { kind: "unknown", reason: "invalid_response", status: response.status };
                    }
                }
                void response.body?.cancel().catch(() => undefined);
                const reason = response.status === 401 ? "authentication" : response.status === 403 ? "authorization" :
                    response.status === 404 ? "not_found" : response.status === 429 ? "rate_limited" :
                        [400, 405, 413, 415, 422].includes(response.status) ? "invalid_request" : "provider_rejection";
                const retry = response.headers.get("retry-after");
                const retryAfterSeconds = retry && /^\d+$/.test(retry) && boundedInteger(Number(retry), 0, 86400) ? Number(retry) : undefined;
                return { kind: "rejected", status: response.status, reason,
                    ...(response.status === 429 && retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
            }
            if (!response.ok) {
                void response.body?.cancel().catch(() => undefined);
                return { kind: uncertainKind, reason: "invalid_response" };
            }
            const data = await readJson(response, this.#maxResponseBytes, controller.signal);
            return { kind: "success", status: response.status, data };
        }
        catch (error) {
            return { kind: uncertainKind, reason: timedOut ? "timeout" : controller.signal.aborted ? "canceled" :
                    error instanceof InvalidResponse ? "invalid_response" : "transport" };
        }
        finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener("abort", cancel);
        }
    }
}
