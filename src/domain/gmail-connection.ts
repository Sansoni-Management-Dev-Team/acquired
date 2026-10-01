export type GmailConnectionState = {
  hasRefreshToken: boolean;
  reconnectRequired: boolean;
  scopes: string[] | null;
};

export function connectionCanCompose(connection: GmailConnectionState) {
  return !connection.reconnectRequired && connection.hasRefreshToken
    && Boolean(connection.scopes?.includes("https://www.googleapis.com/auth/gmail.compose"));
}

export function connectionCanMonitorReplies(connection: GmailConnectionState) {
  return connectionCanCompose(connection)
    && Boolean(connection.scopes?.includes("https://www.googleapis.com/auth/gmail.readonly"));
}

export type GmailConnectionStatus = "not_connected" | "reconnect_required" | "compose_access_needed" | "reply_access_needed" | "ready";

export function gmailConnectionStatus(connection?: GmailConnectionState | null): GmailConnectionStatus {
  if (!connection) return "not_connected";
  if (connection.reconnectRequired || !connection.hasRefreshToken) return "reconnect_required";
  if (!connectionCanCompose(connection)) return "compose_access_needed";
  if (!connectionCanMonitorReplies(connection)) return "reply_access_needed";
  return "ready";
}

export const gmailStatusLabels: Record<GmailConnectionStatus, string> = {
  not_connected: "Not connected",
  reconnect_required: "Reconnect required",
  compose_access_needed: "Compose access needed",
  reply_access_needed: "Connected · reply access needed",
  ready: "Ready",
};

export const gmailStatusMessages: Record<GmailConnectionStatus, string> = {
  not_connected: "Connect your own Gmail before subscribing contacts.",
  reconnect_required: "Reconnect your Gmail in Settings before subscribing contacts.",
  compose_access_needed: "Reconnect Gmail in Settings to grant compose access before subscribing contacts.",
  reply_access_needed: "Gmail is connected for composing messages. Reconnect in Settings to grant read-only access for reply monitoring before subscribing contacts.",
  ready: "Gmail is ready for campaigns.",
};
