"use client";

import { create, type UseBoundStore, type Mutate, type StoreApi } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { briefSchema, type MandateView } from "@/domain/acquisition";

export const SESSION_CACHE_TTL = 60_000;
export const MANDATE_CACHE_TTL = 30_000;
const mandateSchema = z.object({ id: z.string(), brief: briefSchema, createdAt: z.string() });
const entrySchema = z.object({ scope: z.string(), mandates: z.array(mandateSchema), updatedAt: z.number(), selectedMandateId: z.string().optional() });
type Entry = z.infer<typeof entrySchema>;
type Session = { scope: string; expiresAt: number };
type CacheState = {
  entry: Entry | null;
  session: Session | null;
  status: "unknown" | "authenticated" | "signed-out" | "onboarding";
  sessionError: string;
  error: string;
  refreshing: boolean;
  validateSession: (force?: boolean) => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  upsert: (mandate: MandateView) => void;
  clear: () => void;
  selectMandate: (id: string) => void;
};

// Storage may be disabled or full. The in-memory cache must still work.
const browserStorage: StateStorage = {
  getItem: name => { try { return localStorage.getItem(name); } catch { return null; } },
  setItem: (name, value) => { try { localStorage.setItem(name, value); } catch {} },
  removeItem: name => { try { localStorage.removeItem(name); } catch {} },
};

type MandateCache = UseBoundStore<Mutate<StoreApi<CacheState>, [["zustand/persist", { entry: Entry | null }]]>>;
export function createMandateCache(storage: StateStorage = browserStorage, request: typeof fetch = (...args) => fetch(...args)): MandateCache {
  let epoch = 0;
  let revision = 0;
  let sessionRequest: Promise<void> | undefined;
  let mandatesRequest: { scope: string; promise: Promise<void> } | undefined;
  return create<CacheState>()(persist<CacheState, [], [], { entry: Entry | null }>((set, get) => ({
    entry: null, session: null, status: "unknown", sessionError: "", error: "", refreshing: false,
    selectMandate: id => {
      const entry=get().entry,scope=get().session?.scope;
      if(!scope||entry?.scope!==scope||entry.selectedMandateId===id||!entry.mandates.some(m=>m.id===id))return;
      set({entry:{...entry,selectedMandateId:id}});
    },
    clear: () => {
      epoch++; revision++;
      sessionRequest = undefined; mandatesRequest = undefined;
      set({ entry: null, session: null, status: "unknown", sessionError: "", error: "", refreshing: false });
    },
    validateSession: async (force = false) => {
      if (sessionRequest) return sessionRequest;
      if (!force && get().session && get().session!.expiresAt > Date.now()) return;
      const started = epoch;
      const pending = (async () => {
        try {
          const response = await request("/api/acquisition-session", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
          if (started !== epoch) return;
          if (response.status === 401 || response.status === 409) {
            get().clear();
            set({ status: response.status === 401 ? "signed-out" : "onboarding" });
            return;
          }
          if (!response.ok) throw new Error("Could not verify your session. Please retry.");
          const session = z.object({ scope: z.string(), expiresAt: z.number() }).parse(await response.json());
          if (started !== epoch) return;
          if (session.expiresAt <= Date.now()) { get().clear(); set({ status: "signed-out" }); return; }
          const changed = get().session?.scope !== session.scope;
          if (changed) { epoch++; mandatesRequest = undefined; }
          set({ session: { ...session, expiresAt: Math.min(session.expiresAt, Date.now() + SESSION_CACHE_TTL) }, status: "authenticated", sessionError: "", error: "", refreshing: changed ? false : get().refreshing,
            entry: get().entry?.scope === session.scope ? get().entry : null });
        } catch {
          if (started === epoch) set({ sessionError: "Could not verify your session. Please retry." });
        }
      })();
      sessionRequest = pending;
      await pending;
      if (sessionRequest === pending) sessionRequest = undefined;
    },
    refresh: async (force = false) => {
      await get().validateSession();
      const session = get().session;
      if (!session || session.expiresAt <= Date.now()) return;
      const scope = session.scope;
      if (mandatesRequest?.scope === scope) return mandatesRequest.promise;
      if (!force && get().entry?.scope === scope && Date.now() - get().entry!.updatedAt < MANDATE_CACHE_TTL) return;
      const started = epoch;
      const startedRevision = revision;
      set({ refreshing: true, error: "" });
      const pending = (async () => {
        try {
          const response = await request("/api/mandates", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
          if (started !== epoch) return;
          if (response.status === 401 || response.status === 403) {
            get().clear(); set({ status: "signed-out" }); return;
          }
          if (!response.ok) throw new Error("Could not refresh mandates. Please retry.");
          const result = z.object({ scope: z.string(), mandates: z.array(mandateSchema) }).parse(await response.json());
          if (started !== epoch) return;
          if (result.scope !== scope) { await get().validateSession(true); return; }
          // A save made during this request is newer than its list snapshot.
          if (startedRevision === revision) {const selected=get().entry?.scope===scope?get().entry?.selectedMandateId:undefined;set({ entry: { ...result, updatedAt: Date.now(),selectedMandateId:result.mandates.some(m=>m.id===selected)?selected:undefined } });}
        } catch {
          if (started === epoch) set({ error: "Could not refresh mandates. Please retry." });
        } finally {
          if (started === epoch) set({ refreshing: false });
        }
      })();
      mandatesRequest = { scope, promise: pending };
      await pending;
      if (mandatesRequest?.promise === pending) mandatesRequest = undefined;
    },
    upsert: mandate => {
      const scope = get().session?.scope;
      if (!scope) return;
      revision++;
      const mandates = get().entry?.scope === scope ? get().entry!.mandates : [];
      set({ entry: { scope, updatedAt: 0, selectedMandateId:get().entry?.scope===scope?get().entry?.selectedMandateId:undefined, mandates: [mandate, ...mandates.filter(item => item.id !== mandate.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) } });
    },
  }), {
    name: "acquired-mandates-v1",
    storage: createJSONStorage<{ entry: Entry | null }>(() => storage),
    skipHydration: true,
    partialize: state => ({ entry: state.entry }),
    merge: (stored, current) => {
      const parsed = entrySchema.safeParse((stored as { entry?: unknown } | undefined)?.entry);
      return { ...current, entry: parsed.success ? {...parsed.data,selectedMandateId:parsed.data.mandates.some(m=>m.id===parsed.data.selectedMandateId)?parsed.data.selectedMandateId:undefined} : null };
    },
  }));
}

export const useMandateCache = createMandateCache();
