import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMandateCache, MANDATE_CACHE_TTL, SESSION_CACHE_TTL } from "./mandate-cache";
import { emptyBrief } from "@/domain/acquisition";

const scope = JSON.stringify(["user-a", "org-a", "session-a"]);
const mandate = { id: "mandate-a", brief: { ...emptyBrief(), name: "Original" }, createdAt: "2026-10-14T00:00:00.000Z" };
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const request = vi.fn<typeof fetch>().mockImplementation(async input => input === "/api/acquisition-session"
    ? Response.json({ scope, expiresAt: Date.now() + 3_600_000 })
    : Response.json({ scope, mandates: [mandate] }));
  const store = createMandateCache(storage, request);
  return { store, request, storage, values };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("mandate cache", () => {
  it("deduplicates requests and uses fresh session and mandate data until expiry", async () => {
    const { store, request } = setup();
    await Promise.all([store.getState().refresh(), store.getState().refresh()]);
    expect(request).toHaveBeenCalledTimes(2);
    await store.getState().refresh();
    expect(request).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(MANDATE_CACHE_TTL + 1);
    await store.getState().refresh();
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(SESSION_CACHE_TTL);
    await store.getState().refresh();
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("keeps cached rows visible while expired data refreshes", async () => {
    const { store, request } = setup();
    await store.getState().refresh();
    const next = deferred();
    request.mockReturnValueOnce(next.promise);
    vi.advanceTimersByTime(MANDATE_CACHE_TTL + 1);
    const refreshing = store.getState().refresh();
    await Promise.resolve();
    expect(store.getState().entry?.mandates[0].brief.name).toBe("Original");
    expect(store.getState().refreshing).toBe(true);
    next.resolve(Response.json({ scope, mandates: [{ ...mandate, brief: { ...mandate.brief, name: "Updated" } }] }));
    await refreshing;
    expect(store.getState().entry?.mandates[0].brief.name).toBe("Updated");
  });

  it("persists rows but validates identity again after a reload", async () => {
    const { store, request, storage, values } = setup();
    await store.getState().refresh();
    expect([...values.values()][0]).not.toContain('"session":');
    const reloaded = createMandateCache(storage, request);
    await reloaded.persist.rehydrate();
    expect(reloaded.getState().session).toBeNull();
    expect(reloaded.getState().entry?.mandates).toEqual([mandate]);
    await reloaded.getState().refresh();
    expect(request).toHaveBeenCalledTimes(3);
    expect(reloaded.getState().session?.scope).toBe(scope);
  });

  it("clears rows when the user, workspace or session changes", async () => {
    const { store, request } = setup();
    await store.getState().refresh();
    request.mockResolvedValueOnce(Response.json({ scope: "other-user-workspace-session", expiresAt: Date.now() + 3_600_000 }));
    await store.getState().validateSession(true);
    expect(store.getState().entry).toBeNull();
  });

  it.each([401, 409])("clears persisted data on session response %s", async status => {
    const { store, request, values } = setup();
    await store.getState().refresh();
    request.mockResolvedValueOnce(Response.json({}, { status }));
    await store.getState().validateSession(true);
    expect(store.getState().entry).toBeNull();
    expect(store.getState().session).toBeNull();
    expect(store.getState().status).toBe(status === 401 ? "signed-out" : "onboarding");
    expect([...values.values()][0]).not.toContain("Original");
  });

  it("clears cached data if a list request detects revoked access", async () => {
    const { store, request } = setup();
    await store.getState().refresh();
    request.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await store.getState().refresh(true);
    expect(store.getState().status).toBe("signed-out");
    expect(store.getState().entry).toBeNull();
  });

  it("keeps cached rows after a failed refresh and allows retry", async () => {
    const { store, request } = setup();
    await store.getState().refresh();
    request.mockRejectedValueOnce(new Error("offline"));
    await store.getState().refresh(true);
    expect(store.getState().entry?.mandates).toEqual([mandate]);
    expect(store.getState().error).toContain("Could not refresh");
    await store.getState().refresh(true);
    expect(store.getState().error).toBe("");
  });

  it("does not restore data from a late response after signing out", async () => {
    const { store, request } = setup();
    await store.getState().refresh();
    const next = deferred();
    request.mockReturnValueOnce(next.promise);
    const refreshing = store.getState().refresh(true);
    await Promise.resolve();
    store.getState().clear();
    next.resolve(Response.json({ scope, mandates: [mandate] }));
    await refreshing;
    expect(store.getState().entry).toBeNull();
    expect(store.getState().session).toBeNull();
  });

  it("preserves a save made during a background refresh", async () => {
    const { store, request } = setup();
    await store.getState().refresh();
    const next = deferred();
    request.mockReturnValueOnce(next.promise);
    const refreshing = store.getState().refresh(true);
    await Promise.resolve();
    store.getState().upsert({ ...mandate, brief: { ...mandate.brief, name: "Just saved" } });
    next.resolve(Response.json({ scope, mandates: [mandate] }));
    await refreshing;
    expect(store.getState().entry?.mandates[0].brief.name).toBe("Just saved");
    expect(store.getState().entry?.updatedAt).toBe(0);
  });

  it("discards malformed persisted rows", async () => {
    const { store, values } = setup();
    values.set("acquired-mandates-v1", JSON.stringify({ state: { entry: { scope, updatedAt: 1, mandates: [{}] } }, version: 0 }));
    await store.persist.rehydrate();
    expect(store.getState().entry).toBeNull();
  });

  it("never accepts a mandate response belonging to another scope", async () => {
    const { store, request } = setup();
    await store.getState().refresh();
    request.mockResolvedValueOnce(Response.json({ scope: "other-workspace", mandates: [] }));
    request.mockResolvedValueOnce(Response.json({ scope: "other-workspace", expiresAt: Date.now() + 3_600_000 }));
    await store.getState().refresh(true);
    expect(store.getState().entry).toBeNull();
    expect(store.getState().session?.scope).toBe("other-workspace");
  });
});
