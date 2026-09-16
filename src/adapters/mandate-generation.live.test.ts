import { expect, it } from "vitest";
import { generateMandate } from "./mandate-generation";
import { briefSchema } from "@/domain/acquisition";

it.skipIf(process.env.MANDATE_GENERATION_LIVE !== "1")("generates a validated mandate through live free inference", async () => {
  const brief = await generateMandate();
  expect(briefSchema.safeParse(brief).success).toBe(true);
  expect(brief.criteria.every(c => c.origin === "assumed" && !c.confirmed)).toBe(true);
}, 60000);
