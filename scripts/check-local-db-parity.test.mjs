import { expect, it } from "vitest";
import { compareSnapshots } from "./check-local-db-parity.mjs";

const empty = () => Object.fromEntries(["version", "ledger", "tables", "columns", "constraints", "indexes", "policies", "roles", "grants", "functions", "triggers", "views"].map(key => [key, []]));
it("ignores PostgreSQL patch versions and metadata row ordering", () => {
  const a = { ...empty(), version: [{ version: "17.10" }], tables: [{ name: "a" }, { name: "b" }] };
  const b = { ...empty(), version: [{ version: "17.6" }], tables: [{ name: "b" }, { name: "a" }] };
  expect(compareSnapshots(a, b)).toEqual({});
});
it("reports RLS drift, missing schema objects and migration hash differences", () => {
  const a = { ...empty(), tables: [{ name: "a", rls: false }], ledger: [{ hash: "local", created_at: 1 }] };
  const b = { ...empty(), tables: [{ name: "a", rls: true }], ledger: [{ hash: "remote", created_at: 1 }], triggers: [{ name: "guard" }] };
  expect(compareSnapshots(a, b)).toMatchObject({ tables: { localOnly: [{ name: "a", rls: false }], remoteOnly: [{ name: "a", rls: true }] }, ledger: { localOnly: [{ hash: "local", created_at: 1 }], remoteOnly: [{ hash: "remote", created_at: 1 }] }, triggers: { localOnly: [], remoteOnly: [{ name: "guard" }] } });
});
