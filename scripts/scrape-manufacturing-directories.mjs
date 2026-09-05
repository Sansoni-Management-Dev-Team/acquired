#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const AUSTRALIAN_MANUFACTURING = "australian-manufacturing";
const AMTIL = "amtil";
const DEFAULT_OUTPUT = ".local-data/manufacturing-directories.json";
const DEFAULT_CACHE = ".local-data/manufacturing-directories-cache.json";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0 Safari/537.36 ProjectAcquireDirectoryResearch/1.0";

const SOURCE_CONFIG = {
  [AUSTRALIAN_MANUFACTURING]: {
    baseUrl: "https://www.australianmanufacturing.com.au",
    crawlDelayMs: 20_000,
  },
  [AMTIL]: {
    baseUrl: "https://amtil.com.au",
    crawlDelayMs: 10_000,
  },
};

const ENTITY_SUFFIXES = new Set([
  "australia",
  "australian",
  "company",
  "limited",
  "ltd",
  "pty",
]);

function decodeHtml(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    rsquo: "’",
  };

  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, entity) => named[entity.toLowerCase()] ?? match);
}

function cleanText(value = "") {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value.trim()));
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function firstMatch(value, pattern, group = 1) {
  return value.match(pattern)?.[group] ?? null;
}

function normalizeName(value = "") {
  const tokens = decodeHtml(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);

  while (tokens.length > 1 && ENTITY_SUFFIXES.has(tokens.at(-1))) tokens.pop();
  return tokens.join(" ");
}

function normalizeDomain(value) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (
      hostname.endsWith("australianmanufacturing.com.au") ||
      hostname.endsWith("amtil.com.au") ||
      hostname.endsWith("facebook.com") ||
      hostname.endsWith("instagram.com") ||
      hostname.endsWith("linkedin.com") ||
      hostname.endsWith("x.com")
    ) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

function normalizePhone(value) {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("61") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  return digits.length >= 8 ? digits : null;
}

function normalizeEmail(value) {
  const email = value?.trim().toLowerCase();
  return email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

function parseAustralianAddress(address = "") {
  const stateNames = {
    "australian capital territory": "ACT",
    "new south wales": "NSW",
    "northern territory": "NT",
    queensland: "QLD",
    "south australia": "SA",
    tasmania: "TAS",
    victoria: "VIC",
    "western australia": "WA",
  };
  const abbreviationMatch = address.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
  const normalizedAddress = address.toLowerCase();
  const fullName = Object.keys(stateNames).find((name) => normalizedAddress.includes(name));
  const postcodeMatches = [...address.matchAll(/(?:^|\D)(\d{4})(?!\d)/g)];
  return {
    state: abbreviationMatch?.[1]?.toUpperCase() ?? (fullName ? stateNames[fullName] : null),
    postcode: postcodeMatches.at(-1)?.[1] ?? null,
  };
}

function uniqueStrings(...collections) {
  return [...new Set(collections.flat().filter(Boolean).map((value) => cleanText(String(value))))];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

export function parseAustralianManufacturingDetail(html) {
  const listing = firstMatch(
    html,
    /(<div id="wpbdp-listing-[\s\S]*?)<script type="application\/ld\+json">/i,
  ) ?? html;
  const fields = {};
  const fieldPattern =
    /<div class="[^"]*wpbdp-field-display[^"]*"[^>]*>\s*<span class="field-label">([\s\S]*?)<\/span>\s*<div class="value">([\s\S]*?)<\/div>\s*<\/div>/gi;

  for (const match of listing.matchAll(fieldPattern)) {
    const [, rawLabel, rawValue] = match;
    const label = cleanText(rawLabel);
    const key = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    fields[key] = {
      label,
      text: cleanText(rawValue),
      hrefs: [...rawValue.matchAll(/href=["']([^"']+)["']/gi)]
        .map((hrefMatch) => cleanUrl(hrefMatch[1]))
        .filter(Boolean),
    };
  }

  const websiteField = fields.website;
  const address = fields.main_address?.text || null;
  const { state, postcode } = parseAustralianAddress(address ?? "");
  const imageUrl = cleanUrl(
    firstMatch(listing, /class="[^"]*listing-thumbnail[\s\S]*?<img[^>]+data-src="([^"]+)"/i),
  );

  return {
    address,
    categories: fields.category?.text ? [fields.category.text] : [],
    description: fields.business_description?.text || null,
    email: fields.email?.text || null,
    extraFields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value.text]),
    ),
    imageUrl,
    keywords: fields.keywords_comma_separated?.text
      ?.split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean) ?? [],
    phone: fields.phone?.text || null,
    postcode,
    state,
    website: websiteField?.hrefs.find((href) => normalizeDomain(href)) ?? null,
  };
}

export function parseAmtilDirectory(html) {
  const records = [];
  const rows = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const rowMatch of rows) {
    const row = rowMatch[1];
    const linkMatch = row.match(
      /<a[^>]+href=["'](https:\/\/amtil\.com\.au\/manufacturelink\/([^"'#?]+)\/)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) continue;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    const location = cleanText(cells.at(-1)?.[1] ?? "") || null;
    const { state, postcode } = parseAustralianAddress(location ?? "");
    records.push({
      name: cleanText(linkMatch[3]),
      sourceId: linkMatch[2],
      sourceUrl: cleanUrl(linkMatch[1]),
      location,
      state,
      postcode,
    });
  }

  return [...new Map(records.map((record) => [record.sourceUrl, record])).values()];
}

export function parseAmtilDetail(html) {
  const detail = firstMatch(
    html,
    /(<div class="manufacturedetails">[\s\S]*?)<footer id="colophon"/i,
  ) ?? html;
  const detailsBlock = firstMatch(
    detail,
    /<div class="company-details">([\s\S]*?)<div class="company-social-links">/i,
  ) ?? "";
  const contact = cleanText(firstMatch(detailsBlock, /<strong>([\s\S]*?)<\/strong>/i) ?? "");
  const contactParts = contact.split(/\s+-\s+/, 2);
  const address = cleanText(firstMatch(detailsBlock, /<p class="add">([\s\S]*?)<\/p>/i) ?? "") || null;
  const { state, postcode } = parseAustralianAddress(address ?? "");
  const capabilities = {};

  for (const match of detail.matchAll(
    /<div class="capability-block">\s*<h3>([\s\S]*?)<\/h3>([\s\S]*?)<\/div>/gi,
  )) {
    const label = cleanText(match[1]);
    const values = cleanText(match[2])
      .split(/,|\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (label) capabilities[label] = values;
  }

  const descriptionHtml = firstMatch(
    detail,
    /<div class="company-desc">([\s\S]*?)<script>\s*jQuery\(document\)/i,
  );
  const socialLinksHtml = firstMatch(
    detail,
    /<div class="company-social-links">([\s\S]*?)<div class="company-user_img">/i,
  ) ?? "";
  const socialLinks = [...socialLinksHtml.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)]
    .map((match) => cleanUrl(match[1]))
    .filter(Boolean);
  const contactImageUrl = cleanUrl(
    firstMatch(detail, /<div class="company-user_img">[\s\S]*?<img[^>]+src=["']([^"']+)["']/i),
  );
  const videoUrls = [...detail.matchAll(/data-video-url=["']([^"']+)["']/gi)]
    .map((match) => cleanUrl(match[1]))
    .filter(Boolean);

  return {
    address,
    capabilities,
    contactName: contactParts[0] || null,
    contactTitle: contactParts[1] || null,
    contactImageUrl,
    description: cleanText(descriptionHtml ?? "") || null,
    email: decodeHtml(firstMatch(detailsBlock, /href=["']mailto:([^"']+)["']/i) ?? "") || null,
    imageUrl: cleanUrl(
      firstMatch(detail, /<div class="company-logo">[\s\S]*?<img[^>]+src=["']([^"']+)["']/i),
    ),
    phone: cleanText(firstMatch(detailsBlock, /href=["']tel:[^"']+["'][^>]*>([\s\S]*?)<\/a>/i) ?? "") || null,
    postcode,
    state,
    socialLinks,
    videoUrls,
    website: cleanUrl(firstMatch(detailsBlock, /<a[^>]+class=["'][^"']*globe[^"']*["'][^>]+href=["']([^"']+)["']/i))
      ?? cleanUrl(firstMatch(detailsBlock, /<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*globe/i)),
  };
}

function mergeCapabilities(left = {}, right = {}) {
  const result = { ...left };
  for (const [key, values] of Object.entries(right)) {
    result[key] = uniqueStrings(result[key] ?? [], values);
  }
  return result;
}

function bestText(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function candidateKeys(record) {
  const domain = normalizeDomain(record.website);
  const email = normalizeEmail(record.email);
  const phone = normalizePhone(record.phone);
  const name = normalizeName(record.name);
  const area = record.postcode || record.state || "";
  return [
    domain && `domain:${domain}`,
    email && `email:${email}`,
    phone && name && `phone-name:${phone}:${name}`,
    name && area && `name-area:${name}:${area.toLowerCase()}`,
  ].filter(Boolean);
}

function toSourceRecord(record) {
  return {
    ...record.sourceRecord,
    data: {
      name: record.name,
      website: record.website ?? null,
      phone: record.phone ?? null,
      email: record.email ?? null,
      address: record.address ?? null,
      listedLocation: record.location ?? null,
      state: record.state ?? null,
      postcode: record.postcode ?? null,
      briefDescription: record.briefDescription ?? null,
      description: record.description ?? null,
      imageUrl: record.imageUrl ?? null,
      categories: uniqueStrings(record.categories ?? []),
      keywords: uniqueStrings(record.keywords ?? []),
      capabilities: record.capabilities ?? {},
      contactName: record.contactName ?? null,
      contactTitle: record.contactTitle ?? null,
      contactImageUrl: record.contactImageUrl ?? null,
      socialLinks: uniqueStrings(record.socialLinks ?? []),
      videoUrls: uniqueStrings(record.videoUrls ?? []),
      extraFields: record.extraFields ?? {},
    },
  };
}

function toMergedRecord(record) {
  return {
    id: `manufacturer_${sha256(candidateKeys(record)[0] ?? normalizeName(record.name))}`,
    name: record.name,
    website: record.website ?? null,
    phone: record.phone ?? null,
    email: record.email ?? null,
    address: record.address ?? record.location ?? null,
    state: record.state ?? null,
    postcode: record.postcode ?? null,
    description: record.description ?? record.briefDescription ?? null,
    imageUrl: record.imageUrl ?? null,
    categories: uniqueStrings(record.categories ?? []),
    keywords: uniqueStrings(record.keywords ?? []),
    capabilities: record.capabilities ?? {},
    socialLinks: uniqueStrings(record.socialLinks ?? []),
    videoUrls: uniqueStrings(record.videoUrls ?? []),
    contactPeople: record.contactName
      ? [{
          name: record.contactName,
          title: record.contactTitle ?? null,
          imageUrl: record.contactImageUrl ?? null,
        }]
      : [],
    sourceRecords: [toSourceRecord(record)],
    duplicateMatchKeys: [],
  };
}

export function deduplicateBusinesses(records) {
  const merged = [];
  const keyToIndex = new Map();

  for (const record of records) {
    const keys = candidateKeys(record);
    const existingIndex = keys.map((key) => keyToIndex.get(key)).find((index) => index !== undefined);

    if (existingIndex === undefined) {
      const index = merged.push(toMergedRecord(record)) - 1;
      for (const key of keys) keyToIndex.set(key, index);
      continue;
    }

    const existing = merged[existingIndex];
    const matchedKeys = keys.filter((key) => keyToIndex.get(key) === existingIndex);
    existing.name = bestText(existing.name, record.name);
    existing.website ??= record.website ?? null;
    existing.phone ??= record.phone ?? null;
    existing.email ??= record.email ?? null;
    existing.address = bestText(existing.address, record.address ?? record.location);
    existing.state ??= record.state ?? null;
    existing.postcode ??= record.postcode ?? null;
    existing.description = bestText(
      existing.description,
      record.description ?? record.briefDescription,
    );
    existing.imageUrl ??= record.imageUrl ?? null;
    existing.categories = uniqueStrings(existing.categories, record.categories ?? []);
    existing.keywords = uniqueStrings(existing.keywords, record.keywords ?? []);
    existing.capabilities = mergeCapabilities(existing.capabilities, record.capabilities);
    existing.socialLinks = uniqueStrings(existing.socialLinks, record.socialLinks ?? []);
    existing.videoUrls = uniqueStrings(existing.videoUrls, record.videoUrls ?? []);
    if (record.contactName) {
      existing.contactPeople.push({
        name: record.contactName,
        title: record.contactTitle ?? null,
        imageUrl: record.contactImageUrl ?? null,
      });
    }
    existing.sourceRecords.push(toSourceRecord(record));
    existing.duplicateMatchKeys = uniqueStrings(existing.duplicateMatchKeys, matchedKeys);
    for (const key of keys) keyToIndex.set(key, existingIndex);
  }

  return merged;
}

class RespectfulFetcher {
  constructor() {
    this.lastRequestAt = new Map();
  }

  async fetch(url, crawlDelayMs) {
    const host = new URL(url).host;
    const elapsed = Date.now() - (this.lastRequestAt.get(host) ?? 0);
    if (elapsed < crawlDelayMs) await sleep(crawlDelayMs - elapsed);

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      this.lastRequestAt.set(host, Date.now());
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json,text/html", "User-Agent": USER_AGENT },
          redirect: "follow",
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) return response;
        if (![429, 500, 502, 503, 504].includes(response.status)) {
          throw new Error(`${response.status} ${response.statusText} for ${url}`);
        }
        lastError = new Error(`${response.status} ${response.statusText} for ${url}`);
      } catch (error) {
        lastError = error;
      }

      await sleep(crawlDelayMs * attempt);
    }
    throw lastError;
  }
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readCache(cachePath, fresh) {
  if (fresh) return { version: 1, sources: {} };
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    return cache.version === 1 ? cache : { version: 1, sources: {} };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, sources: {} };
    throw error;
  }
}

function wpRecordToCandidate(record) {
  const embeddedTerms = (record._embedded?.["wp:term"] ?? []).flat();
  const categories = embeddedTerms
    .filter((term) => term.taxonomy === "wpbdp_category")
    .map((term) => cleanText(term.name));
  const keywords = embeddedTerms
    .filter((term) => term.taxonomy === "wpbdp_tag")
    .map((term) => cleanText(term.name));
  const imageUrl = cleanUrl(record._embedded?.["wp:featuredmedia"]?.[0]?.source_url);

  return {
    name: cleanText(record.title?.rendered ?? ""),
    briefDescription: cleanText(record.excerpt?.rendered ?? "") || null,
    description: cleanText(record.content?.rendered ?? "") || null,
    categories,
    keywords,
    imageUrl,
    sourceRecord: {
      source: AUSTRALIAN_MANUFACTURING,
      sourceId: String(record.id),
      sourceUrl: record.link,
      listedAt: record.date ?? null,
      modifiedAt: record.modified ?? null,
    },
  };
}

async function scrapeAustralianManufacturing({
  cache,
  fetcher,
  limit,
  details,
  refreshDetails,
  onCheckpoint,
}) {
  const config = SOURCE_CONFIG[AUSTRALIAN_MANUFACTURING];
  const sourceCache = (cache.sources[AUSTRALIAN_MANUFACTURING] ??= { details: {} });
  const records = [];
  let page = 1;
  let totalPages = 1;

  do {
    const remaining = limit ? limit - records.length : 100;
    if (remaining <= 0) break;
    const perPage = Math.min(100, remaining);
    const url = new URL("/wp-json/wp/v2/wpbdp_listing", config.baseUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("_embed", "wp:featuredmedia,wp:term");
    const response = await fetcher.fetch(url, config.crawlDelayMs);
    totalPages = Number(response.headers.get("x-wp-totalpages") ?? 1);
    const pageRecords = await response.json();
    records.push(...pageRecords.map(wpRecordToCandidate));
    process.stderr.write(
      `[${AUSTRALIAN_MANUFACTURING}] discovered ${records.length} listings (${page}/${totalPages} pages)\n`,
    );
    page += 1;
  } while (page <= totalPages);

  if (!details) return records;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const sourceId = record.sourceRecord.sourceId;
    let detail = sourceCache.details[sourceId];
    if (!detail || refreshDetails) {
      try {
        const response = await fetcher.fetch(record.sourceRecord.sourceUrl, config.crawlDelayMs);
        detail = parseAustralianManufacturingDetail(await response.text());
        sourceCache.details[sourceId] = detail;
        await onCheckpoint();
      } catch (error) {
        record.sourceRecord.error = String(error?.message ?? error);
        process.stderr.write(`[${AUSTRALIAN_MANUFACTURING}] ${sourceId} failed: ${error.message}\n`);
        continue;
      }
    }
    if (!detail.keywords?.length && detail.extraFields?.keywords_comma_separated) {
      detail.keywords = detail.extraFields.keywords_comma_separated
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean);
      sourceCache.details[sourceId] = detail;
    }
    const parsedAddress = parseAustralianAddress(detail.address ?? "");
    detail.state ??= parsedAddress.state;
    detail.postcode ??= parsedAddress.postcode;
    Object.assign(record, detail);
    process.stderr.write(`[${AUSTRALIAN_MANUFACTURING}] detailed ${index + 1}/${records.length}\n`);
  }

  return records;
}

function amtilListRecordToCandidate(record) {
  return {
    name: record.name,
    location: record.location,
    state: record.state,
    postcode: record.postcode,
    sourceRecord: {
      source: AMTIL,
      sourceId: record.sourceId,
      sourceUrl: record.sourceUrl,
      listedAt: null,
      modifiedAt: null,
    },
  };
}

async function scrapeAmtil({ cache, fetcher, limit, details, refreshDetails, onCheckpoint }) {
  const config = SOURCE_CONFIG[AMTIL];
  const sourceCache = (cache.sources[AMTIL] ??= { details: {} });
  const response = await fetcher.fetch(`${config.baseUrl}/manufacturelink/`, config.crawlDelayMs);
  let records = parseAmtilDirectory(await response.text()).map(amtilListRecordToCandidate);
  if (limit) records = records.slice(0, limit);
  process.stderr.write(`[${AMTIL}] discovered ${records.length} listings\n`);

  if (!details) return records;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const sourceId = record.sourceRecord.sourceId;
    let detail = sourceCache.details[sourceId];
    if (!detail || refreshDetails) {
      try {
        const detailResponse = await fetcher.fetch(
          record.sourceRecord.sourceUrl,
          config.crawlDelayMs,
        );
        detail = parseAmtilDetail(await detailResponse.text());
        sourceCache.details[sourceId] = detail;
        await onCheckpoint();
      } catch (error) {
        record.sourceRecord.error = String(error?.message ?? error);
        process.stderr.write(`[${AMTIL}] ${sourceId} failed: ${error.message}\n`);
        continue;
      }
    }
    const parsedAddress = parseAustralianAddress(detail.address ?? "");
    detail.state ??= parsedAddress.state;
    detail.postcode ??= parsedAddress.postcode;
    Object.assign(record, detail);
    process.stderr.write(`[${AMTIL}] detailed ${index + 1}/${records.length}\n`);
  }

  return records;
}

function parseArguments(argv) {
  const options = {
    cache: DEFAULT_CACHE,
    details: true,
    fresh: false,
    refreshDetails: false,
    limit: null,
    output: DEFAULT_OUTPUT,
    source: "both",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--cache") options.cache = argv[++index];
    else if (argument === "--fresh") options.fresh = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--limit") options.limit = Number(argv[++index]);
    else if (argument === "--no-details") options.details = false;
    else if (argument === "--output" || argument === "-o") options.output = argv[++index];
    else if (argument === "--refresh-details") options.refreshDetails = true;
    else if (argument === "--source") options.source = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!["both", AUSTRALIAN_MANUFACTURING, AMTIL].includes(options.source)) {
    throw new Error(`--source must be both, ${AUSTRALIAN_MANUFACTURING}, or ${AMTIL}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: pnpm scrape:manufacturers -- [options]\n\nOptions:\n  --source <name>    both (default), australian-manufacturing, or amtil\n  --output, -o       JSON output path (default: ${DEFAULT_OUTPUT})\n  --cache            resumable detail cache path (default: ${DEFAULT_CACHE})\n  --limit <number>   limit records per source for a test run\n  --no-details       fetch directory summaries only; skip company detail pages\n  --fresh            ignore the existing detail cache\n  --refresh-details  refetch details for the selected source(s)\n  --help, -h         show this help\n\nThe crawler obeys each site's robots.txt crawl delay (20 seconds and 10 seconds).\n`);
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const outputPath = resolve(options.output);
  const cachePath = resolve(options.cache);
  const cache = await readCache(cachePath, options.fresh);
  const fetcher = new RespectfulFetcher();
  let checkpointQueue = Promise.resolve();
  const onCheckpoint = () => {
    checkpointQueue = checkpointQueue.then(() => writeJsonAtomic(cachePath, cache));
    return checkpointQueue;
  };
  const sourceTasks = [];

  if (["both", AUSTRALIAN_MANUFACTURING].includes(options.source)) {
    sourceTasks.push(
      scrapeAustralianManufacturing({
        cache,
        fetcher,
        limit: options.limit,
        details: options.details,
        refreshDetails: options.refreshDetails,
        onCheckpoint,
      }),
    );
  }

  if (["both", AMTIL].includes(options.source)) {
    sourceTasks.push(
      scrapeAmtil({
        cache,
        fetcher,
        limit: options.limit,
        details: options.details,
        refreshDetails: options.refreshDetails,
        onCheckpoint,
      }),
    );
  }

  const records = (await Promise.all(sourceTasks)).flat();
  await checkpointQueue;

  const businesses = deduplicateBusinesses(records);
  const sourceCounts = Object.fromEntries(
    [AUSTRALIAN_MANUFACTURING, AMTIL].map((source) => [
      source,
      records.filter((record) => record.sourceRecord.source === source).length,
    ]),
  );
  const result = {
    metadata: {
      generatedAt: new Date().toISOString(),
      detailsIncluded: options.details,
      sourceCounts,
      sourceRecordCount: records.length,
      uniqueBusinessCount: businesses.length,
      duplicatesMerged: records.length - businesses.length,
      methodology: {
        duplicateKeys: [
          "website domain",
          "email",
          "phone + normalized name",
          "normalized name + state/postcode",
        ],
        crawlDelaysSeconds: {
          [AUSTRALIAN_MANUFACTURING]: 20,
          [AMTIL]: 10,
        },
      },
    },
    businesses,
  };

  await writeJsonAtomic(outputPath, result);
  await writeJsonAtomic(cachePath, cache);
  process.stdout.write(
    `Saved ${businesses.length} unique businesses from ${records.length} source records to ${outputPath}\n`,
  );
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  run().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
