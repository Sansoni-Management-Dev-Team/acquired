import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ChannelConnections } from "./channel-connections";
afterEach(() => vi.unstubAllEnvs());
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
