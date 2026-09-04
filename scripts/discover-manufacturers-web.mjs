#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import taxonomy from "../src/data/manufacturing-search-taxonomy.json" with { type: "json" };

const DEFAULT_CACHE = ".local-data/manufacturer-web-discovery-cache.json";
const DEFAULT_OUTPUT = ".local-data/manufacturer-web-discovery.json";
const DEFAULT_EXISTING = ".local-data/manufacturing-directories.json";
const STATE_NAMES = {
  ACT: "Australian Capital Territory",
  NSW: "New South Wales",
  NT: "Northern Territory",
  QLD: "Queensland",
  SA: "South Australia",
  TAS: "Tasmania",
  VIC: "Victoria",
  WA: "Western Australia",
};
const QUERY_TEMPLATES = [
  (category, state) => `site:.com.au "${category}" manufacturer "${state}"`,
  (category, state) => `site:.au "${category}" "we manufacture" "${state}"`,
  (category, state) => `"${category}" "made in Australia" "${state}" Australia`,
  (category, state) => `"${category}" "manufacturing facility" "${state}" Australia`,
  (category, state) => `"Australian manufacturer" "${category}" "${state}"`,
  (category, state) => `"${category}" "our factory" "${state}" Australia`,
];
const EXCLUDED_HOSTS = [
  "amazon.", "australianexporters.net", "australianmade.com.au", "australianmanufacturing.com.au",
  "ausmanufacturingdirectory.com", "bing.com", "business.gov.au", "directory.gov.au", "ebay.",
  "facebook.com", "google.com", "hotfrog.com", "industrysearch.com.au", "instagram.com", "linkedin.com",
  "alibaba.com", "dlook.com.au", "europages.", "gumtree.com.au", "hipages.com.au", "indiamart.com",
  "hubs.com", "jooble.org", "list4all.com", "made-in-china.com", "machines4u.com.au", "oneflare.com.au", "pinterest.com", "reddit.com",
  "seek.com.au", "thomasnet.com", "truelocal.com.au", "wikipedia.org", "wordofmouth.com.au", "x.com",
  "yellowpages.com.au", "yelp.", "youtube.com", "zoominfo.com",
];
const POSITIVE_EVIDENCE = [
  [35, /\bwe (?:design (?:and|&) )?manufacture\b/gi, "first-party manufacturing claim"],
  [30, /\b(?:australian|australia's) (?:owned )?manufacturer\b/gi, "Australian manufacturer claim"],
  [30, /\bmanufactur(?:ed|ing) (?:in|at) (?:australia|our|the)\b/gi, "Australian/local production claim"],
  [25, /\b(?:our|purpose[- ]built) (?:factory|manufacturing facility|production facility|plant)\b/gi, "production facility"],
  [22, /\bmanufacturer(?:s)? of\b/gi, "manufacturer-of claim"],
  [20, /\b(?:australian made|made in australia)\b/gi, "Australian-made claim"],
  [16, /\b(?:contract manufacturing|injection moulding|cnc machining|sheet metal fabrication|metal fabrication)\b/gi, "manufacturing capability"],
  [10, /\b(?:fabricat(?:e|es|ed|ing)|machin(?:e|es|ed|ing)|mould(?:s|ed|ing)|assemble[ds]?|production)\b/gi, "production process"],
];
const NEGATIVE_EVIDENCE = [
  [-24, /\b(?:recruitment|marketing agency|software consultancy|business consultant)\b/gi, "non-manufacturing service"],
  [-14, /\b(?:exclusive distributor|authorised distributor|importer|wholesaler)\b/gi, "distribution/import evidence"],
];

function sha(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function redact(value) {
  return String(value)
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[REDACTED]");
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function normalizeWhitespace(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeCandidateUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || EXCLUDED_HOSTS.some((excluded) => host === excluded.replace(/\.$/, "") || host.includes(excluded))) return null;
    if (/\.(?:pdf|docx?|xlsx?|zip)$/i.test(url.pathname)) return null;
    return { domain: host, website: `${url.protocol}//${url.host}/`, resultUrl: url.toString() };
  } catch { return null; }
}

function companyNameFromTitle(title, domain) {
  const cleaned = normalizeWhitespace(title)
    .replace(/^www\.[^\s]+\s*[›|:-]?\s*/i, "")
    .split(/\s+[|–—]\s+|\s+-\s+/)[0]
    .replace(/\b(?:home|homepage|official site)\b$/i, "")
    .trim();
  if (cleaned.length >= 2 && cleaned.length <= 120) return cleaned;
  return domain.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function companyNameFromMarkdown(markdown, fallback, domain) {
  const legalName = markdown.match(/\b([A-Z][A-Za-z0-9&'’. -]{2,80}\s(?:Pty\.?\s+Ltd\.?|Limited))\b/)?.[1];
  if (legalName) return normalizeWhitespace(legalName);
  const describedName = markdown.match(/\b([A-Z][A-Za-z0-9&'’. -]{2,60})\s+is (?:an?|the)\s+(?:Australian\s+)?(?:company|business|manufacturer)\b/)?.[1];
  if (describedName) return normalizeWhitespace(describedName);
  const titleName = companyNameFromTitle(fallback, domain);
  const brandPrefix = titleName.match(/^([A-Z][A-Za-z0-9&'’. -]{1,50})\s*:/)?.[1];
  return normalizeWhitespace(brandPrefix || titleName);
}

export function generateQueries({ categories = taxonomy, states = Object.keys(STATE_NAMES) } = {}) {
  return categories.flatMap((category) => states.flatMap((state) => QUERY_TEMPLATES.map((template, templateIndex) => {
    const stateName = STATE_NAMES[state] || state;
    const query = template(category, stateName);
    return { id: `query_${sha(query)}`, category, state, template: templateIndex + 1, query };
  })));
}

export function scoreManufacturingEvidence(text) {
  const normalized = normalizeWhitespace(text);
  const evidence = [];
  let score = 0;
  for (const [weight, pattern, label] of [...POSITIVE_EVIDENCE, ...NEGATIVE_EVIDENCE]) {
    pattern.lastIndex = 0;
    const matches = normalized.match(pattern);
    if (!matches?.length) continue;
    score += weight * Math.min(matches.length, 2);
    evidence.push({ label, weight, excerpt: matches[0] });
  }
  score = Math.max(0, Math.min(100, score));
  return { score, confidence: score >= 60 ? "high" : score >= 35 ? "medium" : "low", evidence };
}

export function scoreAustralianEvidence(text, domain) {
  const normalized = normalizeWhitespace(text);
  const evidence = [];
  let score = 0;
  if (domain.endsWith(".au")) { score += 35; evidence.push({ label: "Australian domain", weight: 35, excerpt: domain }); }
  const address = normalized.match(/\b(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+\d{4}\b/i)?.[0];
  if (address) { score += 35; evidence.push({ label: "Australian address", weight: 35, excerpt: address }); }
  const manufacturingClaim = normalized.match(/\b(?:manufactur(?:ed|ing)|made|factory|production facilit(?:y|ies))\b.{0,50}\bAustralia(?:n)?\b|\bAustralia(?:n)?\b.{0,50}\b(?:manufactur(?:ed|ing)|made|factory|production facilit(?:y|ies))\b/i)?.[0];
  if (manufacturingClaim) { score += 30; evidence.push({ label: "Australian production claim", weight: 30, excerpt: manufacturingClaim }); }
  const australianPhone = normalized.match(/\+61\s?[2-478]\b/)?.[0];
  if (australianPhone) { score += 20; evidence.push({ label: "Australian phone", weight: 20, excerpt: australianPhone }); }
  score = Math.min(100, score);
  return { score, confidence: score >= 60 ? "high" : score >= 30 ? "medium" : "low", evidence };
}

function stateFromText(text, fallback) {
  const abbreviation = text.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i)?.[1]?.toUpperCase();
  if (abbreviation) return abbreviation;
  const lower = text.toLowerCase();
  return Object.entries(STATE_NAMES).find(([, name]) => lower.includes(name.toLowerCase()))?.[0] || fallback || null;
}

function descriptionFromMarkdown(markdown) {
  return normalizeWhitespace(markdown.replace(/[#*_`>\[\]()]/g, " ")).slice(0, 500) || null;
}

function abnFromText(text) {
  const candidate = text.match(/\bABN\s*[:#]?\s*((?:\d[\s-]*){11})\b/i)?.[1]?.replace(/\D/g, "");
  return candidate?.length === 11 ? candidate : null;
}

class McpClient {
  constructor(configPath, serverName = "crawl4ai") {
    this.configPath = configPath;
    this.serverName = serverName;
    this.sequence = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
  }

  async start(searchProvider = "auto") {
    const configuration = await readJson(this.configPath, {});
    const server = configuration.mcpServers?.[this.serverName];
    if (!server?.command || !Array.isArray(server.args)) throw new Error(`MCP server ${this.serverName} was not found in ${this.configPath}`);
    const serverEnvironment = { ...(server.env || {}) };
    if (searchProvider === "duckduckgo") {
      delete serverEnvironment.GOOGLE_SEARCH_API_KEY;
      delete serverEnvironment.GOOGLE_SEARCH_CX;
      delete serverEnvironment.SEARXNG_URL;
    }
    this.process = spawn(server.command, server.args, {
      env: { ...process.env, ...serverEnvironment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this.onData(chunk));
    this.process.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-8_000); });
    this.process.on("exit", (code) => {
      for (const { reject } of this.pending.values()) reject(new Error(`MCP server exited with code ${code}: ${redact(this.stderr)}`));
      this.pending.clear();
    });
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "project-acquire-manufacturer-discovery", version: "1.0.0" },
    });
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  }

  onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(redact(message.error.message || JSON.stringify(message.error))));
      else pending.resolve(message.result);
    }
  }

  request(method, params = {}, timeoutMs = 120_000) {
    return new Promise((resolvePromise, reject) => {
      const id = this.sequence++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timeout });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async call(name, args, timeoutMs) {
    const result = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    if (result?.isError) throw new Error(redact(result.content?.map((item) => item.text).join("\n") || `${name} failed`));
    const text = result?.content?.find((item) => item.type === "text")?.text;
    if (!text || text.startsWith("ERROR")) throw new Error(redact(text || `${name} returned no content`));
    return JSON.parse(text);
  }

  close() { this.process?.kill(); }
}

function mergeSearchResults(searches) {
  const candidates = new Map();
  for (const search of Object.values(searches)) {
    if (search.status !== "complete") continue;
    for (const result of search.results || []) {
      const normalized = normalizeCandidateUrl(result.url);
      if (!normalized) continue;
      const current = candidates.get(normalized.domain) || {
        id: `web_${sha(normalized.domain)}`,
        name: companyNameFromTitle(result.title || "", normalized.domain),
        website: normalized.website,
        domain: normalized.domain,
        categories: [],
        states: [],
        queryIds: [],
        searchResults: [],
      };
      current.categories = [...new Set([...current.categories, search.category])];
      current.states = [...new Set([...current.states, search.state])];
      current.queryIds.push(search.id);
      if (current.searchResults.length < 8) current.searchResults.push({ title: result.title, url: normalized.resultUrl, snippet: result.snippet || "" });
      candidates.set(normalized.domain, current);
    }
  }
  return [...candidates.values()];
}

function existingDomainIndex(existing) {
  const index = new Map();
  for (const business of existing.businesses || []) {
    const normalized = normalizeCandidateUrl(business.website || "");
    if (normalized) index.set(normalized.domain, business.id);
  }
  return index;
}

export function candidateCrawlPriority(candidate) {
  const text = candidate.searchResults.map((result) => `${result.title || ""} ${result.snippet || ""}`).join("\n");
  const manufacturing = scoreManufacturingEvidence(text).score;
  const australian = scoreAustralianEvidence(text, candidate.domain).score;
  return {
    manufacturing,
    australian,
    score: manufacturing + australian + Math.min(candidate.queryIds.length, 10),
    eligible: manufacturing >= 10 && australian >= 30,
  };
}

function enrichCandidate(candidate, crawl, existingDomains) {
  const pages = crawl?.pages || [];
  const pageText = pages.map((page) => page.markdown || "").join("\n");
  const searchText = candidate.searchResults.map((result) => `${result.title || ""} ${result.snippet || ""}`).join("\n");
  const combined = `${pageText}\n${searchText}`;
  const assessment = scoreManufacturingEvidence(pageText);
  const australianAssessment = scoreAustralianEvidence(pageText, candidate.domain);
  const categoryScores = candidate.categories.map((category) => ({
    category,
    score: category.toLowerCase().split(/\W+/).filter((word) => word.length > 3).reduce((score, word) => score + (combined.toLowerCase().includes(word) ? 1 : 0), 0),
  })).sort((left, right) => right.score - left.score || left.category.localeCompare(right.category));
  return {
    ...candidate,
    name: companyNameFromMarkdown(pages[0]?.markdown || "", candidate.searchResults[0]?.title || candidate.name, candidate.domain),
    category: categoryScores[0]?.category || candidate.categories[0] || "manufacturing",
    state: stateFromText(combined, candidate.states.length === 1 ? candidate.states[0] : null),
    abn: abnFromText(combined),
    description: descriptionFromMarkdown(pages[0]?.markdown || candidate.searchResults[0]?.snippet || ""),
    manufacturingScore: assessment.score,
    manufacturingConfidence: assessment.confidence,
    manufacturingEvidence: assessment.evidence,
    australianScore: australianAssessment.score,
    australianConfidence: australianAssessment.confidence,
    australianEvidence: australianAssessment.evidence,
    crawledPages: pages.map((page) => page.url),
    existingBusinessId: existingDomains.get(candidate.domain) || null,
    sourceRecords: candidate.searchResults.map((result) => ({ source: "web-serp", sourceUrl: result.url })),
  };
}

function parseArguments(argv) {
  const options = {
    cache: DEFAULT_CACHE, output: DEFAULT_OUTPUT, existing: DEFAULT_EXISTING,
    config: resolve(homedir(), ".claude.json"), phase: "all", fresh: false,
    maxQueries: null, maxSites: null, resultsPerQuery: 10, maxPages: 6,
    searchDelayMs: 1200, crawlDelayMs: 500, states: [], categories: [], minScore: 35,
    searchProvider: "auto", concurrency: 3,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--cache") options.cache = argv[++index];
    else if (argument === "--output" || argument === "-o") options.output = argv[++index];
    else if (argument === "--existing") options.existing = argv[++index];
    else if (argument === "--mcp-config") options.config = argv[++index];
    else if (argument === "--phase") options.phase = argv[++index];
    else if (argument === "--fresh") options.fresh = true;
    else if (argument === "--max-queries") options.maxQueries = Number(argv[++index]);
    else if (argument === "--max-sites") options.maxSites = Number(argv[++index]);
    else if (argument === "--results-per-query") options.resultsPerQuery = Number(argv[++index]);
    else if (argument === "--max-pages") options.maxPages = Number(argv[++index]);
    else if (argument === "--search-delay-ms") options.searchDelayMs = Number(argv[++index]);
    else if (argument === "--search-provider") options.searchProvider = argv[++index];
    else if (argument === "--crawl-delay-ms") options.crawlDelayMs = Number(argv[++index]);
    else if (argument === "--min-score") options.minScore = Number(argv[++index]);
    else if (argument === "--concurrency") options.concurrency = Number(argv[++index]);
    else if (argument === "--state") options.states.push(argv[++index].toUpperCase());
    else if (argument === "--category") options.categories.push(argv[++index]);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!["queries", "search", "crawl", "report", "all"].includes(options.phase)) throw new Error("--phase must be queries, search, crawl, report, or all");
  if (!["auto", "duckduckgo"].includes(options.searchProvider)) throw new Error("--search-provider must be auto or duckduckgo");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 6) throw new Error("--concurrency must be an integer from 1 to 6");
  return options;
}

function help() {
  process.stdout.write(`Usage: pnpm discover:manufacturers -- [options]\n\nPhases: queries, search, crawl, report, all (default)\n\n  --max-queries N       Limit pending SERP queries\n  --max-sites N         Limit pending websites crawled\n  --state VIC           Repeat to restrict states\n  --category "..."      Repeat to restrict categories\n  --results-per-query N Default 10\n  --max-pages N         Crawl4AI pages per website (default 6)\n  --min-score N         Accepted manufacturing score (default 35)\n  --search-provider P  auto or duckduckgo (default auto)\n  --concurrency N       Parallel MCP workers, 1-6 (default 3)\n  --fresh               Ignore discovery cache\n  --cache PATH          Resumable cache JSON\n  --output PATH         Reviewed output JSON\n  --existing PATH       Existing directory dataset for domain deduplication\n  --mcp-config PATH     Claude MCP configuration (default ~/.claude.json)\n`);
}

function sleep(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) return help();
  const cachePath = resolve(options.cache);
  const outputPath = resolve(options.output);
  const existingPath = resolve(options.existing);
  const categories = options.categories.length ? options.categories : taxonomy;
  const states = options.states.length ? options.states : Object.keys(STATE_NAMES);
  const queries = generateQueries({ categories, states });
  const cache = options.fresh ? { version: 1, searches: {}, crawls: {} } : await readJson(cachePath, { version: 1, searches: {}, crawls: {} });
  cache.searches ||= {};
  cache.crawls ||= {};
  const clients = [];

  if (["search", "crawl", "all"].includes(options.phase)) {
    for (let index = 0; index < options.concurrency; index += 1) {
      const client = new McpClient(resolve(options.config));
      await client.start(options.searchProvider);
      clients.push(client);
    }
  }
  try {
    if (["search", "all"].includes(options.phase)) {
      const pending = queries.filter((query) => cache.searches[query.id]?.status !== "complete").slice(0, options.maxQueries ?? undefined);
      for (let index = 0; index < pending.length; index += options.concurrency) {
        const batch = pending.slice(index, index + options.concurrency);
        await Promise.all(batch.map(async (query, slot) => {
          try {
            const result = await clients[slot].call("search", { query: query.query, limit: options.resultsPerQuery, scrape_results: false }, 60_000);
            cache.searches[query.id] = { ...query, status: "complete", backend: result.backend, results: result.results || [], searchedAt: new Date().toISOString() };
          } catch (error) {
            const noResults = error.message.includes("No results found");
            cache.searches[query.id] = noResults
              ? { ...query, status: "complete", backend: options.searchProvider, results: [], searchedAt: new Date().toISOString() }
              : { ...query, status: "failed", error: redact(error.message), searchedAt: new Date().toISOString() };
          }
        }));
        await writeJsonAtomic(cachePath, cache);
        process.stderr.write(`[search] ${Math.min(index + batch.length, pending.length)}/${pending.length} ${batch.at(-1).state} ${batch.at(-1).category}\n`);
        if (options.searchDelayMs) await sleep(options.searchDelayMs);
      }
    }

    const relevantSearches = Object.fromEntries(queries.flatMap((query) => cache.searches[query.id] ? [[query.id, cache.searches[query.id]]] : []));
    const candidates = mergeSearchResults(relevantSearches);
    if (["crawl", "all"].includes(options.phase)) {
      const existing = await readJson(existingPath, { businesses: [] });
      const existingDomains = existingDomainIndex(existing);
      const pending = candidates
        .map((candidate) => ({ candidate, priority: candidateCrawlPriority(candidate) }))
        .filter(({ candidate, priority }) => priority.eligible && !existingDomains.has(candidate.domain) && cache.crawls[candidate.domain]?.status !== "complete")
        .sort((left, right) => right.priority.score - left.priority.score || left.candidate.domain.localeCompare(right.candidate.domain))
        .map(({ candidate }) => candidate)
        .slice(0, options.maxSites ?? undefined);
      for (let index = 0; index < pending.length; index += options.concurrency) {
        const batch = pending.slice(index, index + options.concurrency);
        await Promise.all(batch.map(async (candidate, slot) => {
          try {
            const crawl = await clients[slot].call("crawl", { url: candidate.website, max_depth: 1, max_pages: options.maxPages, only_main_content: true }, 180_000);
            cache.crawls[candidate.domain] = { status: "complete", crawledAt: new Date().toISOString(), pages: crawl.pages || [] };
          } catch (error) {
            cache.crawls[candidate.domain] = { status: "failed", crawledAt: new Date().toISOString(), error: redact(error.message), pages: [] };
          }
        }));
        await writeJsonAtomic(cachePath, cache);
        process.stderr.write(`[crawl] ${Math.min(index + batch.length, pending.length)}/${pending.length} ${batch.at(-1).domain}\n`);
        if (options.crawlDelayMs) await sleep(options.crawlDelayMs);
      }
    }

    if (["report", "crawl", "all"].includes(options.phase)) {
      const existing = await readJson(existingPath, { businesses: [] });
      const domains = existingDomainIndex(existing);
      const assessed = candidates.map((candidate) => enrichCandidate(candidate, cache.crawls[candidate.domain], domains));
      const accepted = assessed.filter((candidate) => candidate.manufacturingScore >= options.minScore && candidate.australianScore >= 30 && candidate.crawledPages.length > 0);
      const newBusinesses = accepted.filter((candidate) => !candidate.existingBusinessId);
      const result = {
        metadata: {
          generatedAt: new Date().toISOString(), queryUniverse: queries.length,
          searchesComplete: Object.values(relevantSearches).filter((search) => search.status === "complete").length,
          searchesFailed: Object.values(relevantSearches).filter((search) => search.status === "failed").length,
          uniqueDomainsDiscovered: candidates.length,
          websitesCrawled: Object.values(cache.crawls).filter((crawl) => crawl.status === "complete").length,
          acceptedManufacturers: accepted.length, newManufacturers: newBusinesses.length,
          existingDirectoryMatches: accepted.length - newBusinesses.length,
          minimumManufacturingScore: options.minScore,
        },
        newBusinesses,
        existingMatches: accepted.filter((candidate) => candidate.existingBusinessId),
        rejectedOrUncrawled: assessed.filter((candidate) => candidate.manufacturingScore < options.minScore || candidate.australianScore < 30 || !candidate.crawledPages.length),
      };
      await writeJsonAtomic(outputPath, result);
      process.stdout.write(`${JSON.stringify(result.metadata, null, 2)}\nSaved ${outputPath}\n`);
    } else if (options.phase === "queries") {
      process.stdout.write(`${JSON.stringify({ count: queries.length, queries }, null, 2)}\n`);
    }
  } finally {
    clients.forEach((client) => client.close());
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) run().catch((error) => { process.stderr.write(`${redact(error.stack || error.message)}\n`); process.exitCode = 1; });
