import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ChannelConnections } from "./channel-connections";
afterEach(() => vi.unstubAllEnvs());
it('offers configured Unipile setup and distinguishes syncing from send readiness', () => {
 const binding={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'c',accountId:'a',generation:1,channel:'email' as const,platform:'gmail' as const,backend:'unipile' as const};
 const html=renderToStaticMarkup(<ChannelConnections initialSnapshot={{available:true,checkedAt:'2026-10-14T00:00:00.000Z',connections:[{binding,label:'owner@example.test',status:'syncing',capabilities:{messaging:{send:true,durableIdempotency:true,receiptLookup:true},events:{read:true,history:true,realtime:true}},readiness:{status:'waiting',code:'incomplete'},isDefault:false}]}}/>);
 expect(html).toContain('owner@example.test');expect(html).toContain('Syncing');expect(html).toContain('Use for new work');expect(html).toContain('Disconnect');expect(html).not.toContain('Setup unavailable');expect(html).not.toContain('>Ready<');
});
it("shows only Unipile for all three channels with unavailable setup", () => {
    const View = ChannelConnections as React.ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(<View notice={{}}/>);
    for (const channel of ["Email", "WhatsApp", "LinkedIn"])
        expect(html).toContain(channel);
    expect(html.match(/Connect (?:Email|WhatsApp|LinkedIn) with Unipile/g)).toHaveLength(3);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain("Setup unavailable");
    expect(html).not.toMatch(/api\/mailbox\/google|Browser connection|Linked device|QR code|Open LinkedIn|Connect Gmail/);
});
it("never infers a Unipile connection from old settings or legacy connection notices", () => {
    vi.stubEnv("LINKEDIN_SERVICE_URL", "https://legacy.example.test");
    vi.stubEnv("LINKEDIN_SERVICE_SECRET", "fixture-legacy-only");
    vi.stubEnv("WHATSAPP_SERVICE_URL", "https://legacy-whatsapp.example.test");
    const View = ChannelConnections as React.ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(<View notice={{ gmail: "connected" }} gmail={{ address: "historical@example.test", scopes: ["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.readonly"], hasRefreshToken: true, reconnectRequired: false, dailyCap: 100, updatedAt: new Date() }}/>);
    expect(html).not.toContain("historical@example.test");
    expect(html).not.toMatch(/connected successfully|>Connected<|>Ready<|Granted|private|Browser connection/);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
});
it('marks IMAP unavailable while configured Gmail and Outlook remain selectable', () => {
 const html=renderToStaticMarkup(<ChannelConnections initialSnapshot={{available:true,connections:[],checkedAt:'2026-10-14T00:00:00.000Z'}}/>);
 const option=(value:string)=>html.match(new RegExp(`<option\\b[^>]*value="${value}"[^>]*>[^<]*</option>`))?.[0];
 expect(option('imap')).toContain('disabled=""');
 expect(option('imap')).toContain('IMAP unavailable');
 expect(option('gmail')).toContain('Gmail');expect(option('gmail')).not.toContain('disabled');
 expect(option('outlook')).toContain('Outlook');expect(option('outlook')).not.toContain('disabled');
});
