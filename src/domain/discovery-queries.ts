// Preserve meaningful phrases and give each target type a turn before expanding it.
export function discoveryPhrases(term: string): string[] {
  const clean = (value: string) => value.replace(/\b(?:businesses serving|servicing|supplying)\b.*$/i, "")
    .replace(/\b(?:including|associated|specialist)\b/gi, " ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  const [head, tail] = term.split(":", 2);
  if (tail) {
    const context = head.match(/\b(?:coffin|casket|funeral)\b/i)?.[0] || clean(head);
    return tail.split(/,|;|\band\b/i).map(part => clean(`${context} ${part}`)).filter(Boolean);
  }
  const parts = term.split(/\(|\)|,|;|\bincluding\b/i).map(clean).filter(Boolean);
  return [...new Set(parts)].filter(part => part.length > 3);
}
export function focusedDiscoveryPhrases(terms: string[]) {
  const groups = terms.slice(0, 6).map(discoveryPhrases);
  return [...new Set(Array.from({ length: Math.max(0, ...groups.map(g => g.length)) }, (_, i) => groups.flatMap(g => g[i] ? [g[i]] : [])).flat())].slice(0, 18);
}
export function discoveryRole(phrase: string) {
  if (/\blaborator(?:y|ies)\b|\bcalibration\b|\btesting\b/i.test(phrase)) return "services";
  if (/\bmachining\b|\bCNC\b|\bfabrication\b|\bwelding\b/i.test(phrase)) return "";
  if (/\bmanufacturers?\b|\bsuppliers?\b|\bdistributors?\b/i.test(phrase)) return "";
  return "supplier";
}
