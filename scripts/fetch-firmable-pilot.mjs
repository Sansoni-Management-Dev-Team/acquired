import { readFile, writeFile } from "node:fs/promises";
const path = ".local-data/firmable-enrichment-pilot.json";
const domains = ["deltalabs.com.au", "circuitwise.com.au", "allmouldplastics.com.au", "fairmontmedical.com.au", "novaplas.com.au"];
if (!process.env.FIRMABLE_API_KEY) throw new Error("FIRMABLE_API_KEY required");
let saved = { schemaVersion: 1, results: [] };
try { saved = JSON.parse(await readFile(path, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
for (const domain of domains) {
  if (saved.results.some((r) => r.request.fqdn === domain)) continue;
  const response = await fetch(`https://api.firmable.com/company?${new URLSearchParams({ fqdn: domain, country: "AU" })}`, {
    headers: { Authorization: `Bearer ${process.env.FIRMABLE_API_KEY}` }, signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  let raw; try { raw = JSON.parse(body); } catch { raw = { unparsedBody: body }; }
  saved.results.push({ request: { fqdn: domain, country: "AU", endpoint: "/company" }, fetchedAt: new Date().toISOString(), httpStatus: response.status, raw });
  await writeFile(path, JSON.stringify(saved, null, 2) + "\n");
  console.log(JSON.stringify({ domain, status: response.status, keys: Object.keys(raw) }));
  if ([401, 403, 429].includes(response.status) || /not.*enough credits|insufficient.*credit/i.test(String(raw.error || ""))) break;
}
