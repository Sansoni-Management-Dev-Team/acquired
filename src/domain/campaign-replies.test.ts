import { expect, it } from "vitest";
import { replyIdentity, replyDecision, monitorFresh, type ReplyIdentity } from "./campaign-replies";

const now = new Date("2026-10-05T10:00:00Z");
const identity = (contactId = "contact", email = "alex@example.test"): ReplyIdentity => ({ contactId, email, identity: "61412345678@s.whatsapp.net", since: new Date("2026-10-01T00:00:00Z") });
it("normalizes exact channel identities without matching display names", () => {
  expect(replyIdentity("email", " Alex@Example.test ")).toBe("alex@example.test");
  expect(replyIdentity("whatsapp", "+61 (412) 345-678")).toBe("61412345678@s.whatsapp.net");
  expect(replyIdentity("whatsapp", "123@lid")).toBeNull();
  expect(replyIdentity("linkedin", "urn:li:fsd_profile:Alex123")).toBe("urn:li:fsd_profile:Alex123");
  expect(replyIdentity("linkedin", "https://linkedin.com/in/alex")).toBeNull();
});
it("stops duplicates of the same person and ignores pre-enrolment history", () => {
  expect(replyDecision({ fromIdentity: identity().identity, receivedAt: now }, [identity(), identity("duplicate")])).toEqual({ action: "stop", contactIds: ["contact", "duplicate"], emails: ["alex@example.test"] });
  expect(replyDecision({ fromIdentity: identity().identity, receivedAt: new Date("2026-09-01") }, [identity()])).toEqual({ action: "ignore", contactIds: [], emails: [] });
});
it("holds ambiguous identities for review rather than assigning a reply to the wrong person", () => {
  expect(replyDecision({ fromIdentity: identity().identity, receivedAt: now }, [identity(), identity("other", "other@example.test")])).toMatchObject({ action: "review", contactIds: ["contact", "other"] });
});
it("retains one person's verified identities when their email changes", () => {
  expect(replyDecision({ fromIdentity: identity().identity, receivedAt: now }, [identity(), identity("contact", "new@example.test"), identity("duplicate")])).toMatchObject({ action: "stop", contactIds: ["contact", "duplicate"], emails: ["alex@example.test", "new@example.test"] });
});
it("only permits a fresh successful check, not a recent error or a future timestamp", () => {
  expect(monitorFresh({ lastSuccessAt: now, lastError: null }, now)).toBe(true);
  expect(monitorFresh({ lastSuccessAt: new Date(now.getTime() - 301_000), lastError: null }, now)).toBe(false);
  expect(monitorFresh({ lastSuccessAt: now, lastError: "disconnected" }, now)).toBe(false);
  expect(monitorFresh({ lastSuccessAt: new Date(now.getTime() + 1000), lastError: null }, now)).toBe(false);
});

it("does not merge unrelated contacts through an absent email", () => {
  const identity = "urn:li:fsd_profile:shared";
  const identities = ["one", "two"].map(contactId => ({ contactId, email: "", identity, since: new Date(0) }));
  expect(replyDecision({ fromIdentity: identity, receivedAt: new Date() }, identities)).toMatchObject({ action: "review", emails: [] });
  expect(replyDecision({ fromIdentity: identity, receivedAt: new Date() }, identities.slice(0,1))).toMatchObject({ action: "stop", emails: [] });
});
