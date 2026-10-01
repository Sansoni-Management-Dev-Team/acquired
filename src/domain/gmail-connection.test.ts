import { describe, expect, it } from "vitest";
import { connectionCanCompose, connectionCanMonitorReplies, gmailConnectionStatus } from "./gmail-connection";

const compose = "https://www.googleapis.com/auth/gmail.compose";
const readonly = "https://www.googleapis.com/auth/gmail.readonly";
const connected = { hasRefreshToken: true, reconnectRequired: false, scopes: [compose, readonly] };

describe("Gmail connection readiness", () => {
  it("requires actual reply permission even when compose access is connected", () => {
    const local = { ...connected, scopes: [compose, "https://www.googleapis.com/auth/gmail.messages.readonly"] };
    expect(connectionCanCompose(local)).toBe(true);
    expect(connectionCanMonitorReplies(local)).toBe(false);
    expect(gmailConnectionStatus(local)).toBe("reply_access_needed");
    expect(gmailConnectionStatus(connected)).toBe("ready");
  });
  it("distinguishes missing connections, expired grants, and missing compose permission", () => {
    expect(gmailConnectionStatus(null)).toBe("not_connected");
    expect(gmailConnectionStatus({ ...connected, hasRefreshToken: false })).toBe("reconnect_required");
    expect(gmailConnectionStatus({ ...connected, reconnectRequired: true })).toBe("reconnect_required");
    expect(gmailConnectionStatus({ ...connected, scopes: [readonly] })).toBe("compose_access_needed");
    expect(gmailConnectionStatus({ ...connected, scopes: null })).toBe("compose_access_needed");
  });
});
