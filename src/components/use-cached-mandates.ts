"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMandateCache } from "@/lib/mandate-cache";
import type { MandateView } from "@/domain/acquisition";

const emptyMandates: MandateView[] = [];
export function useCachedSession() {
  const router = useRouter();
  const session = useMandateCache(state => state.session);
  const status = useMandateCache(state => state.status);
  useEffect(() => {
    void useMandateCache.persist.rehydrate();
    const validate = () => { void useMandateCache.getState().validateSession(); };
    const focus = () => { void useMandateCache.getState().validateSession(true); };
    validate();
    const timer = setInterval(validate, 15_000);
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, []);
  useEffect(() => {
    if (status === "signed-out") router.replace(`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    if (status === "onboarding") router.replace("/onboarding");
  }, [status, router]);
  return session;
}

export function useCachedMandates() {
  const session = useCachedSession();
  const entry = useMandateCache(state => state.entry);
  const error = useMandateCache(state => state.error || state.sessionError);
  const refreshing = useMandateCache(state => state.refreshing);
  const scope = session?.scope;
  useEffect(() => {
    if (!scope) return;
    const refresh = () => { void useMandateCache.getState().refresh(); };
    const focus = () => { void useMandateCache.getState().refresh(true); };
    refresh();
    const timer = setInterval(refresh, 15_000);
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [scope]);
  const cached = session && entry?.scope === session.scope ? entry : null;
  return { mandates: cached?.mandates ?? emptyMandates, loaded: Boolean(cached), error, refreshing,
    retry: () => { void useMandateCache.getState().refresh(true); } };
}

/** Local navigation preference, visible only in the validated cached session. */
export function useSelectedMandate(){
 const session=useMandateCache(state=>state.session),entry=useMandateCache(state=>state.entry);
 return session&&entry?.scope===session.scope?entry.selectedMandateId:undefined;
}
