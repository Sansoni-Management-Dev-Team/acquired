import { pathToFileURL } from "node:url";

export async function checkPublicApp(fetcher = fetch) {
  const origin = "https://acquire.mlai.au";
  for (const path of ["/api/health", "/sign-in"]) {
    const response = await fetcher(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (response.status !== 200) throw new Error(`Public check failed: ${path} (${response.status})`);
  }
  for (const path of ["/api/mailbox/google/connect", "/api/mailbox/google/callback?code=invalid&state=invalid", "/settings", "/mandates"]) {
    const response = await fetcher(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const location = response.headers.get("location");
    if (![302, 303, 307, 308].includes(response.status) || !location || new URL(location).origin !== origin)
      throw new Error(`Public redirect check failed: ${path}`);
  }
  console.log("Public app and connection redirects passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkPublicApp();
