import { describe, expect, it } from "vitest";
import { buyerProfileFromMetadata, buyerProfileSchema, metadataWithBuyerProfile } from "./buyer-profile";

const profile = { senderName: "Alex Buyer", about: "I have operated service businesses for fifteen years.", exampleEmail: "Hello, I would welcome a private conversation.", signature: "Kind regards, Alex" };

describe("buyer profile", () => {
  it("round trips without discarding other organisation metadata", () => {
    const encoded = metadataWithBuyerProfile('{"existing":true}', buyerProfileSchema.parse(profile));
    expect(JSON.parse(encoded)).toMatchObject({ existing: true, buyerProfile: profile });
    expect(buyerProfileFromMetadata(encoded)).toEqual(profile);
  });

  it("does not accept incomplete drafting context", () => {
    expect(buyerProfileFromMetadata('{"buyerProfile":{"senderName":"A"}}')).toBeNull();
  });
  it("keeps an older saved profile readable until it is edited in Settings", () => {
    const legacy = { senderName: "Alex Buyer", background: "I have operated service businesses for fifteen years.", signature: "Alex Buyer" };
    expect(buyerProfileFromMetadata(JSON.stringify({ buyerProfile: legacy }))).toEqual(legacy);
  });
});
