import { describe, expect, it } from "vitest";
import { buyerProfileFromMetadata, buyerProfileSchema, metadataWithBuyerProfile } from "./buyer-profile";

const profile = {
  senderName: "Alex Buyer", background: "I have operated service businesses for fifteen years.",
  investmentThesis: "I am seeking one durable Victorian services company.", operatingIntent: "I intend to lead the company for the long term.",
  callToAction: "Would a private fifteen-minute introduction be reasonable?", signature: "Alex Buyer",
};

describe("buyer profile", () => {
  it("round trips without discarding other organisation metadata", () => {
    const encoded = metadataWithBuyerProfile('{"existing":true}', buyerProfileSchema.parse(profile));
    expect(JSON.parse(encoded)).toMatchObject({ existing: true, buyerProfile: profile });
    expect(buyerProfileFromMetadata(encoded)).toEqual(profile);
  });

  it("does not accept incomplete drafting context", () => {
    expect(buyerProfileFromMetadata('{"buyerProfile":{"senderName":"A"}}')).toBeNull();
  });
});
