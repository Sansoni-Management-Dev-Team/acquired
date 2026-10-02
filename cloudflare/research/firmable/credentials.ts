import { ServiceError } from './transport';
export type Credentials = { cookie: string; sessionId: string; organizationId: string };
export function validCredentials(value: Credentials) {
  return typeof value.cookie === 'string' && value.cookie.length > 20 && value.cookie.length < 10_000 && !/[\r\n;,\s]/.test(value.cookie)
    && /^sess_[A-Za-z0-9]+$/.test(value.sessionId) && /^org_[A-Za-z0-9]+$/.test(value.organizationId);
}
async function key(secret: string) {
  if (!secret || secret.length < 32) throw new ServiceError(503, 'not_configured');
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value: Credentials, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), new TextEncoder().encode(JSON.stringify(value)));
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
}
export async function unseal(value: Awaited<ReturnType<typeof seal>>, secret: string): Promise<Credentials> {
  const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv) }, await key(secret), new Uint8Array(value.data));
  return JSON.parse(new TextDecoder().decode(decoded));
}
