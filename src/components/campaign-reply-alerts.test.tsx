import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CampaignReplyAlertList } from "./campaign-reply-alerts";
import type { CampaignReplyAlert } from "@/domain/campaign-reply-alerts";

const alert: CampaignReplyAlert = { id: "event", contactId: "contact", contactName: "Alex Smith", mandateId: "mandate", channel: "email", receivedAt: "2026-10-09T00:00:00Z", needsReview: false };
it.each(["email", "whatsapp", "linkedin"] as const)("alerts the user that a %s reply stopped all outreach", channel => {
  const html = renderToStaticMarkup(<CampaignReplyAlertList alerts={[{ ...alert, channel }]} onDismiss={() => {}} />);
  expect(html).toContain('aria-label="Reply alerts"');
  expect(html).toContain("Alex Smith");
  expect(html).toContain({ email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn" }[channel]);
  expect(html).toContain("All further outreach stopped.");
  expect(html).toContain('href="/mandates/mandate/people"');
});
it("shows identity-review holds without asserting a confirmed reply", () => {
  const html = renderToStaticMarkup(<CampaignReplyAlertList alerts={[{ ...alert, needsReview: true }]} onDismiss={() => {}} />);
  expect(html).toContain("reply identity needs review");
  expect(html).toContain("Outreach held across all channels.");
  expect(html).not.toContain("All further outreach stopped.");
});
it("renders no banner without pending alerts", () => {
  expect(renderToStaticMarkup(<CampaignReplyAlertList alerts={[]} onDismiss={() => {}} />)).toBe("");
});
