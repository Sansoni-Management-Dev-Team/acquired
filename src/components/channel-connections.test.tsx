import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/whatsapp-connection", () => ({ WhatsAppConnection: () => null }));
import { ChannelConnections } from "./channel-connections";

it("makes partial Gmail access visible without opening connection details", () => {
  const html = renderToStaticMarkup(<ChannelConnections notice={{}} gmail={{ address: "sender@example.com", hasRefreshToken: true, reconnectRequired: false, scopes: ["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.messages.readonly"], dailyCap: 100, updatedAt: new Date() }} />);
  expect(html.split("<details")[0]).toContain("Connected · reply access needed");
  expect(html).toContain("Gmail is connected for composing messages.");
});
