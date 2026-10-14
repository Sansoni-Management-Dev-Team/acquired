import { createHash, timingSafeEqual } from 'node:crypto';
export interface UnipileV1WebhookInput {
    /** Node request.rawHeaders, preserving duplicate header occurrences. */
    rawHeaders: readonly string[];
    /** Must match the custom header configured on the v1 webhook. */
    headerName: string;
    /** Separate webhook secret, never the API key. */
    secret: string;
}
/** Static-header authentication only. No payload signature, freshness or replay guarantee. */
export function verifyUnipileV1Webhook(input: UnipileV1WebhookInput): {
    verified: boolean;
} {
    const validValue = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\r\n\u0000]/.test(value);
    if (!validValue(input.secret) || !validValue(input.headerName) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(input.headerName) ||
        !Array.isArray(input.rawHeaders) || input.rawHeaders.length % 2 !== 0 || input.rawHeaders.length > 2048)
        return { verified: false };
    const name = input.headerName.toLowerCase();
    let received: string | undefined;
    for (let i = 0; i < input.rawHeaders.length; i += 2) {
        if (typeof input.rawHeaders[i] !== 'string' || typeof input.rawHeaders[i + 1] !== 'string')
            return { verified: false };
        if (input.rawHeaders[i].toLowerCase() !== name)
            continue;
        if (received !== undefined || !validValue(input.rawHeaders[i + 1]))
            return { verified: false };
        received = input.rawHeaders[i + 1];
    }
    if (received === undefined)
        return { verified: false };
    // Fixed-size digests permit constant-time equality even for mismatched input lengths.
    const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
    return { verified: timingSafeEqual(digest(received), digest(input.secret)) };
}
