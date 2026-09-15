import { expect, it, vi } from "vitest";
import { checkLocalResearchSchema } from "./local-research-schema.mjs";

it.each([
  [{ jobs: false, findings: false, slots: false, old_index_removed: true }, "0004"],
  [{ jobs: true, findings: true, slots: false, old_index_removed: true }, "0005"],
  [{ jobs: true, findings: true, slots: true, old_index_removed: false }, "0005"],
])("reports missing schema without applying it", async (state, migration) => {
  const query = vi.fn(async () => ({ rows: [state] }));
  await expect(checkLocalResearchSchema({ query })).rejects.toThrow(migration);
  expect(query).toHaveBeenCalledOnce();
  expect(query.mock.calls[0][0]).toMatch(/^SELECT/);
});
