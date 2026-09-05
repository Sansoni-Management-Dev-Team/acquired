#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const DIRECTORY_PATH = ".local-data/manufacturing-directories.json";
const WEB_DISCOVERY_PATH = ".local-data/manufacturer-web-discovery.json";
const OUTPUT_PATH = ".local-data/manufacturing-search-index.json";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function domainOf(website) {
  if (!website) return "";
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanWebName(name, domain) {
  let cleaned = String(name || "").trim();
  if (domain && cleaned.toLowerCase().startsWith(domain.toLowerCase())) cleaned = cleaned.slice(domain.length).trim();
  cleaned = cleaned.split(/\s+[|–—]\s+|\s+-\s+/)[0].trim();
  return cleaned || domain.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceRecords(records, fallback) {
  const normalized = (records || []).map((record) => ({
    source: record.source || fallback.source,
    sourceId: String(record.sourceId || fallback.sourceId),
    sourceUrl: record.sourceUrl || fallback.sourceUrl,
  })).filter((record) => record.sourceUrl);
  const seen = new Set();
  return normalized.filter((record) => {
    const key = `${record.source}:${record.sourceId}:${record.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function directoryBusiness(business) {
  return {
    id: business.id,
    name: business.name,
    website: business.website || null,
    abn: business.abn || null,
    phone: business.phone || null,
    email: business.email || null,
    address: business.address || null,
    state: business.state || null,
    postcode: business.postcode || null,
    description: business.description || null,
    categories: unique(business.categories || []),
    keywords: unique(business.keywords || []),
    capabilities: business.capabilities || {},
    sourceRecords: sourceRecords(business.sourceRecords, { source: "manufacturing-directory", sourceId: business.id, sourceUrl: business.website }),
  };
}

function webBusiness(business) {
  const domain = business.domain || domainOf(business.website);
  const inferredStates = unique(business.states || []);
  return {
    id: business.id,
    name: cleanWebName(business.name, domain),
    website: business.website || null,
    abn: business.abn || null,
    phone: null,
    email: null,
    address: null,
    state: business.state || (inferredStates.length === 1 ? inferredStates[0] : null),
    postcode: null,
    description: business.description || null,
    categories: unique(business.categories || [business.category]),
    keywords: [],
    capabilities: {},
    manufacturingConfidence: business.manufacturingConfidence,
    manufacturingScore: business.manufacturingScore,
    australianConfidence: business.australianConfidence,
    australianScore: business.australianScore,
    sourceRecords: sourceRecords(business.sourceRecords, { source: "web-serp", sourceId: business.id, sourceUrl: business.website }),
  };
}

function merge(left, right) {
  return {
    ...left,
    website: left.website || right.website,
    abn: left.abn || right.abn,
    phone: left.phone || right.phone,
    email: left.email || right.email,
    address: left.address || right.address,
    state: left.state || right.state,
    postcode: left.postcode || right.postcode,
    description: left.description || right.description,
    categories: unique([...(left.categories || []), ...(right.categories || [])]),
    keywords: unique([...(left.keywords || []), ...(right.keywords || [])]),
    capabilities: { ...(right.capabilities || {}), ...(left.capabilities || {}) },
    manufacturingConfidence: right.manufacturingConfidence || left.manufacturingConfidence,
    manufacturingScore: right.manufacturingScore ?? left.manufacturingScore,
    australianConfidence: right.australianConfidence || left.australianConfidence,
    australianScore: right.australianScore ?? left.australianScore,
    sourceRecords: sourceRecords([...(left.sourceRecords || []), ...(right.sourceRecords || [])], {
      source: "manufacturing-index", sourceId: left.id, sourceUrl: left.website || right.website,
    }),
  };
}

function fallbackKey(business) {
  const normalizedName = business.name.toLowerCase().replace(/\b(?:pty|ltd|limited|company|co)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return `fallback:${createHash("sha256").update(`${normalizedName}:${business.state || ""}`).digest("hex").slice(0, 20)}`;
}

const [directoryFile, discoveryFile] = await Promise.all([
  readFile(DIRECTORY_PATH, "utf8").then(JSON.parse),
  readFile(WEB_DISCOVERY_PATH, "utf8").then(JSON.parse),
]);

const records = [
  ...directoryFile.businesses.map(directoryBusiness),
  ...discoveryFile.newBusinesses.map(webBusiness),
];
const businesses = new Map();
for (const business of records) {
  const domain = domainOf(business.website);
  const key = domain ? `domain:${domain}` : fallbackKey(business);
  businesses.set(key, businesses.has(key) ? merge(businesses.get(key), business) : business);
}

const output = {
  metadata: {
    generatedAt: new Date(Math.max(
      Date.parse(directoryFile.metadata.generatedAt),
      Date.parse(discoveryFile.metadata.generatedAt),
    )).toISOString(),
    directoryBusinesses: directoryFile.businesses.length,
    webDiscoveryBusinesses: discoveryFile.newBusinesses.length,
    uniqueBusinesses: businesses.size,
    duplicatesMerged: records.length - businesses.size,
    sources: ["australian-manufacturing", "amtil", "web-serp"],
  },
  businesses: [...businesses.values()].sort((left, right) => left.name.localeCompare(right.name)),
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output.metadata, null, 2));
