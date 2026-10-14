import { pathToFileURL } from "node:url";

export async function checkPublicApp(fetcher = fetch) {
  const origin = "https://acquire.mlai.au";
  for (const path of ["/api/health", "/sign-in"]) {
    const response = await fetcher(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (response.status !== 200) throw new Error(`Public check failed: ${path} (${response.status})`);
  }
  const service = await fetcher(origin + "/health", { redirect: "manual", signal: AbortSignal.timeout(15000) });
  let serviceBody;
  try { serviceBody = await service.json(); } catch { throw new Error("Public communications health check failed"); }
  if (service.status !== 200 || serviceBody?.contractVersion !== "1")
    throw new Error("Public communications health check failed");
  for (const path of ["/api/mailbox/google/connect", "/settings", "/mandates"]) {
    const response = await fetcher(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const location = response.headers.get("location");
    if (![302, 303, 307, 308].includes(response.status) || !location || new URL(location).origin !== origin)
      throw new Error(`Public redirect check failed: ${path}`);
  }
  const callback = await fetcher(origin + "/api/mailbox/google/callback?code=invalid&state=invalid", { redirect: "manual", signal: AbortSignal.timeout(15000) });
  let callbackBody;
  try { callbackBody = await callback.json(); } catch { throw new Error("Public retired callback check failed"); }
  if (callback.status !== 401 || callback.headers.get("cache-control") !== "no-store"
      || !/^application\/json(?:;|$)/i.test(callback.headers.get("content-type") || "")
      || callback.headers.has("location") || !callbackBody || Array.isArray(callbackBody)
      || typeof callbackBody.error !== "string" || !callbackBody.error.trim())
    throw new Error("Public retired callback check failed");
  console.log("Public app, communications health, protected retired callback and sign-in redirects passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkPublicApp();
