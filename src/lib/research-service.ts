import { timingSafeEqual } from "node:crypto";
import {researchTraceContext} from './research-request-observability';
import {researchTraceRequestHeaders} from '@/domain/research-trace-context';
import {providerJsonRequest} from '@/adapters/observability/provider-request';
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
  timeoutMs = 20000,
) {
  const url = process.env.RESEARCH_WORKER_URL;
  if (!url || !process.env.RESEARCH_SERVICE_SECRET)
    throw new Error("Research service is not configured");
  const inherited=researchTraceContext(),jobId=/^\/jobs\/([A-Za-z0-9_-]{1,100})(?:\/|$)/.exec(path)?.[1];
  const trace={...inherited,...(jobId?{jobId,runId:inherited.runId||jobId}:{})};
  const {response,data} = await providerJsonRequest<Awaited<ReturnType<Response['json']>>>(fetch,`${url.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.RESEARCH_SERVICE_SECRET}`,
      "Content-Type": "application/json",
      ...researchTraceRequestHeaders(trace),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  },{...trace,provider:'research-worker',operation:method==='POST'?'research_dispatch':method==='DELETE'?'research_cancel':'research_status'});
  if (!response.ok)
    throw new Error(`Research service unavailable (${response.status})`);
  return data;
}
