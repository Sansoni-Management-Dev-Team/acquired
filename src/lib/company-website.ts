import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { publicResearchUrl } from "@/domain/research";

export type WebsiteValidation = { ok: true; url: string; status: number } | { ok: false; reason: string; status?: number };
type Address = { address: string; family: number };
type Resolve = (hostname: string) => Promise<Address[]>;
type Request = (url: URL, address: Address, timeoutMs: number) => Promise<{ status: number; location?: string }>;

function ipv4Number(address: string) {
  return address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0) >>> 0;
}

function inV4(address: string, network: string, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask);
}

export function publicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ![
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4],
  ].some(([network, prefix]) => inV4(address, String(network), Number(prefix)));
  if (family !== 6) return false;
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) return normalized.slice(7).includes(".") && publicIpAddress(normalized.slice(7));
  return normalized !== "::" && normalized !== "::1" && !/^f[cd]/.test(normalized) && !/^fe[89a-f]/.test(normalized) && !normalized.startsWith("ff") && !normalized.startsWith("2001:db8:");
}

const resolvePublic: Resolve = async hostname => (await dnsLookup(hostname, { all: true, verbatim: true })).map(result => ({ address: result.address, family: result.family }));

const requestPinned: Request = (url, address, timeoutMs) => new Promise((resolve, reject) => {
  const request = httpsRequest({
    protocol: "https:", hostname: address.address, family: address.family, port: url.port || 443,
    path: `${url.pathname}${url.search}`, servername: url.hostname,
    headers: { Host: url.host, "User-Agent": "Acquired website verifier/1.0", Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    method: "GET", timeout: timeoutMs, rejectUnauthorized: true,
  }, response => {
    const status = response.statusCode || 0;
    const location = typeof response.headers.location === "string" ? response.headers.location : undefined;
    response.destroy();
    resolve({ status, location });
  });
  request.on("timeout", () => request.destroy(new Error("timeout")));
  request.on("error", reject);
  request.end();
});

export async function validateCompanyWebsite(value: string, options: { resolve?: Resolve; request?: Request; timeoutMs?: number; maxRedirects?: number } = {}): Promise<WebsiteValidation> {
  const initial = publicResearchUrl(value);
  if (!initial) return { ok: false, reason: "Use a public HTTPS website URL" };
  const resolveHost = options.resolve || resolvePublic;
  const makeRequest = options.request || requestPinned;
  let current = new URL(initial);
  for (let redirect = 0; redirect <= (options.maxRedirects ?? 5); redirect++) {
    let addresses: Address[];
    try { addresses = await resolveHost(current.hostname); }
    catch { return { ok: false, reason: "Website domain does not resolve" }; }
    const publicAddresses = addresses.filter(address => publicIpAddress(address.address));
    if (!publicAddresses.length || publicAddresses.length !== addresses.length) return { ok: false, reason: "Website does not resolve to a public address" };
    let response: Awaited<ReturnType<Request>> | undefined;
    for (const address of publicAddresses.slice(0, 3)) {
      try { response = await makeRequest(current, address, options.timeoutMs ?? 6000); break; }
      catch { /* Try another public address before reporting the site unreachable. */ }
    }
    if (!response) return { ok: false, reason: "Website could not be reached" };
    if (response.status >= 200 && response.status < 300) return { ok: true, url: current.href, status: response.status };
    if (response.status >= 300 && response.status < 400 && response.location) {
      const redirected = publicResearchUrl(new URL(response.location, current).href);
      if (!redirected) return { ok: false, reason: "Website redirects to an unsupported address", status: response.status };
      current = new URL(redirected);
      continue;
    }
    return { ok: false, reason: `Website returned HTTP ${response.status || "unknown"}`, status: response.status || undefined };
  }
  return { ok: false, reason: "Website redirected too many times" };
}

export async function validateTargetWebsites<T extends { companyName: string; domain: string }>(targets: T[], concurrency = 12) {
  const cache = new Map<string, Promise<WebsiteValidation>>();
  const results = new Array<{ target: T; validation?: WebsiteValidation }>(targets.length);
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const index = cursor++;
      const target = targets[index];
      if (!target.domain) { results[index] = { target }; continue; }
      const promise = cache.get(target.domain) || validateCompanyWebsite(`https://${target.domain}/`);
      cache.set(target.domain, promise);
      results[index] = { target, validation: await promise };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
}
