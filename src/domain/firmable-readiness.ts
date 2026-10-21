type FirmableEnvironment = Readonly<Record<string, string | undefined>>;
const configured = (value: string | undefined) => Boolean(value?.trim());

/** Configuration readiness only: no provider calls or credential validity claim.
 * Match the selected FirmableClient transport; a partial session configuration
 * must never fall back to a legacy direct key. */
export function firmableEnrichmentConfigured(env: FirmableEnvironment): boolean {
  if (env.TARGET_DATA_PROVIDER === 'fixture') return true;
  if (env.TARGET_DATA_PROVIDER !== 'live') return false;
  if (env.FIRMABLE_TRANSPORT === 'cloudflare-session') {
    return configured(env.FIRMABLE_SERVICE_URL) && configured(env.FIRMABLE_SERVICE_SECRET);
  }
  return configured(env.FIRMABLE_API_KEY);
}
