import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./people-search", () => ({ PeopleSearch: () => null }));
import { OutreachQueue, type OutreachTargetView } from "./outreach-queue";
function renderDraft({ state = "draft", historical = false, suppressed = false,deliveryAvailable=false }: {
    state?: string;
    historical?: boolean;
    suppressed?: boolean;
    deliveryAvailable?:boolean;
} = {}) {
    const target: OutreachTargetView = {
        id: "synthetic-target", companyName: "Synthetic Company", status: "new", stage: "shortlisted",
        contacts: [{ id: "synthetic-contact", displayName: "Synthetic Person", email: "person@example.test", fictionalised: false, doNotContact: suppressed }],
        signals: [], drafts: [{ id: "synthetic-message", contactId: "synthetic-contact", step: 1, subject: "Saved draft", body: "Reviewed synthetic local draft content.", signalIds: [], state, gmailDraftSaved: historical }],
    };
    return renderToStaticMarkup(<OutreachQueue mandateId="synthetic-mandate" initialTargets={[target]} initialBuyerProfile={{ senderName: "Synthetic Sender", about: "A reviewed synthetic buyer profile.", signature: "Synthetic Sender" }} showPeopleSearch={false} initialDeliveryAvailable={deliveryAvailable}/>);
}
it("offers local draft approval without a Gmail connection CTA or provider synchronization claim", () => {
    const html = renderDraft();
    expect(html).toContain("Approve draft");
    expect(html).not.toMatch(/Connect Gmail|Save to Gmail|Saved in Gmail|Send now|api\/mailbox\/google/);
    expect(html).toContain("Saved sequence");
});
it("labels retained Gmail identifiers as historical rather than a current provider draft", () => {
    const html = renderDraft({ historical: true });
    expect(html).toContain("Historical Gmail draft");
    expect(html).not.toMatch(/Gmail draft saved|Saved in Gmail|Reconnect Gmail|Send ready/);
});
it("keeps approved content read-only with an explicit local revoke action", () => {
    const html = renderDraft({ state: "approved", historical: true });
    expect(html).toContain("Revoke approval");
    expect(html).toMatch(/<input[^>]+disabled=""/);
    expect(html).toMatch(/<textarea[^>]+disabled=""/);
    expect(html).not.toContain("Approve draft");
});
it("retains the do-not-contact blocker while showing generic draft approval", () => {
    const html = renderDraft({ suppressed: true });
    expect(html).toContain("marked do-not-contact");
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Approve draft<\/button>/);
});
it.each(["queued", "sent", "cancelled", "failed"])("keeps historical %s content read-only without an approval or revoke action", state => {
    const html = renderDraft({ state, historical: true });
    expect(html).not.toMatch(/Approve draft|Revoke approval/);
    expect(html).toMatch(/<input[^>]+disabled=""/);
    expect(html).toMatch(/<textarea[^>]+disabled=""/);
    expect(html).toContain(`Status: ${state}`);
    expect(html).toContain("Historical Gmail draft");
});
it.each(["queued", "sent", "cancelled", "failed"])("disables sequence regeneration when it contains %s history", state => {
    const html = renderDraft({ state });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Regenerate all channels<\/button>/);
});
it("disables regeneration when a local draft retains a historical provider reference", () => {
    expect(renderDraft({ historical: true })).toMatch(/<button[^>]*disabled=""[^>]*>Regenerate all channels<\/button>/);
});
it('offers a separate send action only for approved application drafts with configured delivery',()=>{expect(renderDraft({state:'approved',deliveryAvailable:true})).toContain('Send approved email');expect(renderDraft({state:'draft',deliveryAvailable:true})).not.toContain('Send approved email');expect(renderDraft({state:'approved',historical:true,deliveryAvailable:true})).not.toContain('Send approved email');expect(renderDraft({state:'approved'})).not.toContain('Send approved email');});
