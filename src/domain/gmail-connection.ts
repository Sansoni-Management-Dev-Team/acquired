export type GmailConnectionState = {
  hasRefreshToken: boolean;
  reconnectRequired: boolean;
  scopes: string[] | null;
};

// Historical grant shapes remain readable; permission flags from a retired
// Gmail connection cannot authorize a current Unipile operation.
export function connectionCanCompose(_connection: GmailConnectionState) { return false; }
export function connectionCanMonitorReplies(_connection: GmailConnectionState) { return false; }
export type GmailConnectionStatus = "not_connected" | "reconnect_required" | "compose_access_needed" | "reply_access_needed" | "ready";
export function gmailConnectionStatus(connection?: GmailConnectionState | null): GmailConnectionStatus { return connection ? "reconnect_required" : "not_connected"; }

export const gmailStatusLabels: Record<GmailConnectionStatus, string> = {
  not_connected: "Not connected",
  reconnect_required: "Reconnect required",
  compose_access_needed: "Compose access needed",
  reply_access_needed: "Connected · reply access needed",
  ready: "Ready",
};

export const gmailStatusMessages: Record<GmailConnectionStatus, string> = {
  not_connected: "Connect email before subscribing contacts.",
  reconnect_required: "Reconnect email in Settings before subscribing contacts.",
  compose_access_needed: "Reconnect email in Settings to grant compose access before subscribing contacts.",
  reply_access_needed: "Complete email connection and verified reply monitoring before subscribing contacts.",
  ready: "Email is ready for campaigns.",
};
