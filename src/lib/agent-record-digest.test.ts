import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { agentRecordDigest } from "@/db/agent-store";
const hash = (json: string) => createHash("sha256").update(json).digest("hex");
it("preserves the public persisted digest contract for nested key order and array order", () => {
  const input = { z: [{ b: 2, a: 1 }, "last"], a: { z: false, b: null } },
    before = structuredClone(input);
  expect(agentRecordDigest(input)).toBe(
    hash('{"a":{"b":null,"z":false},"z":[{"a":1,"b":2},"last"]}'),
  );
  expect(
    agentRecordDigest({
      a: { b: null, z: false },
      z: [{ a: 1, b: 2 }, "last"],
    }),
  ).toBe(agentRecordDigest(input));
  expect(agentRecordDigest({ a: input.a, z: [...input.z].reverse() })).not.toBe(
    agentRecordDigest(input),
  );
  expect(input).toEqual(before);
});
it("retains existing JSON canonicalization edge cases without adding validation", () => {
  expect(agentRecordDigest({ b: undefined, a: NaN })).toBe(hash('{"a":null}'));
  expect(agentRecordDigest([undefined, NaN, Infinity])).toBe(
    hash("[null,null,null]"),
  );
  expect(agentRecordDigest(new Date("2026-10-01T00:00:00Z"))).toBe(hash("{}"));
  expect(() => agentRecordDigest(undefined)).toThrow();
  expect(agentRecordDigest.name).toBe("digest");
});
