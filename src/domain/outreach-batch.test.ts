import { expect, it } from "vitest";
import { outreachBatchSchema, processOutreachBatch } from "./outreach-batch";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
it("validates contact selection limits and rejects duplicate pairs", () => {
  const row = { targetId: id(1), contactId: id(2) };
  const body = { mandateId: id(3), action: "generate", rows: [row] };
  expect(outreachBatchSchema.safeParse(body).success).toBe(true);
  expect(outreachBatchSchema.safeParse({ ...body, rows: [row, row] }).success).toBe(false);
  expect(outreachBatchSchema.safeParse({ ...body, rows: [] }).success).toBe(false);
  expect(outreachBatchSchema.safeParse({ ...body, rows: Array.from({ length: 21 }, (_, i) => ({ targetId: id(1), contactId: id(i + 10) })) }).success).toBe(false);
});
it("keeps per-contact successes when another recipient fails and runs sequentially", async () => {
  let active = 0;
  let peak = 0;
  const rows = [1, 2, 3].map(n => ({ targetId: id(1), contactId: id(n) }));
  const results = await processOutreachBatch(rows, async row => {
    active++; peak = Math.max(peak, active);
    await Promise.resolve(); active--;
    if (row.contactId === id(2)) throw new Error("Work email required");
    return "saved";
  });
  expect(peak).toBe(1);
  expect(results.map(result => result.ok)).toEqual([true, false, true]);
  expect(results[1]).toMatchObject({ contactId: id(2), error: "Work email required" });
});
