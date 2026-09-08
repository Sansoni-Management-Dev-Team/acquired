import { timingSafeEqual } from "node:crypto";
export function researchEnabled() {
  return (
    process.env.RESEARCH_ENABLED === "true" &&
    Boolean(
      process.env.RESEARCH_WORKER_URL && process.env.RESEARCH_SERVICE_SECRET,
    )
  );
}
export function researchServiceAuthorized(request: Request) {
  const secret = process.env.RESEARCH_SERVICE_SECRET;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  return Boolean(
    secret &&
      token &&
      Buffer.byteLength(token) === Buffer.byteLength(secret) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(secret)),
  );
}
export async function researchWorker(
  path: string,
  method = "GET",
  body?: unknown,
) {
  const url = process.env.RESEARCH_WORKER_URL;
  if (!url || !process.env.RESEARCH_SERVICE_SECRET)
    throw new Error("Research service is not configured");
  const response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.RESEARCH_SERVICE_SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Research service unavailable (${response.status})`);
  return response.json();
}
