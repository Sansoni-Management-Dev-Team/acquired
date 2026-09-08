import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { searchResultUrls } from "./cloudflare-search";
import { companyHeadcountPrompt, headcountModelFindings } from "./company-facts";
import type { ResearchConfig } from "./research";
// Opt-in: three bounded, billable provider calls; no application or database writes.
it.skipIf(process.env.RUN_CLOUDFLARE_SMOKE !== "true")("discovers and extracts Ashton headcount with live Cloudflare services", async () => {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  expect(Boolean(account && token)).toBe(true);
  const call = async (path: string, body: unknown) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(`Cloudflare request failed (${r.status})`);
    return data.result;
  };
  const cachedProfile = process.env.CLOUDFLARE_SMOKE_PROFILE;
  const markdown = cachedProfile ? null : await call("browser-rendering/markdown", { url: "https://html.duckduckgo.com/html/?q=Ashton%20Manufacturing%20LinkedIn", gotoOptions: { waitUntil: "domcontentloaded", timeout: 20000 } });
  const seeds = markdown ? searchResultUrls(markdown) : [];
  const source = cachedProfile ? "https://au.linkedin.com/company/ashton-manufacturing" : seeds.find(url => /linkedin\.com\/company\/ashton-manufacturing\/?$/.test(url));
  expect(source).toBeTruthy();
  const page = cachedProfile ? await readFile(cachedProfile, "utf8") : await call("browser-rendering/markdown", { url: source, gotoOptions: { waitUntil: "domcontentloaded", timeout: 20000 } });
  const config: ResearchConfig = { purpose: "firmographics", companyName: "Ashton Manufacturing", companyDomain: "ashtonmanufacturing.com.au", seeds: [], searchTerms: ["company size"], geography: "Australia", discover: true, approved: true, budget: { maxPages: 1, maxDomains: 1, maxModelCalls: 1, maxMinutes: 5 } };
  const output = await call("ai/run/@cf/meta/llama-3.1-8b-instruct-fast", { messages: companyHeadcountPrompt(page, source!, config), max_tokens: 300, temperature: 0, response_format: { type: "json_schema", json_schema: { type: "object", properties: { value: { type: ["string", "null"] }, quote: { type: ["string", "null"] } }, required: ["value", "quote"], additionalProperties: false } } });
  const parsed = typeof output.response === "string" ? JSON.parse(output.response) : output.response ?? output;
  const findings = headcountModelFindings(parsed, page, source!, config);
  await mkdir(".local-data/cloudflare-company-smoke", { recursive: true });
  await writeFile(".local-data/cloudflare-company-smoke/result.json", JSON.stringify({ capturedAt: new Date().toISOString(), cachedProfile: cachedProfile || null, seeds, source, page, modelOutput: parsed, findings }, null, 2));
  expect(findings.find(f => f.kind === "headcount")?.value).toMatch(/^51[-–]200 employees$/);
}, 150000);
