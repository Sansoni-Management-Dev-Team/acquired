import { z } from "zod";
const company = z.object({ primary_domain: z.string().nullish(), website_url: z.string().nullish() }).passthrough();
const person = z.object({ id: z.string(), name: z.string().nullish(), title: z.string().nullish(), linkedin_url: z.string().nullish(), organization: company.nullish() }).passthrough();
const domainOf = (value: string) => { try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
export type ApolloPerson = { id: string; name: string; role: string; sourceUrl: string };
export async function findApolloPeople(domain: string, apiKey = process.env.APOLLO_API_KEY || "", fetcher: typeof fetch = fetch) {
  if (!apiKey) throw new Error("APOLLO_API_KEY is not configured on the server.");
  const targetDomain = domainOf(domain);
  if (!targetDomain || !targetDomain.includes(".")) throw new Error("A company website is required for Apollo search.");
  async function post(path: string, body: unknown) {
    const response = await fetcher(`https://api.apollo.io/api/v1/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Api-Key": apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Apollo lookup failed (${response.status}). Check API access, credits and rate limits.`);
    return response.json();
  }
  const search = z.object({ people: z.array(z.object({ id: z.string(), title: z.string().nullish() })).default([]) }).parse(await post("mixed_people/api_search", { q_organization_domains_list: [targetDomain], person_titles: ["owner", "founder", "director", "CEO", "general manager"], include_similar_titles: true, page: 1, per_page: 25 }));
  const priority = (title: string) => /owner|founder|managing director/i.test(title) ? 0 : /director|\bCEO\b|chief executive/i.test(title) ? 1 : 2;
  const candidates = [...new Map(search.people.map(p => [p.id, p])).values()].sort((a,b) => priority(a.title || "") - priority(b.title || "")).slice(0,5);
  const results = await Promise.allSettled(candidates.map(async candidate => {
    const { person: p } = z.object({ person: person.nullable() }).parse(await post("people/match", { id: candidate.id, reveal_personal_emails: false, reveal_phone_number: false }));
    // Domain searches can include past employers. Require the current organization to match.
    if (!p?.name || !p.title || /\*|obfuscated/i.test(p.name) || !/\s/.test(p.name.trim()) || domainOf(p.organization?.primary_domain || p.organization?.website_url || "") !== targetDomain) return null;
    if (!/owner|founder|director|\bCEO\b|chief executive|general manager/i.test(p.title)) return null;
    return { id: p.id, name: p.name, role: p.title, sourceUrl: `https://app.apollo.io/#/people/${encodeURIComponent(p.id)}` } satisfies ApolloPerson;
  }));
  return { people: results.flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []), searched: search.people.length, failed: results.filter(r => r.status === "rejected").length };
}
