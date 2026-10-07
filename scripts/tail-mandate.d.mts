import type { Pool } from 'pg';
export const compactMandateQuery: string;
export type CompactMandateSnapshot = { id: string; jobs: Record<string, number>; sync: Record<string, number>; companies: number; contacts: number };
export function readCompactMandate(pool: Pick<Pool, 'connect'>, mandateId: string): Promise<CompactMandateSnapshot>;
export function tailMandate(options: {
  read: () => Promise<Record<string, unknown>>;
  emit: (event: Record<string, unknown>) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxSamples?: number;
  maxBackoffMs?: number;
}): Promise<{ finished: boolean; samples: number; lastSample?: Record<string, unknown> }>;
