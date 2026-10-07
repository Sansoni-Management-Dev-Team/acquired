/** Use the configured public origin when running behind a reverse proxy.
 * Forwarded/Host headers must not choose the origin trusted for browser writes.
 */
export function hasTrustedRequestOrigin(request: Request): boolean {
  try {
    const configured = process.env.APP_URL;
    if (!configured && process.env.NODE_ENV === "production") return false;
    const expected = new URL(configured || request.url).origin;
    return request.headers.get("origin") === expected;
  } catch {
    return false;
  }
}

/** Resolve app-owned redirects independently of the proxy's listening address. */
export function appRedirectUrl(path: string, request: Request): URL {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Expected an app-relative redirect");
  const configured = process.env.APP_URL;
  if (!configured && process.env.NODE_ENV === "production") throw new Error("Missing public app URL");
  const origin = new URL(configured || request.url).origin;
  const destination = new URL(path, origin);
  if (destination.origin !== origin) throw new Error("Expected an app-relative redirect");
  return destination;
}
