/** Preserve valid historical criteria when one generated numeric field contains markup.
 * This is a read-time view; no saved records are rewritten. */
export function readableStoredBrief(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('criteria' in value) || !Array.isArray(value.criteria)) return value;
  return { ...value, criteria: value.criteria.map(c => {
    if (!c || typeof c !== 'object' || typeof c.key !== 'string' || typeof c.value !== 'string') return c;
    return ['revenue', 'revenueCeiling', 'ebitda', 'headcount'].includes(c.key) && /<\/?[a-z][^>]*>/i.test(c.value)
      ? { ...c, value: '', state: 'unknown', confirmed: false } : c;
  }) };
}
