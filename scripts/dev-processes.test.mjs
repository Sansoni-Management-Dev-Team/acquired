import { expect, it } from "vitest";
import { isDevCommand, restartRoot } from "./dev-processes.mjs";

it("recognizes the launcher, Next, Wrangler and orphaned workerd", () => {
  for (const cmd of ["node scripts/dev.mjs", "node ./node_modules/next/dist/bin/next dev --port 3010", "node /project/node_modules/wrangler/wrangler-dist/cli.js dev --local", "next-server (v16.3.2)", "/project/node_modules/workerd/bin/workerd serve --binary"]) expect(isDevCommand(cmd), cmd).toBe(true);
  for (const cmd of ["node api.js", "postgres", "node scripts/test.mjs", "zsh", "node /project/node_modules/next/dist/bin/next start"]) expect(isDevCommand(cmd), cmd).toBe(false);
});

it("finds the project launcher through pnpm parents, without selecting the calling shell", () => {
  const table = new Map([
    [10, { pid: 10, parent: 9, command: "node scripts/dev.mjs" }],
    [11, { pid: 11, parent: 10, command: "node /bin/pnpm exec next dev" }],
    [12, { pid: 12, parent: 11, command: "next-server (v16.3.2)" }],
    [9, { pid: 9, parent: 1, command: "zsh" }],
  ]);
  expect(restartRoot(12, table, () => true, new Set([9]))?.pid).toBe(10);
  expect(restartRoot(12, table, pid => pid === 12, new Set())?.pid).toBe(12);
  expect(restartRoot(12, table, () => false, new Set())).toBeUndefined();
  expect(restartRoot(12, table, () => true, new Set([12]))).toBeUndefined();
});
