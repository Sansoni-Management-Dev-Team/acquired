import { expect, it } from "vitest";
import { acquireOutreachBatch } from "./outreach-batch-guard";
it("rejects overlapping batches and rapid repeats, allowing other organizations", () => {
  const release = acquireOutreachBatch("guard-test-a", 1000);
  expect(release).toBeTypeOf("function");
  expect(acquireOutreachBatch("guard-test-a", 5000)).toBeNull();
  const other = acquireOutreachBatch("guard-test-b", 1000);
  expect(other).toBeTypeOf("function"); other?.();
  release?.();
  expect(acquireOutreachBatch("guard-test-a", 1100)).toBeNull();
  const next = acquireOutreachBatch("guard-test-a", 1300);
  expect(next).toBeTypeOf("function"); next?.();
});
