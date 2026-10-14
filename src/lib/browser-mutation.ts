import { hasTrustedRequestOrigin } from './request-origin';

/** These endpoints have their own bearer/webhook/Better Auth boundary. A bearer
 * header alone never exempts a browser-facing API from Origin validation. */
const independentBoundaries = [
  '/api/auth/', '/api/internal/', '/api/research/internal/', '/api/firmable/internal/',
];
export function guardBrowserMutation(request: Request): Response | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  const path = new URL(request.url).pathname;
  if (independentBoundaries.some(prefix => path.startsWith(prefix)) || path === '/api/inbound/reply') return null;
  const deny = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!hasTrustedRequestOrigin(request)) return deny('Invalid origin', 403);
  // DELETE operations need no body, but still require a trusted Origin.
  if (request.body !== null && request.method !== 'DELETE' && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return deny('Expected application/json', 415);
  return null;
}
