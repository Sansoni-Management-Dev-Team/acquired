import { expect, it } from "vitest";
import { researchSettingsFromMetadata } from "./research-settings";

it("uses 20 until an organisation sets a valid research target", () => {
  expect(researchSettingsFromMetadata(null).defaultTargetBusinesses).toBe(20);
  expect(researchSettingsFromMetadata(JSON.stringify({ researchSettings: { defaultTargetBusinesses: 35 } })).defaultTargetBusinesses).toBe(35);
  expect(researchSettingsFromMetadata(JSON.stringify({ researchSettings: { defaultTargetBusinesses: 0 } })).defaultTargetBusinesses).toBe(20);
});
