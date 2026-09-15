import { z } from "zod";

export const outreachBatchSchema = z.object({
  mandateId: z.string().uuid(),
  action: z.enum(["generate", "save-gmail"]),
  rows: z.array(z.object({ targetId: z.string().uuid(), contactId: z.string().uuid() })).min(1).max(20),
}).superRefine((value, ctx) => {
  const keys = value.rows.map(row => `${row.targetId}:${row.contactId}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Select each contact only once", path: ["rows"] });
});

export async function processOutreachBatch<T extends { targetId: string; contactId: string }>(rows: T[], process: (row: T) => Promise<unknown>) {
  const results = [];
  // Sequential work bounds provider concurrency and preserves partial successes.
  for (const row of rows) {
    try { results.push({ ...row, ok: true, result: await process(row) }); }
    catch (error) { results.push({ ...row, ok: false, error: error instanceof Error ? error.message : "Request failed" }); }
  }
  return results;
}
