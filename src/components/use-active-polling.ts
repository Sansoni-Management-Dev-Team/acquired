"use client";
import { useEffect, useRef } from "react";

// Polls only while the server reports work in progress. Fetches once on mount and
// whenever `key` changes, on every interval while `active`, once more when `active`
// turns off so the terminal state lands, and when the tab becomes visible again.
// Idle mandates previously polled forever and dominated database egress.
export function useActivePolling(refresh: () => Promise<unknown> | void, { active, intervalMs, key = "", initial = true }: { active: boolean; intervalMs: number; key?: string; initial?: boolean }) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const inFlight = useRef(false);
  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await refreshRef.current(); } finally { inFlight.current = false; }
  };
  const wasActive = useRef(false);
  useEffect(() => { if (initial) void run(); }, [key, initial]);
  useEffect(() => {
    if (!active) {
      if (wasActive.current) { wasActive.current = false; void run(); }
      return;
    }
    wasActive.current = true;
    const timer = setInterval(() => { if (!document.hidden) void run(); }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) void run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
