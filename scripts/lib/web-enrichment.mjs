import { createHash } from "node:crypto";
import { z } from "zod";

const id = (value) => createHash("sha256").update(value).digest("hex").slice(0, 20);
const host = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const tokens = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
const compact = (s) => s.replace(/\s+/g, " ").trim();

export const profileSchema = z.object({
  schemaVersion: z.literal(2),
  companyId: z.string(),
  identity: z.object({ name: z.string(), domain: z.string(), website: z.string(), category: z.string(), state: z.string().nullable() }),
  observations: z.array(z.object({
    id: z.string(), field: z.enum(["headcount", "revenue", "foundedYear", "abn"]),
    value: z.object({ kind: z.enum(["point", "range", "lower_bound", "upper_bound"]), min: z.number().nonnegative().nullable(), max: z.number().nonnegative().nullable(), minInclusive: z.boolean(), maxInclusive: z.boolean(), currency: z.enum(["AUD", "USD"]).nullable(), scope: z.enum(["unknown", "global", "AU"]), text: z.string().optional() }),
    status: z.enum(["accepted", "rejected"]), reason: z.string(), verified: z.literal(false),
    source: z.object({ url: z.string(), kind: z.enum(["first-party", "third-party"]), retrievalIds: z.array(z.string()), asOf: z.null() }),
    evidence: z.string(),
  })),
  resolvedProfile: z.record(z.string(), z.object({
    observationId: z.string(), value: z.unknown(), method: z.literal("source_priority"),
    conflictingEvidence: z.boolean(), alternativeObservationIds: z.array(z.string()),
    verification: z.literal("unverified"),
  }).nullable()),
  estimates: z.object({ revenue: z.null(), ebitda: z.null(), reason: z.string() }),
  enrichment: z.object({ status: z.literal("web_enriched"), extractorVersion: z.literal("2.0.0"), processedAt: z.string(), limitations: z.array(z.string()) }),
}).superRefine((profile, ctx) => {
  const ids = new Set(profile.observations.map((o) => o.id));
  if (ids.size !== profile.observations.length) ctx.addIssue({ code: "custom", message: "Duplicate observation IDs" });
  for (const selected of Object.values(profile.resolvedProfile).filter(Boolean)) {
    const o = profile.observations.find((item) => item.id === selected.observationId);
    if (!o || o.status !== "accepted" || JSON.stringify(o.value) !== JSON.stringify(selected.value)) ctx.addIssue({ code: "custom", message: "Resolution must reference an accepted observation and its value" });
    if (!selected.alternativeObservationIds.every((key) => ids.has(key))) ctx.addIssue({ code: "custom", message: "Unknown alternative observation" });
  }
});

export function entityMatch(doc, company) {
  const sourceHost = host(doc.url);
  if (sourceHost === company.domain || sourceHost.endsWith(`.${company.domain}`)) return { matched: true, reason: "company_domain", kind: "first-party" };
  const foreign = /\b(?:Venezuela|Caracas|Vietnam|Zurich|Portland,? Oregon)\b/i.test(doc.text);
  if (foreign) return { matched: false, reason: "conflicting_geography", kind: "third-party" };
  // A mentions-only match is insufficient: require the domain as a complete token,
  // or a company-specific URL plus Australian context.
  const escaped = company.domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const domainMatch = new RegExp(`(?<![a-z0-9.-])(?:www\\.)?${escaped}(?![a-z0-9.-])`, "i").test(doc.text);
  const distinctive = tokens(company.name).filter((word) => word.length > 2 && !["pty", "ltd", "products", "manufacturing", "electronics", "australia"].includes(word));
  const pathTokens = tokens(doc.url);
  const nameMatch = distinctive.length > 0 && distinctive.every((word) => pathTokens.includes(word));
  const australian = /\b(?:Australia|Australian|NSW|QLD|VIC|Somersby|Sydney|Melbourne|Orange|Bayswater|Canning Vale|Crestmead|Keysborough|Rocklea|South Australia|Western Australia|Queensland|Victoria)\b/i.test(doc.text);
  return { matched: domainMatch || (nameMatch && australian), reason: domainMatch ? "domain_in_evidence" : nameMatch && australian ? "company_url_and_australian_context" : "insufficient_company_identity", kind: "third-party" };
}

export function validAbn(value) {
  if (!/^\d{11}$/.test(value)) return false;
  const digits = [...value].map(Number); digits[0] -= 1;
  return digits.reduce((sum, digit, i) => sum + digit * [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19][i], 0) % 89 === 0;
}

const quantity = (kind, min, max, extra = {}) => ({ kind, min, max, minInclusive: true, maxInclusive: true, currency: null, scope: "unknown", ...extra });

export function normalizeCompany(company, documents) {
  const observations = new Map();
  for (const doc of documents) {
    const identity = entityMatch(doc, company);
    const text = compact(doc.text);
    const add = (field, value, match, rejection = null) => {
      const evidence = text.slice(Math.max(0, match.index - 110), match.index + match[0].length + 120);
      const key = id(JSON.stringify([doc.url, field, value]));
      const prior = observations.get(key);
      if (prior) { prior.source.retrievalIds = [...new Set([...prior.source.retrievalIds, doc.id])]; return; }
      const reason = !identity.matched ? identity.reason : rejection || identity.reason;
      observations.set(key, { id: key, field, value, status: !identity.matched || rejection ? "rejected" : "accepted", reason, verified: false,
        source: { url: doc.url, kind: identity.kind, retrievalIds: [doc.id], asOf: null }, evidence });
    };
    // One expression consumes a whole quantity, preserving <, >, + and ranges.
    const employee = /(?<![\d,])(?:(over|more than|at least|under|less than|fewer than|approximately|around|about|nearly|<|>)\s*)?(\d[\d,]*)(?:\s*(?:-|–|—|to)\s*(\d[\d,]*))?(\+)?\s+(employees?|staff|team members?|people)\b/gi;
    for (const match of text.matchAll(employee)) {
      const n = Number(match[2].replaceAll(",", ""));
      const end = match[3] ? Number(match[3].replaceAll(",", "")) : null;
      const qualifier = (match[1] || "").toLowerCase();
      let value = quantity("point", n, n);
      if (end !== null) value = quantity("range", n, end);
      else if (match[4] || ["over", "more than", "at least", ">"].includes(qualifier)) value = quantity("lower_bound", n, null, { minInclusive: Boolean(match[4]) || qualifier === "at least" });
      else if (["under", "less than", "fewer than", "<"].includes(qualifier)) value = quantity("upper_bound", null, n, { maxInclusive: false });
      const context = text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 70);
      let rejection = /salary estimated|past and present job|view all|users,|reviews from/i.test(context) ? "sample_or_profile_count_not_company_headcount" : null;
      if (match[5].toLowerCase() === "people" && !/employ|team|workforce/i.test(context)) rejection = "people_count_without_employment_context";
      if (n < 1 || n > 1000000 || (end !== null && end < n)) rejection = "invalid_range";
      // Scope must be attached to the employee claim, never inferred from HQ.
      if (/\b(?:globally|worldwide)\b/i.test(match[0] + text.slice(match.index + match[0].length, match.index + match[0].length + 25))) value.scope = "global";
      if (/^(?:\s+based)?\s+in Australia\b/i.test(text.slice(match.index + match[0].length))) value.scope = "AU";
      add("headcount", value, match, rejection);
    }
    for (const match of text.matchAll(/(AUD\s*\$?|A\$|USD\s*\$?|US\$|\$)\s*([\d,.]+)\s*(million|billion|[MB])?\s+(?:in\s+)?(?:annual\s+)?revenues?\b/gi)) {
      const scale = /^(million|m)$/i.test(match[3] || "") ? 1e6 : /^(billion|b)$/i.test(match[3] || "") ? 1e9 : 1;
      const n = Number(match[2].replaceAll(",", "")) * scale;
      add("revenue", quantity("point", n, n, { currency: /^(AUD|A\$)/i.test(match[1]) ? "AUD" : /^(USD|US\$)/i.test(match[1]) ? "USD" : null }), match);
    }
    for (const match of text.matchAll(/\b(founded|established|year of establishment|since)\s*[:·]?\s*(?:in\s+)?((?:18|19|20)\d{2})\b/gi)) {
      add("foundedYear", quantity("point", Number(match[2]), Number(match[2])), match, /^since$/i.test(match[1]) ? "since_does_not_establish_founding" : null);
    }
    for (const match of text.matchAll(/\bABN\s*[:#]?\s*((?:\d[\s-]*){11})\b/gi)) {
      const value = match[1].replace(/\D/g, "");
      add("abn", quantity("point", null, null, { text: value }), match, validAbn(value) ? null : "invalid_abn_checksum");
    }
  }
  const all = [...observations.values()];
  const resolvedProfile = {};
  // Deterministic preference, not a calibrated accuracy score. Separate scopes
  // prevent AU and global employee counts from overwriting each other.
  const priority = (o) => o.source.kind === "first-party" ? 0 : /(^|\.)linkedin\.com$/.test(host(o.source.url)) ? 1 : /(^|\.)zoominfo\.com$/.test(host(o.source.url)) ? 2 : 3;
  for (const key of ["headcount", "headcountAU", "headcountGlobal", "revenue", "foundedYear", "abn"]) {
    const field = key.startsWith("headcount") ? "headcount" : key;
    const scope = key === "headcountAU" ? "AU" : key === "headcountGlobal" ? "global" : "unknown";
    const candidates = all.filter((o) => o.field === field && o.status === "accepted" && (field !== "headcount" || o.value.scope === scope));
    candidates.sort((a, b) => priority(a) - priority(b) || a.source.url.localeCompare(b.source.url));
    const best = candidates[0];
    resolvedProfile[key] = best ? { observationId: best.id, value: best.value, method: "source_priority", verification: "unverified",
      conflictingEvidence: candidates.some((o) => JSON.stringify(o.value) !== JSON.stringify(best.value)), alternativeObservationIds: candidates.slice(1).map((o) => o.id) } : null;
  }
  const profile = { schemaVersion: 2, companyId: company.id,
    identity: { name: company.name, domain: company.domain, website: company.website, category: company.category, state: company.state || null },
    observations: all, resolvedProfile,
    estimates: { revenue: null, ebitda: null, reason: "No validated industry benchmarks applied" },
    enrichment: { status: "web_enriched", extractorVersion: "2.0.0", processedAt: new Date().toISOString(), limitations: ["Source reporting dates and independence are unknown", "Acceptance means relevant claim, not verified company fact", "Geographic scope remains unknown unless explicit"] } };
  return profileSchema.parse(profile);
}

export function normalizePilot(raw) {
  const retrievals = [];
  const results = raw.results.map((company) => {
    const docs = [];
    const add = (url, text, method, query = null, retrievedAt = null, backend = "unknown") => {
      if (!url || !text) return;
      const record = { id: id(JSON.stringify([company.id, url, text, method, query])), companyId: company.id, url, text, method, query,
        retrievedAt, batchCompletedAt: raw.generatedAt || null, backend, tool: "crawl4ai" };
      retrievals.push(record); docs.push(record);
    };
    for (const search of company.searches || []) for (const r of search.results || []) add(r.url, `${r.title || ""} ${r.snippet || ""}`, "serp_snippet", search.query, search.retrievedAt || null, search.backend || "unknown");
    for (const page of company.rawPages || []) add(page.url, page.markdown, "page_crawl", null, page.retrievedAt || null);
    // The original pilot discarded page bodies; retain its surviving excerpts.
    for (const o of [...(company.headcountEvidence || []), company.foundedYear, company.abn].filter(Boolean)) add(o.sourceUrl, o.excerpt, "legacy_excerpt");
    return normalizeCompany(company, docs);
  });
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), summary: { companies: results.length,
    companiesWithAcceptedHeadcountClaims: results.filter((r) => r.resolvedProfile.headcount).length,
    rejectedObservations: results.flatMap((r) => r.observations).filter((o) => o.status === "rejected").length,
    verifiedCompanies: 0 }, retrievals, results };
}
