"use client";
import { useEffect, useRef } from "react";

// Polls only while the server reports work in progress. Fetches once on mount and
// whenever `key` changes, on every interval while `active`, once more when `active`
// turns off so the terminal state lands, and when the tab becomes visible again.
// Idle mandates previously polled forever and dominated database egress.
export function useActivePolling(refresh: () => Promise<unknown> | void, { active, intervalMs, key = "" }: { active: boolean; intervalMs: number; key?: string }) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const wasActive = useRef(false);
  useEffect(() => { void refreshRef.current(); }, [key]);
  useEffect(() => {
    if (!active) {
      if (wasActive.current) { wasActive.current = false; void refreshRef.current(); }
      return;
    }
    wasActive.current = true;
    const timer = setInterval(() => { if (!document.hidden) void refreshRef.current(); }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) void refreshRef.current(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
