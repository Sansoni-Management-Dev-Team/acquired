import{businessNow,type BusinessClock}from'../../core/src/business-clock';
import {
  COMMUNICATIONS_CONTRACT_VERSION,
  type ConnectionBinding, type DeliveryOutcome, type MessageSubmission,
  type Readiness, type ReceiptLookup, type AccessScope, type CanonicalIdentity, type RelationshipStatus,
} from "../../contracts/src/index";
import { assertManagedConnection, assertManagementBinding, assertManagementSnapshot, assertManagementSetupResponse, localSimulatorHostedOrigin, captureHostedDemoCapability, type HostedDemoCapability, type ManagedConnection, type ConnectionManagementSnapshot, type ConnectionSetupRequest, type ConnectionSetupResponse, type ConnectionDisconnectResponse } from '../../contracts/src/management';
import { isDeliveryOutcome, isReadiness } from "./validation";

export interface CommunicationsClientConfig {
  /** Trusted observation clock only; hosted auth expiry and transport stay real. */
  businessClock?:BusinessClock;
  baseUrl: string;
  contractVersion: "1";
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowLoopbackHttp?: boolean;
  localSimulatorOrigin?: string;
  hostedDemo?:HostedDemoCapability;
}
export class CommunicationsClientError extends Error {
  constructor(readonly code: string, readonly status?: number) { super(code); this.name = "CommunicationsClientError"; }
}
const knownErrors = new Set(["invalid_request", "unauthorized", "forbidden", "binding_changed", "connection_unavailable", "operation_conflict",
  "invalid_binding", "receipt_mismatch", "contract_version", "unsupported", "request_too_large", "request_timeout", "not_found", "internal"]);
const predispatchRejections: Record<string, number> = {
  invalid_request: 400, invalid_binding: 400, unauthorized: 401, forbidden: 403, not_found: 404,
  binding_changed: 409, connection_unavailable: 409, operation_conflict: 409, contract_version: 409,
  unsupported: 409, request_too_large: 413, request_timeout: 408,
};
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new CommunicationsClientError("transport"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function json(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxBytes) throw new CommunicationsClientError("protocol");
  if (!response.body) throw new CommunicationsClientError("protocol");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const result = await abortable(reader.read(), signal);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes) throw new CommunicationsClientError("protocol");
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { void reader.cancel().catch(() => undefined); }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

export class CommunicationsClient {
  #baseUrl: URL;
  #key: string;
  #fetch: typeof globalThis.fetch;
  #timeout: number;
  #maxBytes: number;
  #localSimulatorOrigin?: string;
  #hostedDemo?:HostedDemoCapability;
  #businessClock?:BusinessClock;
  constructor(config: CommunicationsClientConfig) {
    let url: URL;
    try { url = new URL(config.baseUrl); } catch { throw new Error("Invalid communications client configuration"); }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const timeout = config.timeoutMs ?? 15_000;
    const maxBytes = config.maxResponseBytes ?? 262_144;
    if (config.contractVersion !== COMMUNICATIONS_CONTRACT_VERSION || url.username || url.password || url.search || url.hash ||
        url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && config.allowLoopbackHttp === true)) ||
        !config.apiKey || config.apiKey.trim() !== config.apiKey || /[\r\n]/.test(config.apiKey) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) {
      throw new Error("Invalid communications client configuration");
    }
    this.#businessClock=config.businessClock;
    this.#baseUrl = url; this.#key = config.apiKey; this.#fetch = config.fetch ?? globalThis.fetch;
    this.#timeout = timeout; this.#maxBytes = maxBytes;
    if(config.hostedDemo!==undefined){if(config.localSimulatorOrigin!==undefined)throw new Error('Invalid hosted demo client configuration');this.#hostedDemo=captureHostedDemoCapability(config.hostedDemo);}
    if(config.localSimulatorOrigin!==undefined){
      if(!loopback||url.protocol!=='https:'||typeof process!=='undefined'&&process.env.NODE_ENV==='production')throw new Error('Invalid local simulator client configuration');
      this.#localSimulatorOrigin=localSimulatorHostedOrigin(config.localSimulatorOrigin);
    }
  }
  async health(): Promise<{ contractVersion: "1" }> {
    const data = await this.#request("/health");
    if (!object(data) || data.contractVersion !== COMMUNICATIONS_CONTRACT_VERSION) throw new CommunicationsClientError("protocol");
    return { contractVersion: "1" };
  }
  async connections(scope: AccessScope): Promise<ConnectionManagementSnapshot> {
    const data = await this.#request('/v1/connections/list', {}); assertManagementSnapshot(data, scope); return data;
  }
  async setupConnection(scope: AccessScope, input: ConnectionSetupRequest): Promise<ConnectionSetupResponse> {
    const captured = structuredClone(input); if (captured.reconnectBinding) assertManagementBinding(captured.reconnectBinding, scope);
    try {
      const data = await this.#request('/v1/connections/setup', captured);
      if(this.#hostedDemo!==undefined){assertManagementSetupResponse(data,{hostedDemo:this.#hostedDemo});return data;}
      if(this.#localSimulatorOrigin!==undefined){assertManagementSetupResponse(data,{localSimulatorOrigin:this.#localSimulatorOrigin});return data;}
      if (!object(data)) throw new CommunicationsClientError('protocol');
      if (data.status === 'redirect' && Object.keys(data).length === 2 && object(data.action) && Object.keys(data.action).sort().join(',') === 'expiresAt,type,url' && data.action.type === 'redirect' && typeof data.action.url === 'string' && typeof data.action.expiresAt === 'string') {
        const url = new URL(data.action.url);
        if (url.origin !== 'https://account.unipile.com' || url.username || url.password || url.hash || !Number.isFinite(Date.parse(data.action.expiresAt)) || Date.parse(data.action.expiresAt) <= Date.now()) throw new CommunicationsClientError('protocol');
        return data as ConnectionSetupResponse;
      }
      if (Object.keys(data).length === 1 && ['unknown', 'unavailable'].includes(String(data.status))) return data as ConnectionSetupResponse;
      if (Object.keys(data).length === 2 && data.status === 'rejected' && ['invalid', 'provider_rejected'].includes(String(data.code))) return data as ConnectionSetupResponse;
      throw new CommunicationsClientError('protocol');
    } catch (e) { if (e instanceof CommunicationsClientError && typeof e.status === 'number' && e.status === predispatchRejections[e.code]) throw e; return { status: 'unknown' }; }
  }
  async connectionStatus(binding: ConnectionBinding): Promise<ManagedConnection> {
    assertManagementBinding(binding, binding); const data = await this.#request('/v1/connections/status', { binding: structuredClone(binding) });
    assertManagedConnection(data, binding); if (JSON.stringify(data.binding) !== JSON.stringify(binding)) { // Compare values independently of property order.
      for (const k of Object.keys(binding) as (keyof ConnectionBinding)[]) if (data.binding[k] !== binding[k]) throw new CommunicationsClientError('protocol');
    } return data;
  }
  async disconnectConnection(binding: ConnectionBinding, key: string): Promise<ConnectionDisconnectResponse> {
    assertManagementBinding(binding, binding);
    try { const data = await this.#request('/v1/connections/disconnect', { binding: structuredClone(binding), key });
      if (!object(data) || Object.keys(data).some(k => !['status', 'code'].includes(k)) || !['disconnected', 'unknown', 'rejected', 'review'].includes(String(data.status)) || data.code !== undefined && (typeof data.code !== 'string' || !/^[a-z_]{1,80}$/.test(data.code))) throw new CommunicationsClientError('protocol');
      return data as ConnectionDisconnectResponse;
    } catch (e) { if (e instanceof CommunicationsClientError && typeof e.status === 'number' && e.status === predispatchRejections[e.code]) throw e; return { status: 'unknown' }; }
  }
  async setDefaultConnection(binding: ConnectionBinding): Promise<ManagedConnection> {
    assertManagementBinding(binding, binding); const data = await this.#request('/v1/connections/default', { binding: structuredClone(binding) }); assertManagedConnection(data, binding);
    for (const k of Object.keys(binding) as (keyof ConnectionBinding)[]) if (data.binding[k] !== binding[k]) throw new CommunicationsClientError('protocol');
    if (!data.isDefault) throw new CommunicationsClientError('protocol'); return data;
  }
  async ready(binding: ConnectionBinding): Promise<Readiness> {
    const data = await this.#request("/v1/ready", { binding });
    if (!isReadiness(data)) throw new CommunicationsClientError("protocol");
    return data;
  }
  async submit(input: MessageSubmission): Promise<DeliveryOutcome> {
    try {
      const captured = structuredClone(input);
      const data = await this.#request("/v1/submit", captured);
      if (!isDeliveryOutcome(data, captured.snapshot, captured.message.recipient) || data === null) return { status: "unknown" };
      return data;
    } catch (error) {
      if (error instanceof CommunicationsClientError && typeof error.status === "number" && error.status === predispatchRejections[error.code]) throw error;
      return { status: "unknown" };
    }
  }
  async lookup(input: ReceiptLookup): Promise<DeliveryOutcome | null> {
    const captured = structuredClone(input);
    const data = await this.#request("/v1/lookup", captured);
    if (!isDeliveryOutcome(data, captured.snapshot, captured.expectedRecipient, captured.message)) throw new CommunicationsClientError("protocol");
    return data;
  }
  async lookupDetails(input: ReceiptLookup): Promise<DeliveryOutcome|null> {
    const captured=structuredClone(input),data=await this.#request('/v1/lookup/details',captured);
    if(!isDeliveryOutcome(data,captured.snapshot,captured.expectedRecipient,captured.message))throw new CommunicationsClientError('protocol');return data;
  }
  async inspectRelationship(binding:ConnectionBinding,profile:CanonicalIdentity):Promise<{status:RelationshipStatus;canMessage:boolean|null;observedAt:string}> {
    assertManagementBinding(binding,binding);if(binding.channel!=='linkedin'||profile.kind!=='linkedin_profile')throw new CommunicationsClientError('invalid_request');
    const data=await this.#request('/v1/relationships/inspect',{binding:structuredClone(binding),profile:structuredClone(profile),refresh:true});
    if(!object(data)||Object.keys(data).sort().join(',')!=='canMessage,observedAt,status'||!['connected','invitation_pending','not_connected','unknown'].includes(String(data.status))||!(data.canMessage===null||typeof data.canMessage==='boolean')||typeof data.observedAt!=='string'||!Number.isFinite(Date.parse(data.observedAt))||Date.parse(data.observedAt)>businessNow(this.#businessClock))throw new CommunicationsClientError('protocol');
    return data as {status:RelationshipStatus;canMessage:boolean|null;observedAt:string};
  }
  async #request(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    try {
      const response = await abortable(this.#fetch(new URL(path, this.#baseUrl), {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${this.#key}`, "X-Communications-Contract-Version": COMMUNICATIONS_CONTRACT_VERSION,
          Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), controller.signal);
      if (response.headers.get("x-communications-contract-version") !== COMMUNICATIONS_CONTRACT_VERSION) throw new CommunicationsClientError("protocol");
      const data = await json(response, this.#maxBytes, controller.signal);
      if (!response.ok) {
        const code = object(data) && Object.keys(data).length === 1 && object(data.error) && Object.keys(data.error).length === 1 &&
          typeof data.error.code === "string" && knownErrors.has(data.error.code) ? data.error.code : "protocol";
        throw new CommunicationsClientError(code, response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof CommunicationsClientError) throw error;
      throw new CommunicationsClientError("transport");
    } finally { clearTimeout(timer); }
  }
}
