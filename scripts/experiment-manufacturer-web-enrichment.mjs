#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpClient } from "./discover-manufacturers-web.mjs";
import { normalizePilot } from "./lib/web-enrichment.mjs";

const INDEX_PATH = ".local-data/manufacturing-search-index.json";
const OUTPUT_PATH = ".local-data/manufacturer-web-enrichment-pilot.json";
const PILOT_COMPANIES = [
  { domain: "workmate.com.au", name: "Workmate Abrasives" },
  { domain: "australcroissants.com.au", name: "Austral Croissants" },
  { domain: "mansfields.com.au", name: "Mansfields" },
  { domain: "rootech.com.au", name: "Rootech" },
  { domain: "deltalabs.com.au", name: "Delta Laboratories" },
  { domain: "circuitwise.com.au", name: "Circuitwise Electronics Manufacturing" },
  { domain: "allmouldplastics.com.au", name: "Allmould Plastics" },
  { domain: "fairmontmedical.com.au", name: "Fairmont Medical Products" },
  { domain: "novaplas.com.au", name: "Novaplas" },
  { domain: "tufftrailers.com.au", name: "Tuff Trailers" },
];

function hostname(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function sleep(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

const index = JSON.parse(await readFile(INDEX_PATH, "utf8"));
const byDomain = new Map(index.businesses.map((business) => [hostname(business.website), business]));
const companies = PILOT_COMPANIES.map(({ domain, name }) => ({ ...byDomain.get(domain), name })).filter((company) => company.id);
if (companies.length !== PILOT_COMPANIES.length) throw new Error(`Expected ${PILOT_COMPANIES.length} pilot companies, found ${companies.length}`);

const client = new McpClient(resolve(homedir(), ".claude.json"));
await client.start("duckduckgo");
const results = [];
try {
  for (let indexNumber = 0; indexNumber < companies.length; indexNumber += 1) {
    const company = companies[indexNumber];
    const domain = hostname(company.website);
    process.stderr.write(`[enrich] ${indexNumber + 1}/${companies.length} ${company.name} (${domain})\n`);
    const queries = [
      `"${company.name}" employees Australia`,
      `"${domain}" employees staff workforce`,
      `"${company.name}" ZoomInfo employees`,
      `site:linkedin.com/company "${domain}" employees`,
    ];
    const searches = [];
    for (const query of queries) {
      try {
        const search = await client.call("search", { query, limit: 10, scrape_results: false }, 60_000);
        searches.push({ query, status: "complete", retrievedAt: new Date().toISOString(), backend: search.backend || "unknown", results: search.results || [] });
      } catch (error) {
        searches.push({ query, status: "failed", error: String(error.message || error), results: [] });
      }
      await sleep(2_500);
    }

    let crawlPages = [];
    let crawlError = null;
    try {
      const crawl = await client.call("crawl", { url: company.website, max_depth: 1, max_pages: 8, only_main_content: true }, 180_000);
      crawlPages = (crawl.pages || []).map((page) => ({ ...page, retrievedAt: new Date().toISOString() }));
    } catch (error) {
      crawlError = String(error.message || error);
    }

    results.push({
      id: company.id,
      name: company.name,
      website: company.website,
      domain,
      category: company.categories?.[0] || "manufacturing",
      state: company.state,
      searches,
      rawPages: crawlPages,
      crawledPages: crawlPages.map((page) => page.url),
      crawlError,
    });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(normalizePilot({ generatedAt: new Date().toISOString(), results }), null, 2)}\n`, "utf8");
  }
} finally {
  client.close();
}

const output = normalizePilot({ generatedAt: new Date().toISOString(), results });
await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output.summary, null, 2));
console.log(`Saved ${resolve(OUTPUT_PATH)}`);
