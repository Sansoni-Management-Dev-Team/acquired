import { authorizeChannelRequest, retiredChannelResponse } from "@/lib/retired-channel-route";
import { checkChannelHealth, type ConnectionChannel } from "@/lib/channel-health";
export async function POST(request: Request) {
    const denied = await authorizeChannelRequest(request);
    if (denied)
        return denied;
    const query = new URL(request.url).searchParams;
    const provider = query.get("provider");
    if (["gmail", "linkedin", "whatsapp"].includes(provider || ""))
        return retiredChannelResponse();
    const channel = query.get("channel");
    if (provider || query.get("backend") !== "unipile" || !["email", "whatsapp", "linkedin"].includes(channel || ""))
        return Response.json({ error: "Unknown channel connection" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return Response.json(checkChannelHealth(channel as ConnectionChannel), { status: 503, headers: { "Cache-Control": "no-store" } });
}
