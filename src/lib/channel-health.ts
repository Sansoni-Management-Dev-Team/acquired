export type ConnectionChannel = "email" | "whatsapp" | "linkedin";
export type ChannelHealth = {
    status: "unavailable";
    message: string;
    checkedAt: string;
};
/** Setup is not wired into this app yet; stored legacy connections cannot prove Unipile readiness. */
export function checkChannelHealth(channel: ConnectionChannel): ChannelHealth {
    const name = channel === "email" ? "Email" : channel === "whatsapp" ? "WhatsApp" : "LinkedIn";
    return { status: "unavailable", message: `${name} connection setup is not available yet.`, checkedAt: new Date().toISOString() };
}
