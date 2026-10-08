import { expect, it } from "vitest";
import { createContactRequest, matchesContactFilter, missingCampaignDetails, contactLinkedin } from "./contact-record";
import { renderCampaignTemplate, type CampaignDefinition } from "./campaign";

const definition = (kind: "email" | "linkedin" | "whatsapp"): CampaignDefinition => ({ schemaVersion: 1, steps: [kind === "email" ? { id: "send", kind, title: "Send", body: "Hi", subject: "Hello" } : { id: "send", kind, title: "Send", body: "Hi" }] });

it("allows every personal field to be omitted or empty", () => {
  expect(createContactRequest.parse({})).toEqual({});
  expect(createContactRequest.safeParse({ fullName: "", linkedinUrl: "", email: "", company: "", jobTitle: "", phone: "" }).success).toBe(true);
  expect(createContactRequest.safeParse({ linkedinUrl: "https://www.linkedin.com/in/example/" }).success).toBe(true);
});

it("validates supplied email and LinkedIn addresses without requiring either", () => {
  expect(createContactRequest.safeParse({ email: "bad" }).success).toBe(false);
  expect(createContactRequest.safeParse({ linkedinUrl: "https://linkedin.com.evil.test/in/person" }).success).toBe(false);
  expect(contactLinkedin("https://au.linkedin.com/in/person/?tracking=1")).toBe("https://www.linkedin.com/in/person");
});

it("filters independent channel details while retaining empty contacts in All people", () => {
  const linkedin = { linkedinUrl: "https://www.linkedin.com/in/person" };
  expect(matchesContactFilter({}, "all")).toBe(true);
  expect(matchesContactFilter(linkedin, "linkedin")).toBe(true);
  expect(matchesContactFilter(linkedin, "email")).toBe(false);
  expect(matchesContactFilter({ email: "person@example.com" }, "email")).toBe(true);
  expect(matchesContactFilter({ email: "bad" }, "email")).toBe(false);
  expect(matchesContactFilter({ phone: "0412 345 678" }, "phone")).toBe(true);
  expect(matchesContactFilter({ phone: " " }, "phone")).toBe(false);
});

it("requires only the sequence's channel details, including all split branches", () => {
  expect(missingCampaignDetails(definition("linkedin"), { linkedinUrl: "https://www.linkedin.com/in/person" })).toEqual([]);
  expect(missingCampaignDetails(definition("whatsapp"), { phone: "+61 412 345 678" })).toEqual([]);
  expect(missingCampaignDetails(definition("email"), {})).toEqual(["email"]);
  const mixed = { ...definition("linkedin"), steps: [...definition("linkedin").steps, { id: "wait", kind: "wait" as const, title: "Wait", days: 1 }, ...definition("email").steps] };
  expect(missingCampaignDetails(mixed, { linkedinUrl: "https://www.linkedin.com/in/person" })).toEqual(["email"]);
});

it("renders missing names and companies without broken greetings", () => {
  expect(renderCampaignTemplate("Hi {{first_name}}, {{full_name}} at {{company_name}}", { displayName: "", companyName: "" })).toBe("Hi there, there at your company");
});
